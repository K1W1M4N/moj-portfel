// src/portfolioCalc.js — Centralna logika obliczania kosztu zakupu w zależności od trybu P&L.
// Dwa tryby (patrz preferences.js):
//   - SNAPSHOT: paidPLN = to co faktycznie wydałeś w PLN (przechowywane w stock.stockPaidPLN)
//   - XTB:      paidPLN = qty × avg_price_w_walucie × aktualny_kurs_waluty
//     (tak jak robi to XTB — kurs walut przeliczany bieżąco, bez snapshota z dnia zakupu)
import { PNL_MODES } from "./preferences";

/**
 * Zwraca koszt zakupu w PLN dla pozycji.
 * @param {object} stock - obiekt pozycji
 * @param {string} mode - "snapshot" albo "xtb"
 * @param {number|null} currentFx - aktualny kurs stock.stockCurrency → PLN (tylko tryb xtb)
 * @returns {number}
 */
export function calcPaidPLN(stock, mode = PNL_MODES.SNAPSHOT, currentFx = null) {
  // Domyślna wartość — snapshot z zapisu
  let snapshot = stock.stockPaidPLN || 0;
  if (!snapshot && stock.stockTranches?.length) {
    snapshot = stock.stockTranches.reduce((s, t) => s + (t.totalPLN || 0), 0);
  }
  if (!snapshot) snapshot = stock.value || 0;

  // Tryb snapshot — zwróć co mamy
  if (mode !== PNL_MODES.XTB) return snapshot;

  // Tryb XTB — ma znaczenie tylko dla walut obcych
  const cur = stock.stockCurrency;
  if (!cur || cur === "PLN") return snapshot;

  // Bez aktualnego kursu nie potrafimy przeliczyć
  if (!currentFx || currentFx <= 0) return snapshot;

  // Potrzebujemy średniej ceny zakupu w walucie nominalnej.
  // Dla pozycji zapisanych w trybie "Szybko" jest to w stock.stockAvgPrice.
  // Dla pozycji transzowych / brokerskich (starszy schemat bez zapisanego avg)
  // spróbujemy wyliczyć z transz — ale transze trzymają tylko totalPLN,
  // więc najlepsze co mamy to snapshot. W takim przypadku zwrot snapshot.
  const avgOrig = stock.stockAvgPrice;
  const qty = stock.stockQuantity;
  if (!avgOrig || !qty || avgOrig <= 0 || qty <= 0) return snapshot;

  return qty * avgOrig * currentFx;
}

/**
 * Wylicza P&L dla pozycji.
 * @returns { paidPLN, pnlPLN, pnlPct }
 */
export function calcPnl(stock, currentValuePLN, mode, currentFx) {
  const paidPLN = calcPaidPLN(stock, mode, currentFx);
  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  return { paidPLN, pnlPLN, pnlPct };
}
