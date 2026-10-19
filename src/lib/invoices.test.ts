import { describe, expect, it } from "vitest";
import {
  formatVatRate,
  invoiceTotals,
  lineTotalCents,
  parseQuantity,
  quantityToString,
  vatCents,
} from "./invoice-math";
import { centsToInput } from "./money";
import {
  invoiceDraftSchema,
  invoiceListQuerySchema,
  manualPaymentSchema,
  newInvoiceQuerySchema,
  statusLabel,
  vatOptions,
} from "./validation/invoices";

const BIZ = "3f1c2b4a-1111-4a5b-8c9d-000000000001";
const CUST = "3f1c2b4a-2222-4a5b-8c9d-000000000002";
const INV = "3f1c2b4a-3333-4a5b-8c9d-000000000003";

describe("invoice maths (mirrors Postgres round())", () => {
  it("parses quantities into hundredths", () => {
    expect(parseQuantity("1")).toBe(100);
    expect(parseQuantity("1.5")).toBe(150);
    expect(parseQuantity(" 2.25 ")).toBe(225);
    expect(parseQuantity("0.01")).toBe(1);
    for (const bad of ["0", "0.00", "-1", "1.234", "abc", "", "1,5", "1e3"]) {
      expect(parseQuantity(bad), bad).toBeNull();
    }
    expect(parseQuantity("100000000")).toBeNull(); // beyond numeric(10,2)
  });

  it("prints quantities the way people write them", () => {
    expect(quantityToString(100)).toBe("1");
    expect(quantityToString(150)).toBe("1.5");
    expect(quantityToString(225)).toBe("2.25");
    expect(quantityToString(1)).toBe("0.01");
    expect(quantityToString(1010)).toBe("10.1");
  });

  it("rounds line totals half away from zero", () => {
    expect(lineTotalCents(150, 10001)).toBe(15002); // 15001.5 -> 15002
    expect(lineTotalCents(50, 999)).toBe(500); // 499.5 -> 500
    expect(lineTotalCents(100, 150000)).toBe(150000);
    expect(lineTotalCents(33, 100)).toBe(33);
  });

  it("rounds VAT the same way", () => {
    expect(vatCents(300500, 1600)).toBe(48080);
    expect(vatCents(22502, 1600)).toBe(3600); // 3600.32
    expect(vatCents(3125, 1600)).toBe(500); // exactly 500
    expect(vatCents(3128, 1600)).toBe(500); // 500.48
    expect(vatCents(3129, 1600)).toBe(501); // 500.64
    expect(vatCents(100000, 0)).toBe(0);
  });

  it("totals a document", () => {
    const t = invoiceTotals(
      [
        { quantityHundredths: 150, unitPriceCents: 10001 },
        { quantityHundredths: 100, unitPriceCents: 285498 },
      ],
      1600,
    );
    expect(t).toEqual({ subtotalCents: 300500, vatCents: 48080, totalCents: 348580 });
  });

  it("handles amounts past Number's exact range for products", () => {
    // 99,999,999.99 x KES 10m: the product overflows 2^53, BigInt keeps it exact.
    expect(lineTotalCents(9_999_999_999, 1_000_000_00)).toBe(999_999_999_900_000_000 / 100);
  });

  it("formats VAT rates and price inputs", () => {
    expect(formatVatRate(1600)).toBe("16%");
    expect(formatVatRate(1250)).toBe("12.5%");
    expect(centsToInput(150000)).toBe("1500");
    expect(centsToInput(150050)).toBe("1500.50");
    expect(centsToInput(5)).toBe("0.05");
  });
});

describe("invoice schemas", () => {
  const items = JSON.stringify([
    { description: " Haircut ", quantity: "1", unitPrice: "1,500" },
    { description: "Beard trim", quantity: "0.5", unitPrice: "999" },
  ]);

  it("parses a draft for a new customer", () => {
    const r = invoiceDraftSchema.parse({
      businessId: BIZ,
      kind: "invoice",
      customerPhone: "0712 345 678",
      customerName: "Wanjiku",
      vatRateBp: "1600",
      deposit: "500",
      dueDate: "",
      notes: "",
      items,
    });
    expect(r.customerPhone).toBe("+254712345678");
    expect(r.vatRateBp).toBe(1600);
    expect(r.deposit).toBe(50000);
    expect(r.dueDate).toBeUndefined();
    expect(r.notes).toBeUndefined();
    expect(r.items).toEqual([
      { description: "Haircut", quantity: 100, unitPrice: 150000 },
      { description: "Beard trim", quantity: 50, unitPrice: 99900 },
    ]);
  });

  it("needs a customer and at least one valid item", () => {
    const r = invoiceDraftSchema.safeParse({
      businessId: BIZ,
      vatRateBp: "0",
      items: JSON.stringify([{ description: "", quantity: "1.234", unitPrice: "abc" }]),
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["items.0.description", "items.0.quantity", "items.0.unitPrice"]),
    );

    // The customer check is a refinement, so it runs once the items parse.
    const noCustomer = invoiceDraftSchema.safeParse({ businessId: BIZ, vatRateBp: "0", items });
    expect(noCustomer.error?.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["customerPhone"]),
    );

    const empty = invoiceDraftSchema.safeParse({
      businessId: BIZ,
      customerId: CUST,
      vatRateBp: "0",
      items: "[]",
    });
    expect(empty.error?.issues[0]?.path.join(".")).toBe("items");

    const broken = invoiceDraftSchema.safeParse({
      businessId: BIZ,
      customerId: CUST,
      vatRateBp: "0",
      items: "{not json",
    });
    expect(broken.error?.issues[0]?.message).toBe("Could not read the line items");
  });

  it("accepts an existing customer without name or phone", () => {
    const r = invoiceDraftSchema.parse({
      businessId: BIZ,
      invoiceId: INV,
      customerId: CUST,
      kind: "quote",
      vatRateBp: "0",
      items,
    });
    expect(r.kind).toBe("quote");
    expect(r.deposit).toBe(0);
  });

  it("validates manual payments", () => {
    expect(
      manualPaymentSchema.parse({ invoiceId: INV, method: "cash", amount: "1,000", reference: "" }),
    ).toEqual({ invoiceId: INV, method: "cash", amount: 100000, reference: undefined });
    expect(
      manualPaymentSchema.safeParse({ invoiceId: INV, method: "mpesa", amount: "100" }).success,
    ).toBe(false); // M-Pesa goes through STK push, never by hand
    expect(
      manualPaymentSchema.safeParse({ invoiceId: INV, method: "cash", amount: "0" }).success,
    ).toBe(false);
  });

  it("falls back to safe defaults for bad query strings", () => {
    expect(invoiceListQuerySchema.parse({ show: "nope" }).show).toBe("all");
    expect(invoiceListQuerySchema.parse({ show: "overdue" }).show).toBe("overdue");
    expect(newInvoiceQuerySchema.parse({ customer: "x", kind: "y" })).toEqual({
      customer: undefined,
      kind: "invoice",
    });
  });

  it("labels statuses and VAT options", () => {
    expect(statusLabel("invoice", "issued")).toBe("Unpaid");
    expect(statusLabel("quote", "issued")).toBe("Sent");
    expect(statusLabel("invoice", "partially_paid")).toBe("Part paid");
    expect(vatOptions(1600).map((o) => o.bp)).toEqual([0, 1600]);
    expect(vatOptions(1400, 0).map((o) => o.bp)).toEqual([0, 1600, 1400]);
  });
});
