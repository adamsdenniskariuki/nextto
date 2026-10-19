import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after } from "next/server";
import { publicEnv } from "@/lib/env";
import { mpesaConfig } from "@/lib/server-env";
import {
  buildStkCallback,
  darajaTimestamp,
  darajaText,
  mockReceipt,
  mockResultCode,
  stkPassword,
} from "./format";

/**
 * The Daraja client: OAuth token + M-Pesa Express (STK push).
 *
 * MPESA_ENV picks the backend:
 *   sandbox     https://sandbox.safaricom.co.ke (test credentials, no real money)
 *   production  https://api.safaricom.co.ke     (after go-live)
 *   mock        no network at all: returns fake ids, then POSTs a realistic
 *               callback to our own route a moment later. CI and local demos
 *               exercise the real callback path without a public tunnel.
 */

const BASE_URL = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
} as const;

export class MpesaError extends Error {
  override name = "MpesaError";
}

export type StkPushRequest = {
  phone: string; // Daraja format: 2547XXXXXXXX
  amountKes: number; // whole shillings
  accountReference: string;
  description: string;
};

export type StkPushResult = {
  merchantRequestId: string;
  checkoutRequestId: string;
};

// One OAuth token per server instance, reused until shortly before it expires.
let token: { value: string; expiresAt: number } | undefined;

async function accessToken(base: string, key: string, secret: string): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value;
  const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new MpesaError(`Daraja OAuth failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string; expires_in?: string | number };
  if (!body.access_token) throw new MpesaError("Daraja OAuth returned no token");
  const ttlSeconds = Number(body.expires_in ?? 3599);
  token = { value: body.access_token, expiresAt: Date.now() + (ttlSeconds - 60) * 1000 };
  return token.value;
}

export async function stkPush(req: StkPushRequest): Promise<StkPushResult> {
  const config = mpesaConfig();

  if (config.MPESA_ENV === "mock") {
    const ids = {
      merchantRequestId: `mock-mr-${randomUUID()}`,
      checkoutRequestId: `ws_CO_MOCK_${randomUUID().replace(/-/g, "")}`,
    };
    const callbackUrl = `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/mpesa/callback/${config.MPESA_CALLBACK_SECRET}`;
    // after() runs once the response has been sent, like a phone answering a
    // few seconds later. On Vercel it keeps the function alive (waitUntil).
    after(async () => {
      await sleep(1500);
      const resultCode = mockResultCode(req.phone);
      await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildStkCallback({
            ...ids,
            resultCode,
            amountKes: req.amountKes,
            phone: req.phone,
            receipt: mockReceipt(),
          }),
        ),
      }).catch((error: unknown) => console.error("mock M-Pesa callback failed", error));
    });
    return ids;
  }

  const base = BASE_URL[config.MPESA_ENV];
  const bearer = await accessToken(base, config.MPESA_CONSUMER_KEY, config.MPESA_CONSUMER_SECRET);
  const timestamp = darajaTimestamp();
  const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      BusinessShortCode: config.MPESA_SHORTCODE,
      Password: stkPassword(config.MPESA_SHORTCODE, config.MPESA_PASSKEY, timestamp),
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: req.amountKes,
      PartyA: req.phone,
      PartyB: config.MPESA_SHORTCODE,
      PhoneNumber: req.phone,
      CallBackURL: config.MPESA_CALLBACK_URL,
      AccountReference: darajaText(req.accountReference, 12),
      TransactionDesc: darajaText(req.description, 13),
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    ResponseCode?: string;
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    errorMessage?: string;
  };
  if (!res.ok || body.ResponseCode !== "0" || !body.CheckoutRequestID || !body.MerchantRequestID) {
    // Never log the request: it contains the password. The error text is safe.
    console.error("Daraja STK push rejected", res.status, body.errorMessage);
    throw new MpesaError(body.errorMessage ?? `Daraja STK push failed (${res.status})`);
  }
  return { merchantRequestId: body.MerchantRequestID, checkoutRequestId: body.CheckoutRequestID };
}
