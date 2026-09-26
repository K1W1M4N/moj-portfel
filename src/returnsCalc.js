// src/returnsCalc.js — stopy zwrotu w podsumowaniu portfela (panel pod wykresem kołowym).
//
// Zysk za okres (dzień / 30 dni / 365 dni) = wartość dziś − wartość na początku okresu,
// gdzie zakupy dokonane w trakcie okresu liczą się po cenie zakupu (nie jako zysk):
//   - obligacje:  wycena na dzień startu (przed zakupem = nominał),
//   - konta:      odsetki naliczone w okresie (wpłaty/wypłaty nie są zyskiem),
//   - akcje/ETF:  notowania historyczne + historyczny kurs waluty; transze z datą
//                 otwarcia po starcie okresu liczone po koszcie zakupu,
//   - pozostałe (krypto, surowce, waluty, aktywa ręczne) — brak historii cen,
//     pomijane w liczniku i mianowniku (lista w `excluded`, patrz describeExcluded).
// „Zysk dzienny” dla akcji to zmiana względem poprzedniej sesji (jak u brokera).
//
// Średnia roczna = XIRR z przepływów (daty i kwoty wpłat) — pozycje bez dat pomijane.
// Podatek Belki (tryb NET): 19% od odsetek oraz od dodatniej sumy zysków rynkowych.
import { useEffect, useMemo, useState } from "react";
import { calcBondCurrentValue } from "./BondModal";
import { computeSavings } from "./SavingsModal";

const BELKA = 0.19;
const DAY = 86400000;
const HIST_CACHE_KEY = "pt-price-history-v1";
const HIST_TTL = 6 * 3600 * 1000;

// ─── Historia notowań (akcje + kursy walut) ───────────────────────────────────

const stockKey = a => `S:${a.stockSymbol}|${a.stockExchange || ""}`;
const fxKey = cur => `FX:${cur}`;

function loadHistCache() {
  try { return JSON.parse(localStorage.getItem(HIST_CACHE_KEY) || "{}"); } catch { return {}; }
}

