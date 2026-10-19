import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Logo } from "@/components/logo";
import { getMemberships, requireUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { OnboardingForm, type PresetOption } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your business" };

// jsonb comes back typed as `Json`; parse it into a precise shape at the boundary.
const presetServices = z.array(
  z.object({ name: z.string(), duration_minutes: z.number(), price_cents: z.number() }),
);

const ORDER = ["salon", "tutor", "cleaner", "mechanic", "clinic", "photographer", "general"];

export default async function OnboardingPage() {
  const { supabase } = await requireUser("/onboarding");
  if ((await getMemberships()).length > 0) redirect("/dashboard");

  const { data, error } = await supabase
    .from("business_type_presets")
    .select("business_type, label, services");
  if (error) throw error;

  const presets: PresetOption[] = data
    .map((p) => ({
      type: p.business_type,
      label: p.label,
      services: presetServices.catch([]).parse(p.services),
    }))
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));

  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-10">
      <Logo className="mb-10" />
      <p className="eyebrow">Step 1 of 1</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
        Set up your business
      </h1>
      <p className="mt-2 mb-8 text-muted">Takes about a minute. Customers book you at your link.</p>
      <OnboardingForm presets={presets} siteHost={new URL(publicEnv.NEXT_PUBLIC_SITE_URL).host} />
    </main>
  );
}
