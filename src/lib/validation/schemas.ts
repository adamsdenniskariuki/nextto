/**
 * Zod schemas shared by client components (instant feedback) and server
 * actions (the real check). Never trust the client: every server action
 * re-parses its input with the same schema.
 */
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { normalizeKenyanPhone } from "@/lib/phone";
import { safeNextPath } from "@/lib/safe-redirect";

// A placeholder origin: only relative paths resolve against it, so anything absolute is rejected.
const RELATIVE_ONLY = "http://relative.invalid";

export type BusinessType = Database["public"]["Enums"]["business_type"];

// `satisfies` makes TypeScript fail if the generated enum and this list drift apart.
export const BUSINESS_TYPES = [
  "salon",
  "tutor",
  "cleaner",
  "mechanic",
  "clinic",
  "photographer",
  "general",
] as const satisfies readonly BusinessType[];

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }));

/** Kenyan-friendly phone input, output normalised to E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const e164 = normalizeKenyanPhone(value);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "Enter a phone number like 0712 345 678" });
      return z.NEVER;
    }
    return e164;
  });

// Must match the CHECK constraint on public.businesses.slug.
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, "3–40 characters: lowercase letters, numbers and dashes");

/** "Mama Njeri's Salon & Spa" -> "mama-njeris-salon-spa" */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export const loginSchema = z.object({
  email: emailSchema,
  next: z
    .string()
    .optional()
    // Only allow same-site relative paths to prevent open redirects.
    .transform((v) => safeNextPath(v, RELATIVE_ONLY)),
});

export const onboardingSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120),
  slug: slugSchema,
  businessType: z.enum(BUSINESS_TYPES),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(phoneSchema.optional()),
  displayName: z.string().trim().max(80).optional(),
});

export const inviteSchema = z.object({
  businessId: z.uuid(),
  email: emailSchema,
  role: z.enum(["staff", "owner"]).default("staff"),
});

export type LoginInput = z.input<typeof loginSchema>;
export type OnboardingInput = z.output<typeof onboardingSchema>;
export type InviteInput = z.output<typeof inviteSchema>;

/** Flatten Zod errors into { field: "first message" } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}
