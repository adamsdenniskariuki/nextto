"use client";

import { useActionState, useState } from "react";
import { MANUAL_PAYMENT_METHODS } from "@/lib/validation/invoices";
import type { FormState } from "../../bookings/actions";
import { FieldError, Feedback } from "../../form-feedback";
import {
  convertQuote,
  declineQuote,
  deleteDraft,
  issueInvoice,
  recordPayment,
  voidInvoice,
} from "../actions";

const idle: FormState = { status: "idle" };
type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** A one-button form for a document action, with its own pending + feedback state. */
function ActionButton({
  invoiceId,
  action,
  label,
  pendingLabel,
  className = "btn-secondary",
}: {
  invoiceId: string;
  action: Action;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button type="submit" className={className} disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** An irreversible action behind a <details> "are you sure?" step (works without JS). */
function ConfirmButton(props: {
  invoiceId: string;
  action: Action;
  summary: string;
  warning: string;
  label: string;
  pendingLabel: string;
}) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-danger">{props.summary}</summary>
      <div className="mt-2 space-y-2">
        <p className="text-sm text-muted">{props.warning}</p>
        <ActionButton {...props} className="btn-secondary text-danger" />
      </div>
    </details>
  );
}

export function IssueButton({ invoiceId, isQuote }: { invoiceId: string; isQuote: boolean }) {
  return (
    <ActionButton
      invoiceId={invoiceId}
      action={issueInvoice}
      label={isQuote ? "Issue quote" : "Issue invoice"}
      pendingLabel="Issuing…"
      className="btn-primary"
    />
  );
}

export function DeleteDraftButton({ invoiceId }: { invoiceId: string }) {
  return (
    <ConfirmButton
      invoiceId={invoiceId}
      action={deleteDraft}
      summary="Delete draft…"
      warning="Drafts have no number yet, so deleting leaves no gap."
      label="Yes, delete draft"
      pendingLabel="Deleting…"
    />
  );
}

export function VoidButton({ invoiceId }: { invoiceId: string }) {
  return (
    <ConfirmButton
      invoiceId={invoiceId}
      action={voidInvoice}
      summary="Void invoice…"
      warning="Voiding is final. The number stays on record so the sequence has no gaps."
      label="Yes, void it"
      pendingLabel="Voiding…"
    />
  );
}

export function QuoteActions({ invoiceId }: { invoiceId: string }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionButton
        invoiceId={invoiceId}
        action={convertQuote}
        label="Accept → invoice"
        pendingLabel="Converting…"
        className="btn-primary"
      />
      <ActionButton
        invoiceId={invoiceId}
        action={declineQuote}
        label="Mark declined"
        pendingLabel="Saving…"
      />
    </div>
  );
}

export function PaymentForm({ invoiceId, suggested }: { invoiceId: string; suggested: string }) {
  const [state, action, pending] = useActionState(recordPayment, idle);
  const errors = state.status === "error" ? state.errors : {};
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const describedBy = (name: string) => (errors[name] ? `pay-${name}-error` : undefined);

  return (
    <form action={action} className="space-y-3" aria-label="Record a payment" noValidate>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="pay-amount" className="label">
            Amount (KES)
          </label>
          <input
            // Remount when the balance changes, so the suggestion stays current.
            key={suggested}
            id="pay-amount"
            name="amount"
            inputMode="decimal"
            defaultValue={v.amount ?? suggested}
            className="input"
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={describedBy("amount")}
          />
          <FieldError id="pay-amount-error" message={errors.amount} />
        </div>
        <div>
          <label htmlFor="pay-method" className="label">
            Paid by
          </label>
          <select
            id="pay-method"
            name="method"
            defaultValue={v.method ?? "cash"}
            className="input"
            aria-describedby={describedBy("method")}
          >
            {Object.entries(MANUAL_PAYMENT_METHODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError id="pay-method-error" message={errors.method} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pay-reference" className="label">
            Reference <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="pay-reference"
            name="reference"
            maxLength={100}
            defaultValue={v.reference}
            placeholder="Receipt or transfer reference"
            className="input"
            aria-describedby={describedBy("reference")}
          />
          <FieldError id="pay-reference-error" message={errors.reference} />
        </div>
      </div>
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Recording…" : "Record payment"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Copy-to-clipboard needs the browser, hence this small client island. */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </>
  );
}
