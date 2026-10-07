// src/realizedLog.js — dziennik zrealizowanych wyników (klucz "pt-realized"). Czysta logika, bez Reacta.
//
// Aplikacja zna tylko stan bieżący: po sprzedaży pozycja znika razem ze swoim zyskiem, a dywidendy i odsetki
// od wolnych środków nigdy nie były w wartości aktywów. Dziennik trzyma te wyniki osobno i jest doliczany
// do "Bilansu portfela" oraz do bilansów okresów.
//
// Wpis: { id, portfolioId, date: "YYYY-MM-DD", category, kind: "sale" | "dividend" | "interest" | "tax",
//         pnlPLN, symbol?, name?, source: "xtb" }
// Wpis sprzedaży ma dodatkowo dane partii: exchange, currency, qty, openDate, costPLN, salePLN —
// dzięki nim da się policzyć, ile z wyniku przypada na dany okres (patrz realizedPeriod).
// `id` jest stabilny (np. "xtb-pos-…"), więc ponowny import tego samego pliku nie dubluje wpisów.

const round2 = n => Math.round(n * 100) / 100;

export const KIND_LABEL = { sale: "sprzedaże", dividend: "dywidendy", interest: "odsetki", tax: "podatki" };

// Dopisuje nowe wpisy (po id). Zwraca { next, added }; `next` to ta sama referencja, gdy nic nie przybyło.
export function mergeRealized(log, incoming) {
  const list = log || [];
  const have = new Set(list.map(e => e.id));
  const added = [];
  for (const e of incoming || []) {
    if (!e?.id || have.has(e.id)) continue;
    have.add(e.id);
    added.push(e);
  }
  if (added.length === 0) return { next: log, added };
  return { next: [...list, ...added].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), added };
}

export function removePortfolioFromRealized(log, portfolioId) {
  const next = (log || []).filter(e => e.portfolioId !== portfolioId);
  return next.length === (log || []).length ? log : next;
}

const inScope = (e, portfolioId, category) =>
  e.portfolioId === portfolioId && (!category || e.category === category);

// Suma wyniku od początku (do "Bilansu portfela")
export function realizedTotal(log, portfolioId, category = null) {
  return round2((log || []).filter(e => inScope(e, portfolioId, category)).reduce((s, e) => s + (e.pnlPLN || 0), 0));
}

// Rozbicie sumy wg rodzaju — do dopisku pod kafelkiem
export function realizedByKind(log, portfolioId, category = null) {
  const out = {};
  for (const e of log || []) if (inScope(e, portfolioId, category)) out[e.kind] = round2((out[e.kind] || 0) + (e.pnlPLN || 0));
  return out;
}

// Koszt zakupu sprzedanych partii — do mianownika procentu "Bilansu portfela" (wynik z całej zainwestowanej kwoty)
export function realizedSoldCost(log, portfolioId, category = null) {
  return round2((log || []).filter(e => e.kind === "sale" && inScope(e, portfolioId, category)).reduce((s, e) => s + (e.costPLN || 0), 0));
}

// Sprzedaż partii kupionej PRZED dniem granicznym okresu, a sprzedanej po nim: do bilansu okresu wlicza się
// tylko zmiana od dnia granicznego (sprzedaż − ilość × kurs z dnia granicznego), nie cały wynik od zakupu.
const crossesBoundary = (e, boundary) => e.kind === "sale" && e.openDate && e.openDate <= boundary && e.qty > 0 && e.symbol;

// Pseudo-aktywa dla useHistoricalPrices/neededHistory: sprzedane partie, dla których potrzebny jest kurs z dnia granicznego.
// Zwraca nową tablicę przy każdym wywołaniu — wołać w useMemo.
export function realizedHistoryAssets(log, portfolioId, boundaries) {
  const out = [];
  for (const e of log || []) {
    if (e.portfolioId !== portfolioId) continue;
    if (!boundaries.some(b => e.date > b && crossesBoundary(e, b))) continue;
    out.push({
      id: e.id, category: e.category, isStock: true,
      stockSymbol: e.symbol, stockExchange: e.exchange || "", stockCurrency: e.currency || "PLN",
      stockQuantity: e.qty, stockPaidPLN: e.costPLN || 0,
      stockTranches: [{ qty: e.qty, totalPLN: e.costPLN || 0, openTime: e.openDate }],
    });
  }
  return out;
}

/**
 * Wynik zrealizowany przypadający na okres (wpisy z datą PO dniu granicznym).
 * @param {object} hist jak w calcPeriodBalance: { prices: {SYM: {date: {close}|null}}, fx: {CUR: {date: {rate}|null}} }
 * @returns {{ sum, pending, approx }}
 *   pending — czekamy na kursy z dnia granicznego (kafelek pokaże "…")
 *   approx  — liczba sprzedaży, dla których zabrakło kursu i wzięto cały wynik od zakupu (zawyża/zaniża bilans okresu)
 */
export function realizedPeriod(log, portfolioId, boundary, hist = {}, category = null) {
  let sum = 0, pending = false, approx = 0;
  for (const e of log || []) {
    if (!inScope(e, portfolioId, category) || e.date <= boundary) continue;
    if (!crossesBoundary(e, boundary)) { sum += e.pnlPLN || 0; continue; }
    const cur = e.currency || "PLN";
    const p = hist.prices?.[e.symbol]?.[boundary];
    const f = cur === "PLN" ? { rate: 1 } : hist.fx?.[cur]?.[boundary];
    if (p === undefined || f === undefined) { pending = true; continue; }
    if (!p || !f) { sum += e.pnlPLN || 0; approx++; continue; }
    sum += (e.salePLN || 0) - e.qty * p.close * f.rate;
  }
  return { sum: round2(sum), pending, approx };
}
