"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  // useActionState wires a Server Action to the form and keeps its last result.
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {
    status: "idle",
  });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-xl bg-brand-soft p-4">
        <p className="font-semibold">Check your inbox</p>
        <p className="mt-1 text-sm">
          We sent a sign-in link to <strong>{state.email}</strong>. It expires in an hour.
        </p>
      </div>
    );
  }

  const errors = state.status === "error" ? state.errors : {};
  return (
    <form action={action} noValidate className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="you@example.co.ke"
          defaultValue={state.status === "error" ? state.email : undefined}
          className="input"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        {errors.email && (
          <p id="email-error" className="field-error">
            {errors.email}
          </p>
        )}
      </div>
      {errors._form && (
        <p role="alert" className="field-error">
          {errors._form}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
