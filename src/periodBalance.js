// src/periodBalance.js — bilans okresu (ten miesiąc / ten rok): faktyczna zmiana zysku od początku okresu.
//
// Czysta logika (bez Reacta). Liczone PER POZYCJA z faktycznych danych, nie z założeń:
//   bilans = wartość dziś − wartość bazowa, gdzie wartość bazowa partii (transzy) to:
//     kupiona PRZED okresem  → ilość × kurs zamknięcia z dnia granicznego × kurs waluty z tego dnia
//     kupiona W okresie      → zapłacona kwota (zakup nie jest zyskiem)
//
// "Dzień graniczny" (boundary) = ostatni dzień PRZED okresem: dla miesiąca ostatni dzień poprzedniego
// miesiąca, dla roku 31 grudnia. Wszystko w PLN — zmiana kursu waluty jest częścią bilansu.
//
// Źródła per typ aktywa:
//   obligacje      → dokładny wzór na dzień graniczny (ctx.bondValueAt)
//   konta oszcz.   → odsetki netto naliczone w okresie (z computeSavings; wpłaty nie są zyskiem)
//   akcje / ETF    → kursy historyczne (ctx.hist z /api/price-at); wymaga dat transz (import XTB)
//   pozostałe      → brak dat zakupu / źródła → zapas ze snapshotów (ctx.series), a gdy ich brak — `uncovered`
//
// Zapas ze snapshotów działa tylko dla kategorii, w której ŻADNE aktywo nie zostało policzone per pozycja
// (snapshot trzyma sumy per kategoria, więc nie da się go mieszać z rachunkiem per pozycja).

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = iso => (iso ? String(iso).slice(0, 10) : null);

// Dni graniczne dla "tego miesiąca" i "tego roku"
export function periodBoundaries(now = new Date()) {
  return {
    month: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    year: ymd(new Date(now.getFullYear(), 0, 0)),
  };
}

// Partie zakupu akcji: [{ qty, paidPLN, date }] albo null, gdy nie znamy dat dla całej pozycji
export function stockLots(a) {
  const qty = a.stockQuantity || 0;
  if (!(qty > 0)) return null;
  const tr = a.stockTranches || [];
  if (tr.length > 0 && tr.every(t => t.openTime && t.qty > 0)) {
    const sum = tr.reduce((s, t) => s + t.qty, 0);
    // Suma transz musi zgadzać się z ilością (np. po ręcznej edycji mogłaby się rozjechać)
    if (Math.abs(sum - qty) <= 1e-6 * Math.max(1, qty)) {
      return tr.map(t => ({ qty: t.qty, paidPLN: t.totalPLN || 0, date: dayOf(t.openTime) }));
    }
  }
  // Pozycja bez transz z datami: jedna partia z datą zakupu albo datą dodania do aplikacji
  const date = dayOf(a.stockPurchaseDate || a.createdAt);
  if (!date) return null;
  return [{ qty, paidPLN: a.stockPaidPLN || 0, date }];
}

// Jakie notowania historyczne są potrzebne: akcje mające choć jedną partię kupioną przed dniem granicznym
export function neededHistory(assets, boundaries) {
  const need = {};
  for (const a of assets) {
    if (!a.isStock || !a.stockSymbol) continue;
    const lots = stockLots(a);
    if (!lots) continue;
    for (const b of boundaries) {
      if (!lots.some(l => l.date <= b)) continue;
      const n = (need[a.stockSymbol] ??= { symbol: a.stockSymbol, exchange: a.stockExchange || "", currency: a.stockCurrency || "PLN", dates: new Set() });
      n.dates.add(b);
    }
  }
  return Object.values(need).map(n => ({ ...n, dates: [...n.dates].sort() }));
}

// Odsetki netto konta oszczędnościowego naliczone po dniu granicznym.
// Kapitalizacja jest zawsze 1. dnia miesiąca, a okresy zaczynają się 1. dnia miesiąca — więc żaden
// skapitalizowany okres nie przecina granicy: liczą się w całości te zakończone po 1. dniu okresu.
function savingsInterestSince(calc, boundary) {
  const [y, m, d] = boundary.split("-").map(Number);
  const firstDay = ymd(new Date(y, m - 1, d + 1));
  const capitalized = (calc.months || []).reduce((s, mo) => s + (mo.date > firstDay ? mo.interestNet || 0 : 0), 0);
  return capitalized + (calc.accruedSinceCap ?? calc.accruedToday ?? 0);
}

