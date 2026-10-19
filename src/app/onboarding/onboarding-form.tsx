"use client";

import { useActionState, useState } from "react";
import { formatKES } from "@/lib/money";
import { slugify, type BusinessType } from "@/lib/validation/schemas";
import { createBusiness, type OnboardingState } from "./actions";

export type PresetOption = {
  type: BusinessType;
  label: string;
  services: { name: string; duration_minutes: number; price_cents: number }[];
};

export function OnboardingForm({
  presets,
  siteHost,
}: {
  presets: PresetOption[];
  siteHost: string;
}) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createBusiness, {
    errors: {},
  });
  const [type, setType] = useState<BusinessType>(presets[0]?.type ?? "general");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const shownSlug = slugTouched ? slug : slugify(name);
  const selected = presets.find((p) => p.type === type);
  const errors = state.errors;

  return (
    <form action={action} className="space-y-8">
      <fieldset>
        <legend className="text-lg font-bold">What kind of business is it?</legend>
        <p className="mt-1 mb-4 text-sm text-muted">
          We&rsquo;ll set up typical services and hours. You can change everything later.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {presets.map((p) => (
            <label
              key={p.type}
              className="relative flex cursor-pointer flex-col rounded-xl border border-line bg-surface p-4 has-checked:border-brand has-checked:ring-2 has-checked:ring-brand has-focus-visible:outline-3 has-focus-visible:outline-[var(--focus)]"
            >
              <input
                type="radio"
                name="businessType"
                value={p.type}
                checked={type === p.type}
                onChange={() => setType(p.type)}
                className="sr-only"
              />
              <span className="font-semibold">{p.label}</span>
              <span className="mt-1 text-xs text-muted">{p.services.length} starter services</span>
            </label>
          ))}
        </div>
        {selected && selected.services.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-xl bg-surface-2 px-4 text-sm">
            {selected.services.map((s) => (
              <li key={s.name} className="flex justify-between gap-4 py-2">
                <span>{s.name}</span>
                <span className="shrink-0 text-muted">
                  {s.duration_minutes} min · {formatKES(s.price_cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className="label">
            Business name
          </label>
          <input
            id="name"
            name="name"
            required
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Wanjiru's Salon"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "name-error" : undefined}
          />
          {errors.name && (
            <p id="name-error" className="field-error">
              {errors.name}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="slug" className="label">
            Booking page link
          </label>
          <div className="flex items-center rounded-xl border border-line bg-surface focus-within:border-ink">
            <span className="pl-3.5 text-sm text-muted">{siteHost}/b/</span>
            <input
              id="slug"
              name="slug"
              required
              className="min-h-11 w-full min-w-0 bg-transparent pr-3.5 text-base outline-none"
              value={shownSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              aria-invalid={Boolean(errors.slug)}
              aria-describedby="slug-hint"
            />
          </div>
          <p id="slug-hint" className={errors.slug ? "field-error" : "mt-1.5 text-sm text-muted"}>
            {errors.slug ?? "Lowercase letters, numbers and dashes."}
          </p>
        </div>

        <div>
          <label htmlFor="phone" className="label">
            Business phone <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="input"
            placeholder="0712 345 678"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "phone-error" : undefined}
          />
          {errors.phone && (
            <p id="phone-error" className="field-error">
              {errors.phone}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="displayName" className="label">
            Your name <span className="font-normal text-muted">(shown to customers)</span>
          </label>
          <input
            id="displayName"
            name="displayName"
            autoComplete="name"
            className="input"
            placeholder="Wanjiru"
          />
        </div>
      </div>

      {errors._form && (
        <p role="alert" className="field-error">
          {errors._form}
        </p>
      )}
      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? "Setting up…" : "Create my business"}
      </button>
    </form>
  );
}
