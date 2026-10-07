// scripts/test-bilans.mjs — testy logiki bilansów i snapshotów (czyste moduły, bez Reacta).
// Uruchomienie: npm run test:bilans
import assert from "node:assert";
import { historySeries, upsertSnapshot, removePortfolioFromHistory } from "../src/historyStore.js";
import { calcDailyBalance, sessionLabel } from "../src/dailyBalance.js";
import { calcPeriodBalance, periodBoundaries, stockLots, neededHistory } from "../src/periodBalance.js";
import * as XLSX from "xlsx";
import { parseRealized } from "../src/xtbImport.js";
import { mergeRealized, realizedTotal, realizedByKind, realizedSoldCost, realizedPeriod, realizedHistoryAssets, removePortfolioFromRealized } from "../src/realizedLog.js";

const near = (a, b, e = 0.005) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error("✗ " + name); throw e; } };

// ─── historyStore ─────────────────────────────────────────────────────────────
const snapOf = (total, paid = 0) => ({ total, paid, byCategory: {}, paidByCategory: {} });

test("stary format historii czytany jako portfel default z flagą legacy", () => {
  const h = [{ date: "2026-10-04", total: 100, byCategory: { A: 100 } }];
  assert.equal(historySeries(h, "default")[0].legacy, true);
  assert.equal(historySeries(h, "p2").length, 0);
});

test("snapshoty dwóch portfeli tego samego dnia nie nadpisują się", () => {
  let h = upsertSnapshot([], "p2", snapOf(50, 40), "2026-10-05");
  h = upsertSnapshot(h, "default", snapOf(200, 150), "2026-10-05");
  assert.equal(h.length, 1);
  assert.equal(historySeries(h, "p2")[0].total, 50);
  assert.equal(historySeries(h, "default")[0].total, 200);
});

test("wpis dnia jest nadpisywany, a identyczny zapis nie zmienia referencji", () => {
  let h = upsertSnapshot([], "default", snapOf(200, 150), "2026-10-05");
  assert.strictEqual(upsertSnapshot(h, "default", snapOf(200, 150), "2026-10-05"), h);
  h = upsertSnapshot(h, "default", snapOf(210, 150), "2026-10-05");
  assert.equal(historySeries(h, "default")[0].total, 210);
});

test("zapis innego portfela nie gubi dzisiejszego wpisu w starym formacie", () => {
  const h = upsertSnapshot([{ date: "2026-10-06", total: 99, byCategory: {} }], "p2", snapOf(1, 1), "2026-10-06");
  assert.equal(historySeries(h, "default")[0].total, 99);
});

test("usunięcie portfela czyści jego snapshoty", () => {
  let h = upsertSnapshot([], "p2", snapOf(50), "2026-10-05");
  h = upsertSnapshot(h, "default", snapOf(200), "2026-10-05");
  h = removePortfolioFromHistory(h, "p2");
  assert.equal(historySeries(h, "p2").length, 0);
  assert.equal(historySeries(h, "default").length, 1);
});

// ─── dailyBalance ─────────────────────────────────────────────────────────────
const SESSION = "2026-10-06T14:00:00Z";
const dStock = (extra = {}) => ({ id: 1, category: "Akcje", isStock: true, stockSymbol: "X", stockQuantity: 10, value: 4400, ...extra });
const dPrices = { X: { prevOrig: 100, fx: 4, sessionTs: SESSION } };

test("dziś: akcja w USD — zmiana od poprzedniego zamknięcia", () => {
  const r = calcDailyBalance([dStock()], { stockPrices: dPrices });
  near(r.diff, 400); near(r.pct, 10);
});

test("dziś: transza kupiona w dniu sesji ma bazę = zapłacona kwota", () => {
  const r = calcDailyBalance([dStock({ stockTranches: [
    { qty: 5, totalPLN: 1800, openTime: "2026-09-01T10:00:00Z" },
    { qty: 5, totalPLN: 2100, openTime: "2026-10-06T09:00:00Z" },
  ] })], { stockPrices: dPrices });
  near(r.diff, 200 + 100);
});