/**
 * @param {object[]} assets aktywa z bieżącą wartością (`value` po live cenach; konta z `_calc`)
 * @param {string} boundary dzień graniczny "YYYY-MM-DD"
 * @param {object} ctx {
 *   hist: { prices: {SYM: {date: {close}|null}}, fx: {CUR: {date: {rate}|null}} }  — brak klucza = jeszcze się ładuje
 *   bondValueAt(asset, boundary) → wartość obligacji na koniec dnia granicznego
 *   costBasis(asset) → koszt zakupu w PLN
 *   series → snapshoty portfela [{ date, byCategory, paidByCategory }] rosnąco
 *   today → "YYYY-MM-DD"
 * }
 * @returns {{ diff, base, pct, pending, since, uncovered: {category, partial}[], perAsset }}
 *   pending — czekamy na notowania historyczne; since — data, od której liczony jest zapas ze snapshotów (gdy okres niepełny)
 */
export function calcPeriodBalance(assets, boundary, ctx) {
  const { hist = {}, bondValueAt, costBasis, series = [], today = ymd(new Date()) } = ctx;
  let diff = 0, base = 0, pending = false;
  const perAsset = {};
  const coveredCats = new Set();
  const leftover = {}; // kategoria → aktywa niepoliczone per pozycja

  const add = (a, d, b) => { diff += d; base += b; perAsset[a.id] = d; coveredCats.add(a.category); };
  const skip = a => { if ((a.value || 0) > 0 || costBasis?.(a) > 0) (leftover[a.category] ??= []).push(a); };

  for (const a of assets) {
    const value = a.value || 0;

    if (a.isBond) {
      const nominal = (a.quantity || 0) * 100;
      if (!a.purchaseDate || !bondValueAt) { skip(a); continue; }
      const b = dayOf(a.purchaseDate) <= boundary ? bondValueAt(a, boundary) : nominal;
      add(a, value - b, b);
      continue;
    }

    if (a.isSavings) {
      if (!a._calc) { skip(a); continue; }
      const gain = savingsInterestSince(a._calc, boundary);
      add(a, gain, value - gain);
      continue;
    }

    if (a.isStock && a.stockSymbol) {
      const lots = stockLots(a);
      if (!lots) { skip(a); continue; }
      const needsHist = lots.some(l => l.date <= boundary);
      let startPLN = null;
      if (needsHist) {
        const cur = a.stockCurrency || "PLN";
        const p = hist.prices?.[a.stockSymbol]?.[boundary];
        const f = cur === "PLN" ? { rate: 1 } : hist.fx?.[cur]?.[boundary];
        // Kategoria z pozycją w toku liczenia nie może pójść do zapasu ze snapshotów (ten liczy całą kategorię)
        if (p === undefined || f === undefined) { pending = true; coveredCats.add(a.category); continue; }
        if (!p || !f) { skip(a); continue; } // brak notowań na ten dzień (np. instrument jeszcze nienotowany)
        startPLN = p.close * f.rate;
      }
      const b = lots.reduce((s, l) => s + (l.date <= boundary ? l.qty * startPLN : l.paidPLN), 0);
      add(a, value - b, b);
      continue;
    }

    skip(a);
  }

  // Zapas: zmiana (wartość − koszt) kategorii względem snapshotu z początku okresu
  const uncovered = [];
  let since = null;
  const usable = series.filter(s => s.paidByCategory && !s.legacy && s.date < today);
  // Snapshot sprzed okresu musi być świeży (≤ 7 dni przed granicą) — starszy wciągnąłby do bilansu ruch sprzed okresu.
  // Gdy takiego nie ma, liczymy od pierwszego snapshotu w okresie i zgłaszamy to w `since`.
  const [by, bm, bd] = boundary.split("-").map(Number);
  const oldest = ymd(new Date(by, bm - 1, bd - 7));
  const baseline = [...usable].reverse().find(s => s.date <= boundary && s.date >= oldest) || usable.find(s => s.date > boundary) || null;
  for (const [cat, list] of Object.entries(leftover)) {
    if (coveredCats.has(cat)) { uncovered.push({ category: cat, partial: true }); continue; }
    if (!baseline || !costBasis) { uncovered.push({ category: cat, partial: false }); continue; }
    const valueNow = list.reduce((s, a) => s + (a.value || 0), 0);
    const paidNow = list.reduce((s, a) => s + costBasis(a), 0);
    const valueThen = baseline.byCategory?.[cat] || 0;
    const paidThen = baseline.paidByCategory?.[cat] || 0;
    const d = (valueNow - paidNow) - (valueThen - paidThen);
    diff += d;
    base += valueNow - d;
    if (baseline.date > boundary && (!since || baseline.date > since)) since = baseline.date;
  }

  return { diff, base, pct: base > 0 ? (diff / base) * 100 : null, pending, since, uncovered, perAsset };
}
