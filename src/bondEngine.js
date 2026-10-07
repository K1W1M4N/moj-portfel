// src/bondEngine.js — typy obligacji i silnik wyceny (czysta logika, bez Reacta; używa go BondModal i testy).
import { getInflationForBondPeriod } from "./inflationData.js";
import { localDateStr } from "./historyStore.js";

// ─── Typy obligacji ───────────────────────────────────────────────────────────
export const BOND_TYPES = {
  // isShortTerm=true → kalkulacja prosta (odsetki = kapitał × stopa × dni/365),
  //                     termin wykupu liczony w miesiącach (nie latach)
  "OTS": { label:"OTS (3-miesięczne, stałe)", months:3, periods:1, defaultRate:0.0200, rateType:"fixed", coupon:false, earlyRedemptionCost:0, isShortTerm:true },
  "TOS": { label:"TOS (3-latki, stałe)", months:36, periods:3, defaultRate:0.0565, rateType:"fixed", coupon:false, earlyRedemptionCost:1.0 },
  "COI": { label:"COI (4-latki, inflacja)", months:48, periods:4, defaultRate:0.0500, rateType:"inflation", margin:0.015, coupon:true, earlyRedemptionCost:2.0 },
  "EDO": { label:"EDO (10-latki, inflacja)", months:120, periods:10, defaultRate:0.0625, rateType:"inflation", margin:0.02, coupon:false, earlyRedemptionCost:3.0 },
  "ROR": { label:"ROR (roczne)", months:12, periods:1, defaultRate:0.0525, rateType:"fixed", coupon:true, earlyRedemptionCost:0.5 },
  "DOR": { label:"DOR (2-latki)", months:24, periods:2, defaultRate:0.054, rateType:"fixed", coupon:true, earlyRedemptionCost:0.7 },
  "ROS": { label:"ROS (6-latki, inflacja)", months:72, periods:6, defaultRate:0.062, rateType:"inflation", margin:0.02, coupon:false, earlyRedemptionCost:2.0 },
  "ROD": { label:"ROD (12-latki, inflacja)", months:144, periods:12, defaultRate:0.065, rateType:"inflation", margin:0.025, coupon:false, earlyRedemptionCost:3.0 },
};

// ─── Silnik obliczeń ──────────────────────────────────────────────────────────
function calcSingleBond(params, purchaseDate, today, rate1) {
  // OTS i inne krótkoterminowe: prosta formuła odsetkowa (stawka roczna × dni/365)
  if (params.isShortTerm) {
    const matDate = new Date(purchaseDate);
    matDate.setMonth(matDate.getMonth() + params.months);
    const periodDays = (matDate - purchaseDate) / 86400000;
    const elapsed = Math.max(0, Math.min((today - purchaseDate) / 86400000, periodDays));
    return Math.round(100 * (1 + rate1 * elapsed / 365) * 100) / 100;
  }

  let val = 100.0;
  for (let k = 0; k < params.periods; k++) {
    const pStart = new Date(purchaseDate);
    pStart.setFullYear(pStart.getFullYear() + k);
    const pEnd = new Date(purchaseDate);
    pEnd.setFullYear(pEnd.getFullYear() + k + 1);

    let rate;
    if (k === 0) {
      rate = rate1;
    } else if (params.rateType === "inflation") {
      const inflation = getInflationForBondPeriod(pStart);
      rate = Math.max(0, inflation) + params.margin;
    } else {
      rate = rate1;
    }

    // Bez zaokrągleń na koniec lat — PKO BP zaokrągla do grosza tylko wynik końcowy.
    // WERYFIKACJA (EDO zakup 30.08.2024, stan 27.09.2026): 100 × 1,068 × 1,061 × (1 + 4,5% × 28/365)
    // = 113,70597 → 113,71 zł/szt., zgodnie z bankiem. Zaokrąglanie co rok dawało 113,70.
    const ACT = (pEnd - pStart) / 86400000;
    if (today <= pEnd) {
      const a_k = (today - pStart) / 86400000;
      val = (params.coupon ? 100.0 : val) * (1 + rate * a_k / ACT);
      break;
    } else {
      val = params.coupon ? 100.0 : val * (1 + rate);
    }
  }
  // epsilon: np. 100 × 1,068 × 1,061 w liczbach binarnych może wyjść o włos poniżej ,xx5
  return Math.round(val * 100 + 1e-9) / 100;
}

