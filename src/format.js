// src/format.js
// Liczby na ekranie po polsku — przecinek dziesiętny, jak GUS, Ministerstwo Finansów i banki
// (np. 4,80%, 1 USD = 3,6512 PLN). Kwoty w złotych formatuje Intl.NumberFormat w każdym pliku.

export function fmtNum(n, decimals = 2) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n).toLocaleString("pl-PL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(n, decimals = 2) {
  const s = fmtNum(n, decimals);
  return s ? s + "%" : "";
}

// Ze znakiem "+" dla wartości dodatnich (zysk/strata)
export function fmtPctSigned(n, decimals = 2) {
  const s = fmtPct(n, decimals);
  return s && Number(n) >= 0 ? "+" + s : s;
}