test("dziś: brak poprzedniego zamknięcia → pozycja wykazana jako niepokryta, nie jako zero", () => {
  const r = calcDailyBalance([dStock({ stockSymbol: "Y" })], { stockPrices: { Y: { fx: 1 } } });
  assert.equal(r.covered, 0); assert.equal(r.uncovered[0].category, "Akcje");
});

test("dziś: krypto ze zmiany 24h, surowiec z notowania USD", () => {
  near(calcDailyBalance([{ id: 2, category: "Krypto", cryptoId: "btc", value: 1100 }], { cryptoPrices: { btc: { pln_24h_change: 10 } } }).diff, 100);
  near(calcDailyBalance([{ id: 3, category: "Surowce", isCommodity: true, commoditySymbol: "XAU", value: 2100 }], { commodityPrices: { XAU: { priceUSD: 2100, prevUSD: 2000 } } }).diff, 100);
});

test("dziś: obligacje i konto z odsetek dziennych, waluty niepokryte", () => {
  const r = calcDailyBalance([
    { id: 4, category: "Obligacje", isBond: true, value: 1000 },
    { id: 5, category: "Konto", isSavings: true, value: 500, _calc: { dailyGain: 0.8 } },
    { id: 6, category: "Waluty", isCurrency: true, value: 300 },
  ], { bondDailyGain: () => 0.35 });
  near(r.diff, 1.15); assert.deepEqual(r.uncovered, [{ category: "Waluty", value: 300 }]);
});

test("etykieta sesji: brak dla dzisiejszej, dzień tygodnia dla wcześniejszej", () => {
  assert.equal(sessionLabel(new Date(2026, 9, 6, 16).toISOString(), new Date(2026, 9, 6, 20)), null);
  assert.equal(sessionLabel(new Date(2026, 9, 2, 12).toISOString(), new Date(2026, 9, 4, 12)), "pt. 02.10");
});

// ─── periodBalance ────────────────────────────────────────────────────────────
const B = "2026-09-30", TODAY = "2026-10-06";
const run = (assets, ctx = {}) => calcPeriodBalance(assets, B, { today: TODAY, costBasis: a => a.paid ?? 0, ...ctx });
const pStock = (extra = {}) => ({ id: 1, category: "Akcje", isStock: true, stockSymbol: "X", stockCurrency: "USD", stockQuantity: 10, value: 4400, stockPaidPLN: 3000, ...extra });
const tr = (qty, totalPLN, day) => ({ qty, totalPLN, openTime: day + "T10:00:00Z" });
const hist = { prices: { X: { [B]: { close: 100 } } }, fx: { USD: { [B]: { rate: 4 } } } };

test("granice okresów", () => {
  assert.deepEqual(periodBoundaries(new Date(2026, 9, 6)), { month: "2026-09-30", year: "2025-12-31" });
  assert.deepEqual(periodBoundaries(new Date(2026, 0, 1)), { month: "2025-12-31", year: "2025-12-31" });
});

test("okres: akcja w USD kupiona przed okresem — kurs i waluta z dnia granicznego", () => {
  const r = run([pStock({ stockTranches: [tr(10, 3000, "2026-03-01")] })], { hist });
  near(r.diff, 400); near(r.pct, 10); assert.equal(r.pending, false); assert.equal(r.uncovered.length, 0);
});

test("okres: dokupienie w trakcie nie jest zyskiem", () => {
  const r = run([pStock({ stockTranches: [tr(6, 1800, "2026-03-01"), tr(4, 1700, "2026-10-03")] })], { hist });
  near(r.diff, 300); near(r.base, 4100);
});

