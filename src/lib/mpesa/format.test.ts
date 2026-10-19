import { describe, expect, it } from "vitest";
import {
  buildStkCallback,
  centsToWholeShillings,
  darajaText,
  darajaTimestamp,
  mockReceipt,
  mockResultCode,
  resultMessage,
  stkCallbackSchema,
  stkPassword,
  toDarajaPhone,
} from "./format";

describe("darajaTimestamp", () => {
  it("formats the instant in Nairobi time (UTC+3), crossing midnight", () => {
    expect(darajaTimestamp(new Date("2026-01-01T21:30:05Z"))).toBe("20260102003005");
  });
  it("uses 24-hour time", () => {
    expect(darajaTimestamp(new Date("2026-06-15T10:00:00Z"))).toBe("20260615130000");
  });
});

describe("stkPassword", () => {
  it("is base64(shortcode + passkey + timestamp)", () => {
    const pw = stkPassword("174379", "passkey", "20260102003005");
    expect(Buffer.from(pw, "base64").toString()).toBe("174379passkey20260102003005");
  });
});

describe("toDarajaPhone", () => {
  it.each([
    ["+254712345678", "254712345678"],
    ["+254112345678", "254112345678"],
  ])("converts %s", (input, out) => expect(toDarajaPhone(input)).toBe(out));

  it.each(["0712345678", "+254212345678", "+25471234567", "+15551234567"])("rejects %s", (input) =>
    expect(toDarajaPhone(input)).toBeNull(),
  );
});

describe("centsToWholeShillings", () => {
  it("converts whole shillings", () => expect(centsToWholeShillings(150_000)).toBe(1500));
  it.each([50, 150_050, 0, -100, 1.5])("rejects %s", (c) =>
    expect(() => centsToWholeShillings(c)).toThrow(RangeError),
  );
});

describe("darajaText", () => {
  it("strips symbols and truncates", () => {
    expect(darajaText("INV-2026/0001", 12)).toBe("INV20260001");
    expect(darajaText("Deposit for Mama Njeri", 13)).toBe("Deposit for M");
  });
  it("never sends an empty string", () => expect(darajaText("---", 12)).toBe("Nextto"));
});

describe("stkCallbackSchema", () => {
  it("accepts a successful callback and keeps unknown keys", () => {
    const body = buildStkCallback({
      merchantRequestId: "m-1",
      checkoutRequestId: "ws_CO_1",
      resultCode: 0,
      amountKes: 500,
      receipt: "NXTABC1234",
    });
    const withExtra = { Body: { stkCallback: { ...body.Body.stkCallback, Extra: "kept" } } };
    const parsed = stkCallbackSchema.parse(withExtra);
    expect(parsed.Body.stkCallback.Extra).toBe("kept");
    const items = parsed.Body.stkCallback.CallbackMetadata?.Item ?? [];
    expect(items.find((i) => i.Name === "Amount")?.Value).toBe(500);
    expect(items.find((i) => i.Name === "MpesaReceiptNumber")?.Value).toBe("NXTABC1234");
  });

  it("accepts a cancelled callback without metadata", () => {
    const body = buildStkCallback({
      merchantRequestId: "m-1",
      checkoutRequestId: "ws_CO_1",
      resultCode: 1032,
    });
    expect(stkCallbackSchema.safeParse(body).success).toBe(true);
    expect(body.Body.stkCallback.CallbackMetadata).toBeUndefined();
    expect(body.Body.stkCallback.ResultDesc).toMatch(/cancelled/i);
  });

  it.each([
    {},
    { Body: {} },
    {
      Body: {
        stkCallback: {
          MerchantRequestID: "m",
          CheckoutRequestID: "",
          ResultCode: 0,
          ResultDesc: "",
        },
      },
    },
    {
      Body: {
        stkCallback: {
          MerchantRequestID: "m",
          CheckoutRequestID: "c",
          ResultCode: "0",
          ResultDesc: "",
        },
      },
    },
  ])("rejects malformed bodies (%#)", (body) => {
    expect(stkCallbackSchema.safeParse(body).success).toBe(false);
  });
});

describe("mock mode", () => {
  it("chooses the outcome from the phone number", () => {
    expect(mockResultCode("254700001032")).toBe(1032);
    expect(mockResultCode("254700000001")).toBe(1);
    expect(mockResultCode("254712345678")).toBe(0);
  });
  it("makes 10-character receipts", () => {
    expect(mockReceipt(() => 0)).toBe("NXTAAAAAAA");
    expect(mockReceipt()).toMatch(/^NXT[A-Z2-9]{7}$/);
  });
});

describe("resultMessage", () => {
  it("is friendly", () => {
    expect(resultMessage("succeeded")).toBe("Paid");
    expect(resultMessage("failed", "Insufficient funds")).toBe("Not paid: Insufficient funds");
    expect(resultMessage("failed")).toBe("Not paid");
  });
});
