"use client";

import { useActionState } from "react";
import type { FormState } from "../../bookings/actions";
import { saveCustomerNotes } from "../actions";

export function CustomerNotesForm({
  customerId,
  notes,
}: {
  customerId: string;
  notes: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCustomerNotes, {
    status: "idle",
  });
  const errors = state.status === "error" ? state.errors : {};
  const value = state.status === "error" ? state.values?.notes : undefined;

  return (
    <form action={action} className="space-y-3" aria-label="Customer notes">
      <input type="hidden" name="customerId" value={customerId} />
      <label htmlFor="customer-notes" className="label">
        Notes
      </label>
      <textarea
        key={notes ?? ""}
        id="customer-notes"
        name="notes"
        rows={4}
        maxLength={2000}
        placeholder="Allergies, preferences, the car's registration…"
        defaultValue={value ?? notes ?? ""}
        className="input"
        aria-describedby={errors.notes ? "customer-notes-error" : undefined}
      />
      {errors.notes && (
        <p id="customer-notes-error" className="field-error">
          {errors.notes}
        </p>
      )}
      {errors._form && (
        <p className="field-error" role="alert">
          {errors._form}
        </p>
      )}
      {state.status === "ok" && (
        <p role="status" className="text-sm text-mpesa">
          {state.message}
        </p>
      )}
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Saving…" : "Save notes"}
      </button>
    </form>
  );
}
