import { describe, expect, it } from "vitest";
import { formatKES, parseKESToCents } from "./money";
import { formatKenyanPhone, normalizeKenyanPhone } from "./phone";
import { safeNextPath } from "./safe-redirect";

describe("normalizeKenyanPhone (mirrors SQL normalize_phone)", () => {
  it.each([
    ["0712345678", "+254712345678"],
    ["0712 345 678", "+254712345678"],
    ["0110-123-456", "+254110123456"],
    ["712345678", "+254712345678"],
    ["254712345678", "+254712345678"],
    ["+254 712 345 678", "+254712345678"],
    ["+447911123456", "+447911123456"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "0812345678", "abc", "+0712345678"])("rejects %j", (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });

  it("formats for display", () => {
    expect(formatKenyanPhone("+254712345678")).toBe("+254 712 345 678");
    expect(formatKenyanPhone("+447911123456")).toBe("+447911123456");
  });
});

describe("money", () => {
  it("formats integer cents as KES", () => {
    expect(formatKES(150000)).toMatch(/1,500$/);
    expect(formatKES(150050)).toMatch(/1,500\.50$/);
    expect(formatKES(0)).toMatch(/0$/);
  });

  it("refuses non-integer cents", () => {
    expect(() => formatKES(10.5)).toThrow(RangeError);
  });

  it.each([
    ["1500", 150000],
    ["1,500.5", 150050],
    ["KES 2,000.05", 200005],
    ["0.1", 10],
  ])("parses %j -> %d cents without floats", (input, cents) => {
    expect(parseKESToCents(input)).toBe(cents);
  });

  it.each(["", "-5", "1.234", "abc"])("rejects %j", (input) => {
    expect(parseKESToCents(input)).toBeNull();
  });
});

describe("safeNextPath", () => {
  const origin = "https://nextto.app";
  it.each([
    ["/dashboard?business=1", "/dashboard?business=1"],
    ["/invite/abc", "/invite/abc"],
    ["https://nextto.app/invite/abc", "/invite/abc"],
    [null, "/dashboard"],
    ["/", "/dashboard"],
    ["https://evil.example/x", "/dashboard"],
    ["//evil.example/x", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("%j -> %j", (input, expected) => {
    expect(safeNextPath(input, origin)).toBe(expected);
  });
});
