"use client";

import { useActionState, useId, useState } from "react";
import { invoiceTotals, lineTotalCents, parseQuantity } from "@/lib/invoice-math";
import { centsToInput, formatKES, parseKESToCents } from "@/lib/money";
import type { DocumentKind } from "@/lib/validation/invoices";
import type { FormState } from "../bookings/actions";
import { FieldError, Feedback } from "../form-feedback";
import { saveDraft } from "./actions";

type Row = { key: string; description: string; quantity: string; unitPrice: string };
export type EditorItem = Omit<Row, "key">;

type Props = {
  businessId: string;
  invoiceId?: string | undefined;
  bookingId?: string | undefined;
  kind: DocumentKind;
  customer?: { id: string; name: string; phone: string } | undefined;
  services: { id: string; name: string; price_cents: number }[];
  vatOptions: { bp: number; label: string }[];
  initial: {
    items: EditorItem[];
    vatRateBp: number;
    deposit: string;
    dueDate: string;
    notes: string;
  };
};

const blankRow = (): EditorItem => ({ description: "", quantity: "1", unitPrice: "" });

/**
 * The invoice / quote editor.
 *
 * Line items are React state (rows can be added and removed), and the whole
 * list is posted as ONE hidden JSON field. The server parses it with the same
 * Zod schema (lineItemInputSchema) and the totals here use the same integer
 * maths as Postgres (invoice-math.ts), so what you see is what gets saved.
 */
