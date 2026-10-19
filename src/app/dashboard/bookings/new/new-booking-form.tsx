"use client";

import { useActionState, useState } from "react";
import { formatDuration } from "@/lib/datetime";
import { formatKES } from "@/lib/money";
import { REPEAT_OPTIONS, type RepeatOption } from "@/lib/validation/dashboard";
import { createBooking, type FormState } from "../actions";

type Props = {
  businessId: string;
  services: { id: string; name: string; duration_minutes: number; price_cents: number }[];
  staff: { id: string; display_name: string }[];
  staffServices: { staff_id: string; service_id: string }[];
  customer?: { id: string; name: string; phone: string };
  defaults: { date: string; time: string; staffId?: string };
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}

export function NewBookingForm({
  businessId,
  services,
  staff,
  staffServices,
  customer,
  defaults,
}: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(createBooking, {
    status: "idle",
  });
  const errors = state.status === "error" ? state.errors : {};
  const v = state.status === "error" ? (state.values ?? {}) : {};

  // The staff list depends on the chosen service, so the service is state.
  const [serviceId, setServiceId] = useState(v.serviceId ?? services[0]?.id ?? "");
  const [repeat, setRepeat] = useState<RepeatOption>(
    (v.repeat as RepeatOption | undefined) ?? "none",
  );
  const offering = staff.filter((s) =>
    staffServices.some((l) => l.staff_id === s.id && l.service_id === serviceId),
  );
  const staffDefault =
    v.staffId ??
    (offering.some((s) => s.id === defaults.staffId) ? defaults.staffId : offering[0]?.id);

  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);

  return (
    <form action={action} className="card max-w-xl space-y-5" aria-label="New booking" noValidate>
      <input type="hidden" name="businessId" value={businessId} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Customer</legend>
        {customer ? (
          <>
            <input type="hidden" name="customerId" value={customer.id} />
            <p className="text-sm">
              <span className="font-medium">{customer.name}</span>{" "}
              <span className="text-muted">· {customer.phone}</span>
            </p>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="customerPhone" className="label">
                Phone
              </label>
              <input
                id="customerPhone"
                name="customerPhone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="0712 345 678"
                defaultValue={v.customerPhone}
                className="input"
                aria-invalid={Boolean(errors.customerPhone)}
                aria-describedby={describedBy("customerPhone")}
              />
              <FieldError id="customerPhone-error" message={errors.customerPhone} />
            </div>
            <div>
              <label htmlFor="customerName" className="label">
                Name
              </label>
              <input
                id="customerName"
                name="customerName"
                autoComplete="off"
                defaultValue={v.customerName}
                className="input"
                aria-invalid={Boolean(errors.customerName)}
                aria-describedby={describedBy("customerName") ?? "customerName-hint"}
              />
              <p id="customerName-hint" className="mt-1 text-xs text-muted">
                An existing customer with this phone keeps their saved name.
              </p>
              <FieldError id="customerName-error" message={errors.customerName} />
            </div>
          </div>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="serviceId" className="label">
            Service
          </label>
          <select
            id="serviceId"
            name="serviceId"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="input"
            aria-describedby={describedBy("serviceId")}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatDuration(s.duration_minutes)} · {formatKES(s.price_cents)}
              </option>
            ))}
          </select>
          <FieldError id="serviceId-error" message={errors.serviceId} />
        </div>
        <div>
          <label htmlFor="staffId" className="label">
            With
          </label>
          {/* key: remount when the service changes so the default re-applies. */}
          <select
            key={serviceId}
            id="staffId"
            name="staffId"
            defaultValue={staffDefault}
            className="input"
            aria-describedby={describedBy("staffId")}
          >
            {offering.length === 0 && <option value="">Nobody offers this service</option>}
            {offering.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
          <FieldError id="staffId-error" message={errors.staffId} />
        </div>
        <div>
          <label htmlFor="date" className="label">
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={v.date ?? defaults.date}
            className="input"
            aria-invalid={Boolean(errors.date)}
            aria-describedby={describedBy("date")}
          />
          <FieldError id="date-error" message={errors.date} />
        </div>
        <div>
          <label htmlFor="time" className="label">
            Time
          </label>
          <input
            id="time"
            name="time"
            type="time"
            step={300}
            required
            defaultValue={v.time ?? defaults.time}
            className="input"
            aria-invalid={Boolean(errors.time)}
            aria-describedby={describedBy("time")}
          />
          <FieldError id="time-error" message={errors.time} />
        </div>
        <div>
          <label htmlFor="repeat" className="label">
            Repeat
          </label>
          <select
            id="repeat"
            name="repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as RepeatOption)}
            className="input"
          >
            {Object.entries(REPEAT_OPTIONS).map(([key, o]) => (
              <option key={key} value={key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {repeat !== "none" && (
          <div>
            <label htmlFor="occurrences" className="label">
              Number of bookings
            </label>
            <input
              id="occurrences"
              name="occurrences"
              type="number"
              min={2}
              max={52}
              defaultValue={v.occurrences ?? "4"}
              className="input"
              aria-invalid={Boolean(errors.occurrences)}
              aria-describedby={describedBy("occurrences")}
            />
            <FieldError id="occurrences-error" message={errors.occurrences} />
          </div>
        )}
      </div>

      <div>
        <label htmlFor="notes" className="label">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={500}
          defaultValue={v.notes}
          className="input"
          aria-describedby={describedBy("notes")}
        />
        <FieldError id="notes-error" message={errors.notes} />
      </div>

      {errors._form && (
        <p className="field-error" role="alert">
          {errors._form}
        </p>
      )}

      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? "Booking…" : "Create booking"}
      </button>
    </form>
  );
}
