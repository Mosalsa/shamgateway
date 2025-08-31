// apps/api/src/payments/currency.util.ts
export const EXPONENT_MAP: Record<string, number> = {
  // 0-decimal
  JPY: 0,
  KRW: 0,
  VND: 0,
  XOF: 0,
  XAF: 0,
  XPF: 0,
  CLP: 0,
  // 1-decimal (selten)
  MGA: 1,
  // 3-decimal
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
  IQD: 3,
};

export function toMinorUnits(amount: string, currency: string): number {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error("Invalid amount format");
  const code = currency.toUpperCase();
  const exp = EXPONENT_MAP[code] ?? 2;
  const [intPart, fracRaw = ""] = amount.split(".");
  const frac = (fracRaw + "0".repeat(exp)).slice(0, exp);
  const normalized = exp > 0 ? `${intPart}${frac}` : intPart;
  const n = Number(normalized.replace(/^0+/, "") || "0");
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return n;
}

export function fromMinorUnits(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const exp = EXPONENT_MAP[code] ?? 2;
  if (exp === 0) return String(minor);
  const s = String(minor).padStart(exp + 1, "0");
  const i = s.slice(0, -exp);
  const f = s.slice(-exp);
  return `${i}.${f}`.replace(/^0+(\d)/, "$1");
}
