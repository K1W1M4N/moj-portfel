// src/historyStore.js — dzienne snapshoty wartości portfela (klucz "pt-history").
//
// Format wpisu (jeden na dzień, wspólny dla wszystkich portfeli):
//   { date: "2026-10-06", byPortfolio: { [portfolioId]: { total, paid, byCategory, paidByCategory } } }
// Stary format (przed rozdzieleniem portfeli): { date, total, byCategory } — traktowany jako portfel "default"
// i oznaczany flagą legacy, bo nie wiadomo, którą zakładkę widział użytkownik w chwili zapisu.
// Odczyt toleruje oba formaty, więc dane z chmury w starym formacie nie wymagają osobnej migracji.

const MAX_DAYS = 365;
const LEGACY_PORTFOLIO = "default";

export function localDateStr(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const round2 = n => Math.round(n * 100) / 100;

function roundMap(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) if (v > 0) out[k] = round2(v);
  return out;
}

// Snapshot jednego portfela z danego wpisu (albo null)
export function snapshotOf(entry, portfolioId) {
  if (!entry) return null;
  if (entry.byPortfolio) return entry.byPortfolio[portfolioId] ?? null;
  if (portfolioId === LEGACY_PORTFOLIO && typeof entry.total === "number") {
    return { total: entry.total, paid: null, byCategory: entry.byCategory || {}, paidByCategory: null, legacy: true };
  }
  return null;
}

// Seria dla jednego portfela: [{ date, total, paid, byCategory, paidByCategory, legacy? }] rosnąco po dacie
export function historySeries(history, portfolioId) {
  const out = [];
  for (const e of history || []) {
    const s = snapshotOf(e, portfolioId);
    if (s) out.push({ date: e.date, ...s });
  }
  return out;
}

// Wstawia/nadpisuje dzisiejszy snapshot portfela. Zwraca tę samą referencję, gdy nic się nie zmieniło.
export function upsertSnapshot(history, portfolioId, snap, date = localDateStr()) {
  const next = {
    total: round2(snap.total),
    paid: round2(snap.paid),
    byCategory: roundMap(snap.byCategory),
    paidByCategory: roundMap(snap.paidByCategory),
  };
  const list = history || [];
  const last = list[list.length - 1];

  if (last && last.date === date) {
    const prev = snapshotOf(last, portfolioId);
    if (prev && JSON.stringify({ ...prev, legacy: undefined }) === JSON.stringify({ ...next, legacy: undefined })) return history;
    const byPortfolio = last.byPortfolio
      ? { ...last.byPortfolio }
      : last.total != null ? { [LEGACY_PORTFOLIO]: snapshotOf(last, LEGACY_PORTFOLIO) } : {};
    byPortfolio[portfolioId] = next;
    return [...list.slice(0, -1), { date, byPortfolio }];
  }

  const merged = [...list, { date, byPortfolio: { [portfolioId]: next } }];
  while (merged.length > MAX_DAYS) merged.shift();
  return merged;
}

// Po usunięciu portfela: wyrzuć jego snapshoty (wpisy w starym formacie zostają — nie da się ich przypisać)
export function removePortfolioFromHistory(history, portfolioId) {
  return (history || [])
    .map(e => {
      if (!e.byPortfolio || !(portfolioId in e.byPortfolio)) return e;
      const { [portfolioId]: _drop, ...rest } = e.byPortfolio;
      return { ...e, byPortfolio: rest };
    })
    .filter(e => !e.byPortfolio || Object.keys(e.byPortfolio).length > 0);
}
