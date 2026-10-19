"use client";

import { useActionState, useId, useRef, useState } from "react";
import { dayParts, formatDayLong, formatDuration, formatTime } from "@/lib/datetime";
import { formatKES } from "@/lib/money";
import {
  slotsResponseSchema,
  type PublicService,
  type PublicStaff,
  type Slot,
} from "@/lib/validation/booking";
import { bookAppointment, type BookingState } from "./actions";

type Props = {
  slug: string;
  businessId: string;
  timeZone: string;
  services: PublicService[];
  staff: PublicStaff[];
  staffLabel: string;
  days: string[];
};

type SlotsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; slots: Slot[] };

/**
 * The interactive part of the booking page: service → staff → day → time →
 * details. Everything lives in ONE <form>, so the Server Action receives
 * the choices as ordinary form fields (radio buttons and a select).
 *
 * Slots are fetched from event handlers rather than a useEffect: the fetch
 * happens *because the visitor picked something*, so the handler is the
 * natural place for it. ("You might not need an effect", react.dev.)
 */
export function BookingFlow({
  slug,
  businessId,
  timeZone,
  services,
  staff,
  staffLabel,
  days,
}: Props) {
  const [serviceId, setServiceId] = useState(services.length === 1 ? services[0]!.id : "");
  const [staffId, setStaffId] = useState("");
  const [day, setDay] = useState(days[0]!);
  const [startsAt, setStartsAt] = useState("");
  const [slots, setSlots] = useState<SlotsState>({ status: "idle" });
  const request = useRef<AbortController | null>(null);
  const ids = useId();

  const service = services.find((s) => s.id === serviceId);
  const eligibleStaff = service ? staff.filter((m) => service.staff_ids.includes(m.id)) : [];

  async function loadSlots(next: { serviceId: string; staffId: string; day: string }) {
    setStartsAt("");
    if (!next.serviceId) return setSlots({ status: "idle" });

    // Cancel a slower, older request so it can't overwrite newer results.
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSlots({ status: "loading" });

    const qs = new URLSearchParams({
      business: businessId,
      service: next.serviceId,
      day: next.day,
      staff: next.staffId,
    });
    try {
      const res = await fetch(`/api/slots?${qs}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { slots } = slotsResponseSchema.parse(await res.json());
      setSlots({ status: "ready", slots });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setSlots({ status: "error" });
    }
  }

  const [state, formAction, pending] = useActionState<BookingState, FormData>(
    async (prev, formData) => {
      const result = await bookAppointment(prev, formData);
      // Someone else got the slot first: refresh the times for this day.
      if (result.status === "error" && result.slotTaken) {
        await loadSlots({ serviceId, staffId, day });
      }
      return result;
    },
    { status: "idle" },
  );
  const errors = state.status === "error" ? state.errors : {};
  const values = state.status === "error" ? state.values : {};

  // With "anyone", several staff can share a start time; show each time once.
  const times =
    slots.status === "ready" ? [...new Set(slots.slots.map((s) => s.startsAt))] : ([] as string[]);

  return (
    <form action={formAction} noValidate className="space-y-6" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="sr-only">
        Book a time
      </h2>
      <input type="hidden" name="slug" value={slug} />

      {/* 1. Service */}
      <fieldset className="card">
        <legend className="float-left mb-3 text-lg font-bold">
          <Step n={1} /> Choose a service
        </legend>
        <div className="clear-both grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <label
              key={s.id}
              className="relative flex cursor-pointer flex-col rounded-xl border border-line p-3 transition-colors hover:border-ink has-checked:border-brand has-checked:bg-brand-soft has-focus-visible:ring-2 has-focus-visible:ring-brand"
            >
              <input
                type="radio"
                name="serviceId"
                value={s.id}
                checked={serviceId === s.id}
                onChange={() => {
                  const keepStaff = staffId && s.staff_ids.includes(staffId) ? staffId : "";
                  setServiceId(s.id);
                  setStaffId(keepStaff);
                  void loadSlots({ serviceId: s.id, staffId: keepStaff, day });
                }}
                className="sr-only"
              />
              <span className="flex justify-between gap-3 font-semibold">
                {s.name}
                <span className="shrink-0">{formatKES(s.price_cents)}</span>
              </span>
              <span className="text-sm text-muted">
                {formatDuration(s.duration_minutes)}
                {s.deposit_cents > 0 && ` · ${formatKES(s.deposit_cents)} deposit`}
              </span>
              {s.description && <span className="mt-1 text-sm text-muted">{s.description}</span>}
            </label>
          ))}
        </div>
        <FieldError id={`${ids}-service-error`} message={errors.serviceId} />
      </fieldset>

      {/* 2. Staff (only when there's a real choice) */}
      {service && eligibleStaff.length > 1 && (
        <div className="card">
          <label htmlFor={`${ids}-staff`} className="mb-3 block text-lg font-bold">
            <Step n={2} /> Choose a {staffLabel.toLowerCase()}
          </label>
          <select
            id={`${ids}-staff`}
            name="staffId"
            value={staffId}
            onChange={(e) => {
              setStaffId(e.target.value);
              void loadSlots({ serviceId, staffId: e.target.value, day });
            }}
            className="input"
          >
            <option value="">Anyone available</option>
            {eligibleStaff.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 3. Day and time */}
      {service && (
        <fieldset className="card">
          <legend className="float-left mb-3 text-lg font-bold">
            <Step n={eligibleStaff.length > 1 ? 3 : 2} /> Pick a day and time
          </legend>
          <div
            role="radiogroup"
            aria-label="Day"
            className="clear-both grid grid-cols-7 gap-1.5 sm:gap-2"
          >
            {days.map((d) => {
              const { weekday, date } = dayParts(d);
              return (
                <label
                  key={d}
                  className="relative flex cursor-pointer flex-col items-center rounded-xl border border-line px-1 py-2 text-xs sm:text-sm hover:border-ink has-checked:border-ink has-checked:bg-ink has-checked:text-bg has-focus-visible:ring-2 has-focus-visible:ring-brand"
                >
                  <input
                    type="radio"
                    name="day"
                    value={d}
                    checked={day === d}
                    onChange={() => {
                      setDay(d);
                      void loadSlots({ serviceId, staffId, day: d });
                    }}
                    className="sr-only"
                    aria-label={formatDayLong(d)}
                  />
                  <span className="font-semibold">{weekday}</span>
                  <span>{date}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-4" aria-live="polite" aria-busy={slots.status === "loading"}>
            {slots.status === "idle" && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void loadSlots({ serviceId, staffId, day })}
              >
                Show times for {formatDayLong(day)}
              </button>
            )}
            {slots.status === "loading" && <p className="text-muted">Finding free times…</p>}
            {slots.status === "error" && (
              <p className="field-error">Couldn&apos;t load times. Check your connection.</p>
            )}
            {slots.status === "ready" && times.length === 0 && (
              <p className="text-muted">No free times on {formatDayLong(day)}. Try another day.</p>
            )}
            {slots.status === "ready" && times.length > 0 && (
              <div role="radiogroup" aria-label={`Times on ${formatDayLong(day)}`}>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {times.map((t) => (
                    <label
                      key={t}
                      className="relative cursor-pointer rounded-lg border border-line py-2 text-center text-sm font-semibold tabular-nums hover:border-ink has-checked:border-brand has-checked:bg-brand has-checked:text-brand-ink has-focus-visible:ring-2 has-focus-visible:ring-brand"
                    >
                      <input
                        type="radio"
                        name="startsAt"
                        value={t}
                        checked={startsAt === t}
                        onChange={() => setStartsAt(t)}
                        className="sr-only"
                      />
                      {formatTime(t, timeZone)}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">Times are in Nairobi time (EAT).</p>
              </div>
            )}
          </div>
          <FieldError id={`${ids}-time-error`} message={errors.startsAt} />
        </fieldset>
      )}

      {/* 4. Details */}
      {service && startsAt && (
        <fieldset className="card space-y-4">
          <legend className="float-left text-lg font-bold">
            <Step n={eligibleStaff.length > 1 ? 4 : 3} /> Your details
          </legend>
          <div className="clear-both grid gap-4 sm:grid-cols-2">
            <TextField
              id={`${ids}-name`}
              name="name"
              label="Full name"
              autoComplete="name"
              defaultValue={values?.name}
              error={errors.name}
            />
            <TextField
              id={`${ids}-phone`}
              name="phone"
              label="Phone (M-Pesa)"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0712 345 678"
              defaultValue={values?.phone}
              error={errors.phone}
            />
            <TextField
              id={`${ids}-email`}
              name="email"
              label="Email (optional)"
              type="email"
              inputMode="email"
              autoComplete="email"
              defaultValue={values?.email}
              error={errors.email}
              required={false}
            />
            <div className="sm:col-span-2">
              <label htmlFor={`${ids}-notes`} className="label">
                Notes (optional)
              </label>
              <textarea
                id={`${ids}-notes`}
                name="notes"
                rows={2}
                maxLength={500}
                defaultValue={values?.notes}
                className="input min-h-20"
              />
              <FieldError id={`${ids}-notes-error`} message={errors.notes} />
            </div>
          </div>

          <div className="rounded-xl bg-surface-2 p-4 text-sm">
            <p className="font-semibold">
              {service.name} · {formatDayLong(day)} at {formatTime(startsAt, timeZone)}
            </p>
            <p className="mt-1 text-muted">
              {formatDuration(service.duration_minutes)} · {formatKES(service.price_cents)}
              {service.deposit_cents > 0 &&
                `. A ${formatKES(service.deposit_cents)} M-Pesa deposit secures your booking.`}
            </p>
          </div>

          {errors._form && (
            <p role="alert" className="field-error">
              {errors._form}
            </p>
          )}
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
            {pending ? "Booking…" : "Confirm booking"}
          </button>
        </fieldset>
      )}
    </form>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="mr-2 inline-grid size-7 place-items-center rounded-full bg-ink text-sm text-bg"
    >
      {n}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error clear-both">
      {message}
    </p>
  );
}

function TextField({
  id,
  name,
  label,
  error,
  required = true,
  ...rest
}: {
  id: string;
  name: string;
  label: string;
  error: string | undefined;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        required={required}
        className="input"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...rest}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
