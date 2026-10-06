// src/dailyBalance.js — "Bilans dziś": faktyczna zmiana zysku od poprzedniego zamknięcia.
//
// Czysta logika (bez Reacta). Zakupy w trakcie dnia nie są zyskiem: transza kupiona w dniu sesji
// ma bazę = zapłacona kwota, pozostałe — poprzednie zamknięcie × kurs waluty.
//
// Źródła per typ aktywa:
//   obligacje        → dailyGain z calcBondCurrentValue (dokładny wzór)
//   konta oszcz.     → dailyGain z computeSavings (odsetki za dzień, netto)
//   akcje / ETF      → qty × (kurs − poprzednie zamknięcie) × kurs waluty (Yahoo chartPreviousClose)
//   krypto           → zmiana 24h z CoinGecko (okno kroczące, nie sesja)
//   surowce          → zmiana notowania USD względem poprzedniego zamknięcia
//   waluty / inne    → brak danych → trafiają do `uncovered` (nie udajemy, że zmiana = 0)
//
// Uproszczenie: kurs waluty z poprzedniego dnia = dzisiejszy (zmiana FX w ciągu doby nie jest ujęta).

const dayUTC = iso => (iso ? String(iso).slice(0, 10) : null);

/**
 * @param {object[]} assets  aktywa z bieżącą wartością (`value` już po live cenach)
 * @param {object} ctx { stockPrices, cryptoPrices, commodityPrices, bondDailyGain(asset) }
 * @returns {{ diff, base, pct, sessionDate, covered, uncovered: {category, value}[], perAsset: Record<id, number> }}
 */
export function calcDailyBalance(assets, ctx) {
  const { stockPrices = {}, cryptoPrices = {}, commodityPrices = {}, bondDailyGain } = ctx;
  let diff = 0, coveredValue = 0, sessionTs = null;
  const uncovered = {};
  const perAsset = {};

  const add = (a, d) => { diff += d; coveredValue += a.value || 0; perAsset[a.id] = d; };
  const skip = a => { if ((a.value || 0) > 0) uncovered[a.category] = (uncovered[a.category] || 0) + a.value; };

  for (const a of assets) {
    if (a.isBond) {
      if (!bondDailyGain) { skip(a); continue; }
      add(a, bondDailyGain(a) || 0);
      continue;
    }

    if (a.isSavings) {
      add(a, a._calc?.dailyGain || 0);
      continue;
    }

    if (a.isStock && a.stockSymbol) {
      const p = stockPrices[a.stockSymbol];
      if (!p || !(p.prevOrig > 0) || !(p.fx > 0)) { skip(a); continue; }
      const day = dayUTC(p.sessionTs);
      const prevPLN = p.prevOrig * p.fx;
      let base;
      if (a.stockTranches?.length && day) {
        // Transze otwarte w dniu sesji (lub później) mają bazę = zapłacona kwota
        base = a.stockTranches.reduce((s, t) => {
          const openedInSession = t.openTime && dayUTC(t.openTime) >= day;
          return s + (openedInSession ? t.totalPLN || 0 : (t.qty || 0) * prevPLN);
        }, 0);
        const trancheQty = a.stockTranches.reduce((s, t) => s + (t.qty || 0), 0);
        // Rozjazd ilości (np. ręczna edycja po imporcie) → reszta jak transza bez daty
        base += Math.max(0, (a.stockQuantity || 0) - trancheQty) * prevPLN;
      } else {
        base = (a.stockQuantity || 0) * prevPLN;
      }
      add(a, a.value - base);
      if (p.sessionTs && (!sessionTs || p.sessionTs > sessionTs)) sessionTs = p.sessionTs;
      continue;
    }

    if (a.cryptoId && a.cryptoId !== "other") {
      const ch = cryptoPrices[a.cryptoId]?.pln_24h_change;
      if (ch == null || !isFinite(ch) || ch <= -100) { skip(a); continue; }
      add(a, a.value - a.value / (1 + ch / 100));
      continue;
    }

    if (a.isCommodity && a.commoditySymbol) {
      const pd = commodityPrices[a.commoditySymbol];
      if (!pd?.priceUSD || !(pd.prevUSD > 0)) { skip(a); continue; }
      add(a, a.value * (1 - pd.prevUSD / pd.priceUSD));
      continue;
    }

    skip(a);
  }

  const base = coveredValue - diff;
  return {
    diff,
    base,
    pct: base > 0 ? (diff / base) * 100 : null,
    sessionTs,
    covered: coveredValue,
    uncovered: Object.entries(uncovered).map(([category, value]) => ({ category, value })),
    perAsset,
  };
}

// Etykieta sesji: null gdy dane dotyczą dzisiejszej sesji (albo brak akcji), inaczej np. "pt. 03.10"
export function sessionLabel(sessionTs, now = new Date()) {
  if (!sessionTs) return null;
  const d = new Date(sessionTs);
  if (isNaN(d)) return null;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return null;
  const wd = ["nd.", "pn.", "wt.", "śr.", "czw.", "pt.", "sob."][d.getDay()];
  const p = n => String(n).padStart(2, "0");
  return `${wd} ${p(d.getDate())}.${p(d.getMonth() + 1)}`;
}