export function calcBondCurrentValue(bond, customToday = null) {
  const { type, purchaseDate, quantity, rate } = bond;
  const params = BOND_TYPES[type];
  if (!params || !purchaseDate || !quantity) return { currentValue:(quantity||0)*100, earned:0, dailyGain:0, progress:0 };

  const today = customToday ? new Date(customToday) : new Date(); today.setHours(0,0,0,0);
  const purchase = new Date(purchaseDate); purchase.setHours(0,0,0,0);

  if (today < purchase) return { currentValue:(quantity||0)*100, earned:0, dailyGain:0, progress:0 };
  const maturityDate = new Date(purchase);
  if (params.isShortTerm) {
    maturityDate.setMonth(maturityDate.getMonth() + params.months);
  } else {
    maturityDate.setFullYear(maturityDate.getFullYear() + params.periods);
  }

  const progress = Math.min(1, Math.max(0, (today - purchase) / (maturityDate - purchase)));
  const totalNominal = quantity * 100;
  const bondRate = rate || params.defaultRate;

  let totalValue = 0;
  for (let i = 0; i < quantity; i++) totalValue += calcSingleBond(params, purchase, today, bondRate);

  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  let valueYesterday = 0;
  for (let i = 0; i < quantity; i++) valueYesterday += calcSingleBond(params, purchase, yesterday, bondRate);

  // Estymacja zysku na koniec — przyszłe okresy z założoną inflacją (getAssumedFutureInflation)
  const maturity = new Date(maturityDate); maturity.setHours(0,0,0,0);
  let totalAtMaturity = 0;
  for (let i = 0; i < quantity; i++) totalAtMaturity += calcSingleBond(params, purchase, maturity, bondRate);

  return {
    currentValue: Math.round(totalValue * 100) / 100,
    earned: Math.round((totalValue - totalNominal) * 100) / 100,
    dailyGain: Math.round((totalValue - valueYesterday) * 100) / 100,
    estimatedAtMaturity: Math.round(totalAtMaturity * 100) / 100,
    estimatedProfit: Math.round((totalAtMaturity - totalNominal) * 100) / 100,
    progress, maturityDate, totalNominal, bondRate,
  };
}

// ─── Wypłacone kupony (COI / ROR / DOR) ───────────────────────────────────────
// calcSingleBond po każdej rocznicy zeruje naliczone odsetki (wartość wraca do 100 zł) — wypłaconego kuponu
// nie widać więc nigdzie w wartości. Wyliczamy go osobno, żeby doliczyć do bilansów (jak dywidendy).
//
// Data wpisu = dzień, w którym wartość obligacji spada (dzień PO rocznicy: w sam dzień rocznicy wzór nadal
// liczy odsetki do końca okresu), więc spadek wartości i wpływ kuponu wypadają w tym samym dniu.
// Kwota: 100 zł × stawka okresu × liczba sztuk (stawki jak w calcSingleBond). Podatek Belki 19% odejmujemy
// poza IKE/IKZE (`taxFree`); zaokrąglenie do grosza — bank może zaokrąglać podatek inaczej (różnica rzędu groszy).
export const BELKA = 0.19;
const round2 = n => Math.round(n * 100 + 1e-9) / 100;

export function bondCoupons(bond, { today = new Date(), taxFree = false } = {}) {
  const params = BOND_TYPES[bond?.type];
  if (!params?.coupon || !bond.purchaseDate || !(bond.quantity > 0)) return [];
  const now = new Date(today); now.setHours(0, 0, 0, 0);
  const purchase = new Date(bond.purchaseDate); purchase.setHours(0, 0, 0, 0);
  const rate1 = bond.rate || params.defaultRate;
  const out = [];
  for (let k = 0; k < params.periods; k++) {
    const pStart = new Date(purchase); pStart.setFullYear(pStart.getFullYear() + k);
    const pEnd = new Date(purchase); pEnd.setFullYear(pEnd.getFullYear() + k + 1);
    if (!(now > pEnd)) break;
    const rate = k > 0 && params.rateType === "inflation"
      ? Math.max(0, getInflationForBondPeriod(pStart)) + params.margin
      : rate1;
    const gross = round2(round2(100 * rate) * bond.quantity);
    const tax = taxFree ? 0 : round2(gross * BELKA);
    const drop = new Date(pEnd); drop.setDate(drop.getDate() + 1);
    const date = localDateStr(drop);
    out.push({ id: `coupon-${bond.id}-${date}`, kind: "coupon", category: bond.category, date, name: params.label.split(" ")[0], pnlPLN: round2(gross - tax), grossPLN: gross, taxPLN: tax, source: "calc" });
  }
  return out;
}
