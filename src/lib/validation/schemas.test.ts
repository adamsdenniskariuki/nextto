import { describe, expect, it } from "vitest";
import {
  emailSchema,
  inviteSchema,
  loginSchema,
  onboardingSchema,
  SLUG_PATTERN,
  slugify,
} from "./schemas";

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse("  Wanjiru@Example.CO.KE ")).toBe("wanjiru@example.co.ke");
  });
  it("rejects junk", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("slugify", () => {
  it.each([
    ["Mama Njeri's Salon & Spa", "mama-njeris-salon-spa"],
    ["  Café Ölé  ", "cafe-ole"],
    ["KCSE Tutors 2026!", "kcse-tutors-2026"],
  ])("%j -> %j", (input, expected) => {
    const slug = slugify(input);
    expect(slug).toBe(expected);
    expect(slug).toMatch(SLUG_PATTERN);
  });

  it("caps length at 40 without a trailing dash", () => {
    const slug = slugify("a".repeat(39) + " b");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("loginSchema", () => {
  it("defaults next to /dashboard and blocks open redirects", () => {
    expect(loginSchema.parse({ email: "a@b.co" }).next).toBe("/dashboard");
    expect(loginSchema.parse({ email: "a@b.co", next: "//evil.example" }).next).toBe("/dashboard");
    expect(loginSchema.parse({ email: "a@b.co", next: "/\\evil.example" }).next).toBe("/dashboard");
    expect(loginSchema.parse({ email: "a@b.co", next: "/invite/x" }).next).toBe("/invite/x");
  });
});

describe("onboardingSchema", () => {
  const base = { name: "Wanjiru's Salon", slug: "wanjirus-salon", businessType: "salon" };

  it("accepts a minimal form and normalises the phone", () => {
    const out = onboardingSchema.parse({ ...base, phone: "0712 345 678" });
    expect(out.phone).toBe("+254712345678");
  });

  it("treats an empty phone as absent", () => {
    expect(onboardingSchema.parse({ ...base, phone: "" }).phone).toBeUndefined();
  });

  it("rejects a bad slug, type and phone", () => {
    const r = onboardingSchema.safeParse({
      ...base,
      slug: "-bad-",
      businessType: "bakery",
      phone: "123",
    });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["slug", "businessType", "phone"]));
  });
});

describe("inviteSchema", () => {
  it("defaults role to staff", () => {
    const out = inviteSchema.parse({
      businessId: "7b0c1c3e-3f0a-4d4e-9a55-2f3c8a1b2c3d",
      email: "Staff@Example.com",
    });
    expect(out).toMatchObject({ role: "staff", email: "staff@example.com" });
  });
});