export function InvoiceEditor(props: Props) {
  const { businessId, invoiceId, bookingId, kind, customer, services, vatOptions, initial } = props;
  const [state, action, pending] = useActionState<FormState, FormData>(saveDraft, {
    status: "idle",
  });
  const errors = state.status === "error" ? state.errors : {};
  const v = state.status === "error" ? (state.values ?? {}) : {};
  const uid = useId();

  const [rows, setRows] = useState<Row[]>(() =>
    (initial.items.length ? initial.items : [blankRow()]).map((it, i) => ({
      ...it,
      key: `${uid}-${i}`,
    })),
  );
  const [counter, setCounter] = useState(rows.length);
  const [vatRateBp, setVatRateBp] = useState(Number(v.vatRateBp ?? initial.vatRateBp));

  const addRow = (it: EditorItem = blankRow()) => {
    setRows((r) => [...r, { ...it, key: `${uid}-n${counter}` }]);
    setCounter((c) => c + 1);
  };
  const update = (key: string, patch: Partial<EditorItem>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => setRows((r) => r.filter((row) => row.key !== key));

  // Live totals: rows that don't parse yet simply count as zero.
  const parsedLines = rows.map((r) => ({
    quantityHundredths: parseQuantity(r.quantity) ?? 0,
    unitPriceCents: parseKESToCents(r.unitPrice) ?? 0,
  }));
  const totals = invoiceTotals(parsedLines, vatRateBp);
  const itemsJson = JSON.stringify(
    rows.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
  );
  const describedBy = (name: string) => (errors[name] ? `${name}-error` : undefined);
  const noun = kind === "quote" ? "quote" : "invoice";

  return (
    <form action={action} className="space-y-6" aria-label={`Edit ${noun}`} noValidate>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="kind" value={kind} />
      {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
      {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}
      <input type="hidden" name="items" value={itemsJson} />

      <fieldset className="card min-w-0 space-y-3">
        <legend className="sr-only">Customer</legend>
        <h2 className="text-lg font-bold">Customer</h2>
        {customer ? (
          <p className="text-sm">
            <input type="hidden" name="customerId" value={customer.id} />
            <span className="font-medium">{customer.name}</span>{" "}
            <span className="text-muted">· {customer.phone}</span>
          </p>
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
                aria-describedby={describedBy("customerName")}
              />
              <FieldError id="customerName-error" message={errors.customerName} />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="card min-w-0 space-y-4">
        <legend className="sr-only">Line items</legend>
        <h2 className="text-lg font-bold">Line items</h2>
        <ol className="space-y-4">
          {rows.map((row, i) => {
            const n = i + 1;
            const q = parseQuantity(row.quantity);
            const p = parseKESToCents(row.unitPrice);
            const err = (f: string) => errors[`items.${i}.${f}`];
            return (
              <li
                key={row.key}
                className="grid grid-cols-2 gap-3 border-b border-line pb-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_7rem_auto] sm:items-start [&>*]:min-w-0"
              >
                <div className="col-span-2 sm:col-span-1">
                  <label htmlFor={`${row.key}-d`} className="label">
                    Item {n} description
                  </label>
                  <input
                    id={`${row.key}-d`}
                    value={row.description}
                    onChange={(e) => update(row.key, { description: e.target.value })}
                    maxLength={300}
                    className="input"
                    aria-invalid={Boolean(err("description"))}
                  />
                  {err("description") && <p className="field-error">{err("description")}</p>}
                </div>
                <div>
                  <label htmlFor={`${row.key}-q`} className="label">
                    Qty
                  </label>
                  <input
                    id={`${row.key}-q`}
                    value={row.quantity}
                    onChange={(e) => update(row.key, { quantity: e.target.value })}
                    inputMode="decimal"
                    className="input"
                    aria-invalid={q === null || Boolean(err("quantity"))}
                  />
                  {err("quantity") && <p className="field-error">{err("quantity")}</p>}
                </div>
                <div>
                  <label htmlFor={`${row.key}-p`} className="label">
                    Unit price (KES)
                  </label>
                  <input
                    id={`${row.key}-p`}
                    value={row.unitPrice}
                    onChange={(e) => update(row.key, { unitPrice: e.target.value })}
                    inputMode="decimal"
                    placeholder="1,500"
                    className="input"
                    aria-invalid={(row.unitPrice !== "" && p === null) || Boolean(err("unitPrice"))}
                  />
                  {err("unitPrice") && <p className="field-error">{err("unitPrice")}</p>}
                </div>
                <p className="self-center text-right text-sm font-semibold tabular-nums sm:pt-7">
                  <span className="sr-only">Item {n} amount: </span>
                  {formatKES(lineTotalCents(q ?? 0, p ?? 0))}
                </p>
                <div className="self-center sm:pt-6">
                  <button
                    type="button"
                    onClick={() => remove(row.key)}
                    disabled={rows.length === 1}
                    className="btn-ghost px-3"
                  >
                    Remove<span className="sr-only"> item {n}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <FieldError id="items-error" message={errors.items} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => addRow()} className="btn-secondary">
            Add item
          </button>
          {services.length > 0 && (
            <label className="flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto">
              <span className="shrink-0 text-muted">or add a service</span>
              <select
                className="input min-w-0 flex-1 sm:w-auto"
                value=""
                onChange={(e) => {
                  const s = services.find((x) => x.id === e.target.value);
                  if (!s) return;
                  const it = {
                    description: s.name,
                    quantity: "1",
                    unitPrice: centsToInput(s.price_cents),
                  };
                  // Replace a still-empty first row rather than leaving it blank.
                  const only = rows[0];
                  if (rows.length === 1 && only && !only.description && !only.unitPrice) {
                    update(only.key, it);
                  } else {
                    addRow(it);
                  }
                }}
              >
                <option value="">Choose…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({formatKES(s.price_cents)})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </fieldset>

      <fieldset className="card min-w-0 grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Terms</legend>
        <div>
          <label htmlFor="vatRateBp" className="label">
            VAT
          </label>
          <select
            id="vatRateBp"
            name="vatRateBp"
            value={vatRateBp}
            onChange={(e) => setVatRateBp(Number(e.target.value))}
            className="input"
          >
            {vatOptions.map((o) => (
              <option key={o.bp} value={o.bp}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="deposit" className="label">
            {kind === "quote" ? "Deposit to confirm (KES)" : "Deposit due now (KES)"}
          </label>
          <input
            id="deposit"
            name="deposit"
            inputMode="decimal"
            placeholder="0"
            defaultValue={v.deposit ?? initial.deposit}
            className="input"
            aria-invalid={Boolean(errors.deposit)}
            aria-describedby={describedBy("deposit")}
          />
          <FieldError id="deposit-error" message={errors.deposit} />
        </div>
        <div>
          <label htmlFor="dueDate" className="label">
            {kind === "quote" ? "Valid until" : "Due date"}
          </label>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={v.dueDate ?? initial.dueDate}
            className="input"
            aria-describedby={describedBy("dueDate") ?? "dueDate-hint"}
          />
          <p id="dueDate-hint" className="mt-1 text-xs text-muted">
            Leave empty for 14 days after issuing.
          </p>
          <FieldError id="dueDate-error" message={errors.dueDate} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="notes" className="label">
            Notes for the customer
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={1000}
            defaultValue={v.notes ?? initial.notes}
            placeholder="e.g. Paybill 123456, account INV number"
            className="input py-2.5"
            aria-describedby={describedBy("notes")}
          />
          <FieldError id="notes-error" message={errors.notes} />
        </div>
      </fieldset>

      <div className="card flex flex-wrap items-end justify-between gap-4">
        <dl
          className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm tabular-nums"
          aria-live="polite"
        >
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right">{formatKES(totals.subtotalCents)}</dd>
          {vatRateBp > 0 && (
            <>
              <dt className="text-muted">VAT</dt>
              <dd className="text-right">{formatKES(totals.vatCents)}</dd>
            </>
          )}
          <dt className="font-bold">Total</dt>
          <dd className="text-right text-lg font-extrabold" data-testid="editor-total">
            {formatKES(totals.totalCents)}
          </dd>
        </dl>
        <div className="space-y-2 text-right">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Saving…" : `Save draft ${noun}`}
          </button>
          <Feedback state={state} />
        </div>
      </div>
    </form>
  );
}