test("okres: całość kupiona w okresie — bez notowań historycznych", () => {
  const a = pStock({ stockTranches: [tr(10, 4300, "2026-10-02")] });
  const r = run([a], { hist: {} });
  near(r.diff, 100); assert.equal(r.pending, false);
  assert.equal(neededHistory([a], [B]).length, 0);
});

test("okres: zakup w dniu granicznym liczy się jako sprzed okresu", () => {
  near(run([pStock({ stockTranches: [tr(10, 3900, "2026-09-30")] })], { hist }).diff, 400);
});

test("okres: notowania w trakcie ładowania → pending; brak notowań → niepokryte", () => {
  const a = pStock({ stockTranches: [tr(10, 3000, "2026-03-01")] });
  let r = run([a], { hist: { prices: {}, fx: {} } });
  assert.equal(r.pending, true); assert.equal(r.diff, 0);
  r = run([a], { hist: { prices: { X: { [B]: null } }, fx: { USD: { [B]: { rate: 4 } } } } });
  assert.equal(r.diff, 0); assert.deepEqual(r.uncovered, [{ category: "Akcje", partial: false }]);
});

test("partie akcji: brak dat → null; transze niezgodne z ilością → null; createdAt → jedna partia", () => {
  assert.equal(stockLots(pStock()), null);
  assert.equal(stockLots(pStock({ stockTranches: [tr(4, 1, "2026-03-01")] })), null);
  assert.deepEqual(stockLots(pStock({ createdAt: "2026-10-02T08:00:00Z" })), [{ qty: 10, paidPLN: 3000, date: "2026-10-02" }]);
});

test("okres: obligacje sprzed okresu ze wzoru, kupione w okresie od nominału", () => {
  near(run([{ id: 2, category: "Obligacje", isBond: true, quantity: 10, purchaseDate: "2025-01-10", value: 1105 }], { bondValueAt: () => 1100 }).diff, 5);
  near(run([{ id: 2, category: "Obligacje", isBond: true, quantity: 10, purchaseDate: "2026-10-02", value: 1000.4 }],
    { bondValueAt: () => { throw new Error("nie powinno być wołane"); } }).diff, 0.4);
});

test("okres: konto — tylko odsetki po granicy (daty kapitalizacji w obu strefach czasowych)", () => {
  const sav = months => ({ id: 3, category: "Konto", isSavings: true, value: 5010, _calc: { accruedSinceCap: 3, months } });
  near(run([sav([{ date: "2026-09-30", interestNet: 15 }])]).diff, 3); // PL: kapitalizacja 1.10 zapisana jako 30.09
  near(run([sav([{ date: "2026-10-01", interestNet: 15 }])]).diff, 3); // UTC: to samo jako 01.10
  const yr = assets => calcPeriodBalance(assets, "2025-12-31", { today: TODAY, costBasis: () => 0 });
  near(yr([sav([{ date: "2025-12-31", interestNet: 9 }, { date: "2026-01-31", interestNet: 10 }, { date: "2026-09-30", interestNet: 15 }])]).diff, 28);
  near(yr([sav([{ date: "2026-01-01", interestNet: 9 }, { date: "2026-02-01", interestNet: 10 }, { date: "2026-10-01", interestNet: 15 }])]).diff, 28);
});

test("okres: zapas ze snapshotów dla kategorii bez dat", () => {
  const crypto = { id: 4, category: "Krypto", cryptoId: "btc", value: 1500, paid: 1000 };
  const snap = (date, v, p) => ({ date, byCategory: { Krypto: v }, paidByCategory: { Krypto: p } });
  let r = run([crypto], { series: [snap("2026-09-29", 1200, 1000)] });
  near(r.diff, 300); assert.equal(r.since, null);
  near(run([crypto], { series: [snap("2026-09-30", 700, 600)] }).diff, 400); // dokupienie w okresie nie jest zyskiem
  r = run([crypto], { series: [snap("2026-10-03", 1400, 1000)] });           // brak snapshotu sprzed okresu
  near(r.diff, 100); assert.equal(r.since, "2026-10-03");
  assert.deepEqual(run([crypto], { series: [snap("2026-08-01", 900, 1000)] }).uncovered, [{ category: "Krypto", partial: false }]); // za stary
  assert.equal(run([crypto], { series: [snap(TODAY, 1500, 1000), { date: "2026-09-29", total: 5, byCategory: {}, legacy: true }] }).uncovered.length, 1);
});

