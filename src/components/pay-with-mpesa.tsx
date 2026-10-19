"use client";

import { useActionState } from "react";

export type PayState = { status: "idle" } | { status: "ok" | "error"; message: string };

const idle: PayState = { status: "idle" };

/**
 * A one-button form for guests: "Pay Ksh 500 with M-Pesa". The server action
 * (passed in as a prop: Server Actions are serialisable references) always
 * sends the prompt to the phone on file, never to a number typed here.
 */
export function PayWithMpesaButton({
  action,
  fieldName,
  fieldValue,
  label,
}: {
  action: (prev: PayState, formData: FormData) => Promise<PayState>;
  fieldName: string;
  fieldValue: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name={fieldName} value={fieldValue} />
      <button type="submit" className="btn-mpesa w-full sm:w-auto" disabled={pending}>
        {pending ? "Sending the prompt…" : label}
      </button>
      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={state.status === "error" ? "field-error" : "text-sm text-mpesa"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
