import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this file from a Client Component fails the
 * build (that's what `server-only` does), so a secret can't reach a browser
 * bundle by accident.
 *
 * Each getter parses lazily, on first use: `next build` and pages that never
 * touch M-Pesa work without these variables set.
 */

const serviceRoleSchema = z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is not set");

export function serviceRoleKey(): string {
  return serviceRoleSchema.parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const mpesaSchema = z
  .discriminatedUnion("MPESA_ENV", [
    // No network: fake ids, then a simulated callback (local dev, CI, demos).
    z.object({
      MPESA_ENV: z.literal("mock"),
      MPESA_CALLBACK_SECRET: z.string().min(8),
    }),
    z.object({
      MPESA_ENV: z.enum(["sandbox", "production"]),
      MPESA_CONSUMER_KEY: z.string().min(1),
      MPESA_CONSUMER_SECRET: z.string().min(1),
      MPESA_SHORTCODE: z.string().regex(/^\d{5,7}$/, "MPESA_SHORTCODE must be 5–7 digits"),
      MPESA_PASSKEY: z.string().min(1),
      MPESA_CALLBACK_SECRET: z.string().min(16),
      MPESA_CALLBACK_URL: z.url().startsWith("https://", "MPESA_CALLBACK_URL must be HTTPS"),
    }),
  ])
  .superRefine((env, ctx) => {
    // The route only answers on /api/mpesa/callback/<secret>; a URL that points
    // anywhere else would make every real callback 404 without anyone noticing.
    if (
      env.MPESA_ENV !== "mock" &&
      !env.MPESA_CALLBACK_URL.endsWith(`/api/mpesa/callback/${env.MPESA_CALLBACK_SECRET}`)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MPESA_CALLBACK_URL"],
        message: "MPESA_CALLBACK_URL must end with /api/mpesa/callback/<MPESA_CALLBACK_SECRET>",
      });
    }
  });

export type MpesaConfig = z.infer<typeof mpesaSchema>;

const readMpesaEnv = () => ({
  MPESA_ENV: process.env.MPESA_ENV,
  MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE: process.env.MPESA_SHORTCODE,
  MPESA_PASSKEY: process.env.MPESA_PASSKEY,
  MPESA_CALLBACK_SECRET: process.env.MPESA_CALLBACK_SECRET,
  MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL,
});

let cached: MpesaConfig | undefined;

export function mpesaConfig(): MpesaConfig {
  cached ??= mpesaSchema.parse(readMpesaEnv());
  return cached;
}

/** True when M-Pesa is configured, so pages can hide the buttons otherwise. */
export function mpesaEnabled(): boolean {
  return (
    mpesaSchema.safeParse(readMpesaEnv()).success && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

/**
 * Optional allow-list of source IPs for the Daraja callback (comma-separated).
 * Empty means "don't check": the secret URL and idempotent SQL still apply.
 */
export function mpesaCallbackAllowedIps(): string[] {
  return (process.env.MPESA_CALLBACK_ALLOWED_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