test("okres: kategoria mieszana — policzona część + dopisek o reszcie, bez zapasu ze snapshotów", () => {
  const r = run([pStock({ stockTranches: [tr(10, 3000, "2026-03-01")] }), pStock({ id: 9, stockSymbol: "Z" })],
    { hist, series: [{ date: "2026-09-29", byCategory: { Akcje: 1 }, paidByCategory: { Akcje: 1 } }] });
  near(r.diff, 400); assert.deepEqual(r.uncovered, [{ category: "Akcje", partial: true }]);
});

test("potrzebne notowania: tylko daty, przed którymi coś kupiono", () => {
  const nh = neededHistory([pStock({ stockExchange: "XNAS", stockTranches: [tr(10, 1, "2026-03-01")] })], ["2025-12-31", B]);
  assert.deepEqual(nh, [{ symbol: "X", exchange: "XNAS", currency: "USD", dates: [B] }]);
});

// ─── realizedLog ──────────────────────────────────────────────────────────────
const sale = (o = {}) => ({ id: "s1", portfolioId: "p", category: "Akcje / ETF", kind: "sale", date: "2026-10-02", symbol: "X", exchange: "XNAS", currency: "USD", qty: 2, openDate: "2026-03-01", costPLN: 700, salePLN: 900, pnlPLN: 200, ...o });
const cash = (kind, pnlPLN, date, id) => ({ id, portfolioId: "p", category: "Akcje / ETF", kind, date, pnlPLN });
const RB = "2026-09-30"; // dzień graniczny miesiąca

test("dziennik: ponowny import nie dubluje wpisów, a pusty przyrost zachowuje referencję", () => {
  const a = mergeRealized([], [sale(), cash("dividend", 5, "2026-10-01", "d1")]);
  assert.equal(a.next.length, 2);
  const b = mergeRealized(a.next, [sale(), cash("dividend", 5, "2026-10-01", "d1")]);
  assert.strictEqual(b.next, a.next); assert.equal(b.added.length, 0);
});

test("dziennik: sumy per portfel i kategoria, rozbicie na rodzaje, koszt sprzedanych", () => {
  const log = [sale(), cash("dividend", 10, "2026-10-01", "d1"), cash("tax", -1.5, "2026-10-01", "t1"), { ...sale({ id: "s2" }), portfolioId: "other" }, { ...cash("interest", 1, "2026-10-03", "i1"), category: "Inne" }];
  near(realizedTotal(log, "p"), 209.5);
  near(realizedTotal(log, "p", "Akcje / ETF"), 208.5);
  assert.deepEqual(realizedByKind(log, "p"), { sale: 200, dividend: 10, tax: -1.5, interest: 1 });
  near(realizedSoldCost(log, "p"), 700);
  assert.equal(removePortfolioFromRealized(log, "p").length, 1);
});

test("okres: dywidenda po dniu granicznym wchodzi, sprzed — nie", () => {
  const log = [cash("dividend", 10, "2026-10-01", "d1"), cash("dividend", 7, "2026-09-30", "d2")];
  near(realizedPeriod(log, "p", RB).sum, 10);
});

test("okres: sprzedaż partii kupionej w okresie liczy cały wynik", () => {
  const r = realizedPeriod([sale({ openDate: "2026-10-01" })], "p", RB);
  near(r.sum, 200); assert.equal(r.pending, false);
});

