"use client";

import { useActionState } from "react";
import { inviteMember, type InviteState } from "./actions";

export function InviteForm({ businessId }: { businessId: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteMember, {
    status: "idle",
  });
  const errors = state.status === "error" ? state.errors : {};

  return (
    <form action={action} className="space-y-3" aria-label="Invite a team member">
      <input type="hidden" name="businessId" value={businessId} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="invite-email" className="sr-only">
            Email
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="colleague@example.co.ke"
            className="input"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "invite-email-error" : undefined}
          />
        </div>
        <label htmlFor="invite-role" className="sr-only">
          Role
        </label>
        <select id="invite-role" name="role" defaultValue="staff" className="input sm:w-32">
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      {errors.email && (
        <p id="invite-email-error" className="field-error">
          {errors.email}
        </p>
      )}
      {errors._form && (
        <p role="alert" className="field-error">
          {errors._form}
        </p>
      )}
      {state.status === "sent" && (
        <p role="status" className="text-sm text-mpesa">
          Invitation emailed to {state.email}.
        </p>
      )}
    </form>
  );
}
