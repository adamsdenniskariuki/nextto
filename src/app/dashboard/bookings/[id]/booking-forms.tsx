"use client";

import { useActionState } from "react";
import { NEXT_STATUSES, type BookingStatus } from "@/lib/booking-status";
import { Feedback } from "../../form-feedback";
import { changeStatus, rescheduleBooking, saveBookingNotes, type FormState } from "../actions";

const idle: FormState = { status: "idle" };

function statusButtonLabel(from: BookingStatus, to: BookingStatus): string {
  switch (to) {
    case "confirmed":
      return from === "pending" ? "Confirm" : "Undo: back to confirmed";
    case "completed":
      return "Mark completed";
    case "no_show":
      return "Mark no-show";
    default:
      return to;
  }
}

export function StatusForm({ bookingId, status }: { bookingId: string; status: BookingStatus }) {
  const [state, action, pending] = useActionState(changeStatus, idle);
  const next = NEXT_STATUSES[status];
  if (next.length === 0)
    return <p className="text-sm text-muted">Cancelled bookings can&apos;t be changed.</p>;

  return (
    <form action={action} className="space-y-3" aria-label="Change status">
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="flex flex-wrap gap-2">
        {next
          .filter((s) => s !== "cancelled")
          .map((s) => (
            <button
              key={s}
              type="submit"
              name="status"
              value={s}
              className="btn-secondary"
              disabled={pending}
            >
              {statusButtonLabel(status, s)}
            </button>
          ))}
      </div>
      {next.includes("cancelled") && (
        // <details> gives a no-JS "are you sure?" step for the one irreversible change.
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-danger">
            Cancel booking…
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">Cancelling is final and frees the time.</p>
            <button
              type="submit"
              name="status"
              value="cancelled"
              className="btn-secondary text-danger"
              disabled={pending}
            >
              Yes, cancel booking
            </button>
          </div>
        </details>
      )}
      <Feedback state={state} />
    </form>
  );
}

export function RescheduleForm({
  bookingId,
  date,
  time,
  staffId,
  staff,
}: {
  bookingId: string;
  date: string;
  time: string;
  staffId: string;
  staff: { id: string; display_name: string }[];
}) {
  const [state, action, pending] = useActionState(rescheduleBooking, idle);
  const errors = state.status === "error" ? state.errors : {};
  const v = state.status === "error" ? (state.values ?? {}) : {};

  return (
    <form action={action} className="space-y-3" aria-label="Reschedule">
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="r-date" className="label">
            Date
          </label>
          <input
            id="r-date"
            name="date"
            type="date"
            required
            defaultValue={v.date ?? date}
            className="input"
            aria-describedby={errors.date ? "r-date-error" : undefined}
          />
          {errors.date && (
            <p id="r-date-error" className="field-error">
              {errors.date}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="r-time" className="label">
            Time
          </label>
          <input
            id="r-time"
            name="time"
            type="time"
            step={300}
            required
            defaultValue={v.time ?? time}
            className="input"
            aria-invalid={Boolean(errors.time)}
            aria-describedby={errors.time ? "r-time-error" : undefined}
          />
        </div>
        <div>
          <label htmlFor="r-staff" className="label">
            With
          </label>
          <select id="r-staff" name="staffId" defaultValue={v.staffId ?? staffId} className="input">
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {errors.time && (
        <p id="r-time-error" className="field-error">
          {errors.time}
        </p>
      )}
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Moving…" : "Move booking"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function NotesForm({ bookingId, notes }: { bookingId: string; notes: string | null }) {
  const [state, action, pending] = useActionState(saveBookingNotes, idle);
  const errors = state.status === "error" ? state.errors : {};
  const value = state.status === "error" ? state.values?.notes : undefined;

  return (
    <form action={action} className="space-y-3" aria-label="Booking notes">
      <input type="hidden" name="bookingId" value={bookingId} />
      <label htmlFor="booking-notes" className="label">
        Notes
      </label>
      <textarea
        // Remount after a save so the textarea shows the stored value.
        key={notes ?? ""}
        id="booking-notes"
        name="notes"
        rows={3}
        maxLength={500}
        defaultValue={value ?? notes ?? ""}
        className="input"
        aria-describedby={errors.notes ? "booking-notes-error" : undefined}
      />
      {errors.notes && (
        <p id="booking-notes-error" className="field-error">
          {errors.notes}
        </p>
      )}
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Saving…" : "Save notes"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