test("okres: sprzedaż partii kupionej przed okresem liczy tylko zmianę od dnia granicznego", () => {
  const h = { prices: { X: { [RB]: { close: 100 } } }, fx: { USD: { [RB]: { rate: 4 } } } };
  near(realizedPeriod([sale()], "p", RB, h).sum, 900 - 2 * 100 * 4); // 100, a nie 200 od zakupu
  assert.equal(realizedPeriod([sale()], "p", RB, { prices: {}, fx: {} }).pending, true);
  const none = realizedPeriod([sale()], "p", RB, { prices: { X: { [RB]: null } }, fx: { USD: { [RB]: { rate: 4 } } } });
  near(none.sum, 200); assert.equal(none.approx, 1); // brak kursu → cały wynik, ale z flagą
});

test("okres: sprzedaż sprzed okresu nie wchodzi", () => {
  near(realizedPeriod([sale({ date: "2026-09-15" })], "p", RB).sum, 0);
});

test("pseudo-aktywa do notowań: tylko sprzedane partie przecinające dzień graniczny", () => {
  const log = [sale(), sale({ id: "s2", openDate: "2026-10-01" }), sale({ id: "s3", date: "2026-09-10" })];
  const assets = realizedHistoryAssets(log, "p", [RB]);
  assert.equal(assets.length, 1);
  assert.deepEqual(neededHistory(assets, [RB]), [{ symbol: "X", exchange: "XNAS", currency: "USD", dates: [RB] }]);
});

test("import XTB: Closed Positions i Cash Operations → wpisy dziennika", () => {
  const wb = XLSX.utils.book_new();
  const hdrC = ["Instrument", "Ticker", "Category", "Type", "Volume", "Open Price", "Open Time (UTC)", "Close Price", "Close Time (UTC)", "Product", "Profit/Loss", "Gross Profit", "Purchase Value", "Sale Value", "Stop Loss", "Take Profit", "Commission", "Margin", "Swap", "Rollover", "Open Conversion Rate", "Close Conversion Rate", "Close Origin", "Position ID", "Comment"];
  const closed = ["Test_Corp", "TST.US", "STOCK", "BUY", 2, 100, 46000.5, 110, 46100.5, "IKE", 80, 80, 800, 880, "", "", 0, "", "", "", 4, 4, "iOS", 1000001, ""];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Account number", "1"], ["Closed Positions"], [], [], hdrC, closed, ["Profit/loss"], ["", "", "", "", "", "", "", "", "", "", 99]]), "Closed Positions");
  const hdrO = ["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment", "Product", "Position ID"];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Account number", "1"], ["Cash Operations"], [], [], hdrO,
    ["Dividend", "Test Corp", "TST.US", "STOCK", 46200.5, 3, "100", "x", "IKE", ""],
    ["Withholding tax", "Test Corp", "TST.US", "STOCK", 46200.5, -0.45, "101", "x", "IKE", ""],
    ["Free funds interest", "", "", "", 46210.5, 0.2, "102", "x", "IKE", ""],
    ["Stock purchase", "Test Corp", "TST.US", "STOCK", 46000.5, -800, "103", "OPEN BUY 2 @ 100", "IKE", "5"],
    ["Total", "", "", "", 0, 5.5, "", "", "", ""]]), "Cash Operations");
  const r = parseRealized(wb, "1");
  assert.equal(r.length, 4); // zakup i wiersz Total pominięte
  const s = r.find(e => e.kind === "sale");
  assert.deepEqual([s.symbol, s.exchange, s.currency, s.qty, s.openDate, s.date, s.costPLN, s.salePLN, s.pnlPLN], ["TST", "XNAS", "USD", 2, "2025-12-09", "2026-03-19", 800, 880, 80]);
  near(r.filter(e => e.kind !== "sale").reduce((a, e) => a + e.pnlPLN, 0), 2.75);
  assert.equal(new Set(r.map(e => e.id)).size, 4);
});

console.log(`OK — ${passed} testów`);