async function fetchSeries(symbol, exchange, range) {
  const params = new URLSearchParams({ symbol, range });
  if (exchange) params.set("exchange", exchange);
  const r = await fetch(`/api/stock-chart?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.points || []).filter(p => p.close > 0).map(p => [p.ts * 1000, p.close]);
}

// Tygodniowe notowania z roku + dzienne z 3 miesięcy → jedna posortowana seria [ms, close]
async function fetchHistory(symbol, exchange) {
  const [weekly, daily] = await Promise.all([
    fetchSeries(symbol, exchange, "1y").catch(() => []),
    fetchSeries(symbol, exchange, "3mo").catch(() => []),
  ]);
  if (daily.length === 0) return weekly.length ? weekly : null;
  return [...weekly.filter(p => p[0] < daily[0][0]), ...daily];
}

export function usePriceHistory(assets) {
  const [hist, setHist] = useState(() => {
    const c = loadHistCache();
    return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.pts]));
  });
  const [attemptedKey, setAttemptedKey] = useState(null);

  const wanted = useMemo(() => {
    const m = new Map();
    for (const a of assets) {
      if (!a.isStock || !a.stockSymbol) continue;
      m.set(stockKey(a), [a.stockSymbol, a.stockExchange || ""]);
      const cur = a.stockCurrency;
      if (cur && cur !== "PLN") m.set(fxKey(cur), [`${cur}PLN=X`, ""]);
    }
    return m;
  }, [assets]);
  const wantedKey = [...wanted.keys()].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const cache = loadHistCache();
    const stale = [...wanted].filter(([k]) => !cache[k] || Date.now() - cache[k].ts > HIST_TTL);
    if (stale.length === 0) return;
    Promise.all(stale.map(async ([k, [sym, ex]]) => {
      const pts = await fetchHistory(sym, ex).catch(() => null);
      if (pts) cache[k] = { ts: Date.now(), pts };
    })).then(() => {
      try { localStorage.setItem(HIST_CACHE_KEY, JSON.stringify(cache)); } catch { /* pełny localStorage — działamy bez cache */ }
      if (cancelled) return;
      setHist(Object.fromEntries(Object.entries(cache).map(([k, v]) => [k, v.pts])));
      setAttemptedKey(wantedKey);
    });
    return () => { cancelled = true; };
  }, [wantedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // „Wczytywanie” tylko gdy brakuje serii i jeszcze nie próbowaliśmy ich pobrać
  const loading = attemptedKey !== wantedKey && [...wanted.keys()].some(k => !hist[k]);
  return { hist, loading };
}

// Ostatnie notowanie nie późniejsze niż t (ms)
function priceAt(pts, t) {
  if (!pts?.length || pts[0][0] > t) return null;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return pts[lo][1];
}

// ─── Zysk za okres dla pojedynczego aktywa ────────────────────────────────────
// Zwraca { gain, start, kind: "interest" | "market" } albo null (brak danych historycznych).

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

// Odsetki (netto lub brutto) naliczone na koncie po chwili t0
function savingsInterestSince(a, t0, gross) {
  const c = a._calc || computeSavings(a);
  if (!c) return null;
  let interest = 0;
  let prevEnd = Date.parse(a.openDate);
  for (const m of c.months) {
    const end = Date.parse(m.date);
    const len = end - prevEnd;
    if (len > 0) interest += (gross ? m.interestGross : m.interestNet) * overlap(prevEnd, end, t0, Infinity) / len;
    prevEnd = end;
  }
  const capStart = Date.parse(c.lastCapDate);
  const now = Date.now();
  if (now > capStart) {
    const accrued = gross ? c.accruedGross : c.accruedSinceCap;
    interest += accrued * overlap(capStart, now, t0, now) / (now - capStart);
  }
  return interest;
}

function stockPeriod(a, t0, daily, ctx) {
  const live = ctx.stockPrices?.[a.stockSymbol];
  const pts = ctx.hist[stockKey(a)];
  if (!live?.priceOrig || !pts?.length) return null;

  let tStart = t0, pStart;
  if (daily) {
    if (pts.length < 2) return null;
    [tStart, pStart] = pts[pts.length - 2]; // poprzednia sesja
  } else {
    pStart = priceAt(pts, t0);
  }
  const cur = a.stockCurrency || live.currency || "PLN";
  const fxStart = cur === "PLN" ? 1 : priceAt(ctx.hist[fxKey(cur)], tStart);

  const qty = a.stockQuantity || 0;
  let qtyAfter = 0, costAfter = 0;
  for (const tr of a.stockTranches || []) {
    const t = tr.openTime ? Date.parse(tr.openTime) : NaN;
    if (t > tStart) { qtyAfter += tr.qty || 0; costAfter += tr.totalPLN || 0; }
  }
  if (qtyAfter > qty) { costAfter *= qty / qtyAfter; qtyAfter = qty; }
  const qtyBefore = qty - qtyAfter;
  let start = costAfter;
  if (qtyBefore > 1e-9) {
    if (pStart == null && pts[0][0] > tStart && qty > 0) {
      // Brak notowań na początku okresu (debiut później) — pozycja kupiona w okresie, liczymy od kosztu zakupu
      start += qtyBefore / qty * (a.stockPaidPLN || 0);
    } else if (pStart == null || !fxStart) {
      return null;
    } else {
      start += qtyBefore * pStart * fxStart;
    }
  }
  return { gain: a.value - start, start, kind: "market" };
}

function assetPeriod(a, daysAgo, ctx) {
  const t0 = Date.now() - daysAgo * DAY;
  if (a.isBond) {
    if (!a.purchaseDate || !a.quantity) return null;
    const start = calcBondCurrentValue(a, new Date(t0)).currentValue;
    return { gain: a.value - start, start, kind: "interest" };
  }
  if (a.isSavings) {
    const gain = savingsInterestSince(a, t0, !ctx.net);
    if (gain == null) return null;
    // Konto: odsetki już w wybranej wersji (brutto/netto) — bez ponownego podatku
    return { gain, start: a.value - gain, kind: "savings" };
  }
  if (a.isStock) return stockPeriod(a, t0, daysAgo === 1, ctx);
  return null;
}

function applyTax(interest, market, net) {
  if (!net) return interest + market;
  return interest * (1 - BELKA) + (market > 0 ? market * (1 - BELKA) : market);
}

// ctx: { hist, stockPrices, net }
export function calcPeriodReturn(assets, daysAgo, ctx) {
  let interest = 0, savings = 0, market = 0, start = 0;
  const excluded = new Set();
  for (const a of assets) {
    const r = assetPeriod(a, daysAgo, ctx);
    if (!r) { if (a.value > 0) excluded.add(a); continue; }
    start += r.start;
    if (r.kind === "interest") interest += r.gain;
    else if (r.kind === "savings") savings += r.gain;
    else market += r.gain;
  }
  if (start <= 0) return { gain: null, pct: null, excluded: [...excluded] };
  const gain = applyTax(interest, market, ctx.net) + savings;
  return { gain, pct: gain / start * 100, excluded: [...excluded] };
}

// Czytelny opis pominiętych pozycji: cała kategoria, jeśli pominięta w całości, inaczej nazwy pozycji
export function describeExcluded(excluded, assets) {
  if (excluded.length === 0) return "";
  const ex = new Set(excluded);
  const parts = [];
  for (const cat of [...new Set(excluded.map(a => a.category))]) {
    const inCat = assets.filter(a => a.category === cat && a.value > 0);
    if (inCat.every(a => ex.has(a))) parts.push(cat);
    else parts.push(...inCat.filter(a => ex.has(a)).map(a => a.stockSymbol || a.name));
  }
  return parts.join(", ");
}

// ─── Zysk całkowity ───────────────────────────────────────────────────────────
// costBasis(a) — koszt zakupu w PLN (getAssetCostBasis z App.jsx, uwzględnia tryb P&L).
export function calcTotalReturn(assets, costBasis, net) {
  let interest = 0, savings = 0, market = 0, paid = 0, value = 0;
  for (const a of assets) {
    value += a.value;
    if (a.isSavings) {
      const c = a._calc || computeSavings(a);
      const cost = costBasis(a);
      paid += cost;
      // Saldo jest netto (Belka pobierana przy kapitalizacji) — w trybie brutto dodajemy podatek z powrotem
      const netInterest = a.value - cost;
      savings += net || !c ? netInterest : netInterest + (c.totalInterestGross - c.totalInterestNet) + (c.accruedGross - c.accruedSinceCap);
      continue;
    }
    const cost = costBasis(a);
    paid += cost;
    if (a.isBond) interest += a.value - cost;
    else market += a.value - cost;
  }
  if (paid <= 0) return { gain: null, pct: null, value };
  const gain = applyTax(interest, market, net) + savings;
  return { gain, pct: gain / paid * 100, value };
}

// ─── Średnia roczna stopa zwrotu (XIRR) ───────────────────────────────────────

function assetFlows(a) {
  if (a.isBond && a.purchaseDate && a.quantity) {
    return [[Date.parse(a.purchaseDate), -a.quantity * 100]];
  }
  if (a.isSavings && a.transactions?.length) {
    return a.transactions.filter(t => t.date).map(t => [Date.parse(t.date), -t.amount]);
  }
  if (a.isStock && a.stockTranches?.length) {
    const tr = a.stockTranches;
    if (!tr.every(t => t.openTime && t.totalPLN > 0)) return null;
    const qty = tr.reduce((s, t) => s + (t.qty || 0), 0);
    if (Math.abs(qty - (a.stockQuantity || 0)) > 0.01 * Math.max(qty, 1e-9)) return null;
    return tr.map(t => [Date.parse(t.openTime), -t.totalPLN]);
  }
  return null;
}

function xirr(flows) {
  const t0 = Math.min(...flows.map(f => f[0]));
  const npv = r => flows.reduce((s, [t, cf]) => s + cf / Math.pow(1 + r, (t - t0) / (365 * DAY)), 0);
  let lo = -0.99, hi = 10;
  let fLo = npv(lo), fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

// Zwraca { rate (%), since (ms) } albo null, gdy za mało danych (< 30 dni historii)
export function calcAnnualReturn(assets, costBasis, net) {
  const flows = [];
  let terminal = 0;
  for (const a of assets) {
    const f = assetFlows(a);
    if (!f?.length || f.some(([t]) => isNaN(t))) continue;
    flows.push(...f);
    const gain = a.value - costBasis(a);
    const tax = net && !a.isSavings && gain > 0 ? gain * BELKA : 0;
    terminal += a.value - tax;
  }
  if (flows.length === 0 || terminal <= 0) return null;
  const since = Math.min(...flows.map(f => f[0]));
  if (Date.now() - since < 30 * DAY) return null;
  const rate = xirr([...flows, [Date.now(), terminal]]);
  return rate == null ? null : { rate: rate * 100, since };
}
