"use client";

import { useActionState } from "react";
import type { FormState } from "./bookings/actions";
import { FieldError, Feedback } from "./form-feedback";
import { requestMpesaPayment } from "./mpesa-actions";

const idle: FormState = { status: "idle" };

/**
 * "Send M-Pesa request": the phone pre-filled with the customer's number,
 * and (for invoices) an amount defaulting to what's due now.
 */
export function MpesaRequestForm(
  props: { phone: string } & (
    { invoiceId: string; suggestedAmount: string } | { bookingId: string; depositLabel: string }
  ),
) {
  const [state, action, pending] = useActionState(requestMpesaPayment, idle);
  const errors = state.status === "error" ? state.errors : {};
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const isInvoice = "invoiceId" in props;
  const describedBy = (name: string) => (errors[name] ? `mpesa-${name}-error` : undefined);

  return (
    <form action={action} className="space-y-3" aria-label="Request an M-Pesa payment" noValidate>
      {isInvoice ? (
        <input type="hidden" name="invoiceId" value={props.invoiceId} />
      ) : (
        <input type="hidden" name="bookingId" value={props.bookingId} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="mpesa-phone" className="label">
            M-Pesa phone
          </label>
          <input
            id="mpesa-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            defaultValue={v.phone ?? props.phone}
            className="input"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={describedBy("phone")}
          />
          <FieldError id="mpesa-phone-error" message={errors.phone} />
        </div>
        {isInvoice && (
          <div>
            <label htmlFor="mpesa-amount" className="label">
              Amount (KES)
            </label>
            <input
              key={props.suggestedAmount}
              id="mpesa-amount"
              name="amount"
              inputMode="numeric"
              defaultValue={v.amount ?? props.suggestedAmount}
              className="input"
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={describedBy("amount")}
            />
            <FieldError id="mpesa-amount-error" message={errors.amount} />
          </div>
        )}
      </div>
      <button type="submit" className="btn-mpesa" disabled={pending}>
        {pending
          ? "Sending…"
          : isInvoice
            ? "Send M-Pesa request"
            : `Request ${props.depositLabel} deposit`}
      </button>
      {!isInvoice && <FieldError id="mpesa-amount-error" message={errors.amount} />}
      <Feedback state={state} />
    </form>
  );
}
