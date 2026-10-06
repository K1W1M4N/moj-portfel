// api/price-at.js — kurs zamknięcia instrumentu i kurs waluty NA WSKAZANY DZIEŃ (ostatnia sesja ≤ data).
// Używane do bilansu miesiąca/roku: wartość pozycji na początek okresu liczymy z faktycznych notowań.
//
//   /api/price-at?symbols=CDR,AAPL&exchanges=XWAR,XNAS&currencies=USD,EUR&dates=2025-12-31,2026-09-30
//   → { prices: { CDR: { "2026-09-30": { close, date, currency, provider } | null } },
//       fx:     { USD: { "2026-09-30": { rate, date, source } | null } } }
//
// Akcje: Yahoo (dzienne świece) → Stooq CSV → Biznesradar (dwa ostatnie tylko GPW).
// Waluty: Yahoo (XXXPLN=X) → NBP (tabela A, fixing średni).

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" };

const EXCHANGE_MAP = {
  GPW: { yahoo: ".WA", stooq: ".pl" }, WSE: { yahoo: ".WA", stooq: ".pl" }, XWAR: { yahoo: ".WA", stooq: ".pl" },
  XETR: { yahoo: ".DE", stooq: ".de" },
  XLON: { yahoo: ".L", stooq: ".uk" }, LSE: { yahoo: ".L", stooq: ".uk" },
  XNAS: { yahoo: "", stooq: ".us" }, XNYS: { yahoo: "", stooq: ".us" }, NASDAQ: { yahoo: "", stooq: ".us" }, NYSE: { yahoo: "", stooq: ".us" },
  XAMS: { yahoo: ".AS", stooq: "" }, XPAR: { yahoo: ".PA", stooq: "" },
};
const isGPW = ex => ["GPW", "WSE", "XWAR"].includes(ex);

const DAY = 86400;
const toTs = dateStr => Math.floor(Date.parse(dateStr + "T00:00:00Z") / 1000);
const toDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);

// Z posortowanych rosnąco punktów { day, close } wybiera ostatni z dniem ≤ date
function pickAtOrBefore(points, date) {
  let best = null;
  for (const p of points) {
    if (p.day <= date) best = p; else break;
  }
  return best;
}

// Dzienne zamknięcia z Yahoo w oknie [from-10 dni, to]; dzień sesji liczony w strefie giełdy (gmtoffset)
async function yahooDaily(yahooSymbol, from, to) {
  try {
    const p1 = toTs(from) - 10 * DAY, p2 = toTs(to) + 2 * DAY;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${p1}&period2=${p2}&interval=1d`;
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const result = (await r.json())?.chart?.result?.[0];
    if (!result) return null;
    const offset = result.meta?.gmtoffset || 0;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = (result.timestamp || [])
      .map((ts, i) => ({ day: toDay(ts + offset), close: closes[i] }))
      .filter(p => p.close != null && !isNaN(p.close) && p.close > 0);
    if (points.length === 0) return null;
    return { points, currency: result.meta?.currency || null };
  } catch { return null; }
}

async function stooqDaily(stooqSymbol, from, to) {
  try {
    const d = s => s.replace(/-/g, "");
    const start = toDay(toTs(from) - 10 * DAY);
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol.toLowerCase())}&d1=${d(start)}&d2=${d(to)}&i=d`;
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.includes("<html") || text.includes("apikey") || !/^Date,/i.test(text.trim())) return null;
    // Date,Open,High,Low,Close,Volume
    const points = text.trim().split("\n").slice(1)
      .map(line => { const c = line.split(","); return { day: c[0], close: parseFloat(c[4]) }; })
      .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.day) && p.close > 0);
    return points.length ? { points } : null;
  } catch { return null; }
}

async function biznesradarDaily(symbol) {
  try {
    const url = `https://www.biznesradar.pl/notowania-historyczne/${encodeURIComponent(symbol.toUpperCase())}`;
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const html = await r.text();
    const rowRe = /<td>(\d{2})\.(\d{2})\.(\d{4})<\/td>\s*<td>[^<]+<\/td>\s*<td>[^<]+<\/td>\s*<td>[^<]+<\/td>\s*<td>([^<]+)<\/td>/g;
    const points = [];
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      const close = parseFloat(m[4].replace(/\s/g, "").replace(",", "."));
      if (close > 0) points.push({ day: `${m[3]}-${m[2]}-${m[1]}`, close });
    }
    points.sort((a, b) => (a.day > b.day ? 1 : -1));
    return points.length ? { points } : null;
  } catch { return null; }
}

// Uzupełnia `out[date]` z danego źródła dla dat, których jeszcze brakuje.
// Odrzuca dopasowania starsze niż 10 dni od daty (dziura w danych / instrument jeszcze nienotowany).
function fill(out, dates, series, extra) {
  if (!series) return;
  for (const date of dates) {
    if (out[date]) continue;
    const p = pickAtOrBefore(series.points, date);
    if (p && toTs(date) - toTs(p.day) <= 10 * DAY) out[date] = { close: p.close, date: p.day, ...extra(series) };
  }
}

async function priceAtDates(symbol, exchange, dates) {
  const map = EXCHANGE_MAP[exchange] || { yahoo: "", stooq: "" };
  const from = dates[0], to = dates[dates.length - 1];
  const out = {};
  const missing = () => dates.some(d => !out[d]);

  fill(out, dates, await yahooDaily(symbol + map.yahoo, from, to), s => ({ currency: s.currency, provider: "yahoo" }));
  if (missing() && (map.stooq || isGPW(exchange))) {
    fill(out, dates, await stooqDaily(symbol + map.stooq, from, to), () => ({ currency: isGPW(exchange) ? "PLN" : null, provider: "stooq" }));
  }
  if (missing() && isGPW(exchange)) {
    fill(out, dates, await biznesradarDaily(symbol), () => ({ currency: "PLN", provider: "biznesradar" }));
  }
  for (const d of dates) out[d] ??= null;
  return out;
}

async function nbpAt(currency, date) {
  try {
    const start = toDay(toTs(date) - 10 * DAY);
    const url = `https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/${start}/${date}/?format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const last = (await r.json())?.rates?.at(-1);
    return last?.mid > 0 ? { rate: last.mid, date: last.effectiveDate, source: "nbp-a" } : null;
  } catch { return null; }
}

async function fxAtDates(currency, dates) {
  const out = {};
  if (currency === "PLN") {
    for (const d of dates) out[d] = { rate: 1, date: d, source: "static" };
    return out;
  }
  const y = await yahooDaily(`${currency}PLN=X`, dates[0], dates[dates.length - 1]);
  if (y) {
    for (const date of dates) {
      const p = pickAtOrBefore(y.points, date);
      if (p && toTs(date) - toTs(p.day) <= 10 * DAY) out[date] = { rate: p.close, date: p.day, source: "yahoo" };
    }
  }
  for (const date of dates) out[date] ??= await nbpAt(currency, date);
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const list = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const dates = [...new Set(list(req.query.dates))].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today).sort();
  if (dates.length === 0 || dates.length > 6) {
    return res.status(400).json({ error: "Parametr 'dates': 1–6 przeszłych dat w formacie YYYY-MM-DD" });
  }

  const symbols = list(req.query.symbols).slice(0, 60);
  const exchanges = String(req.query.exchanges || "").split(",").map(s => s.trim());
  const currencies = [...new Set(list(req.query.currencies).map(c => c.toUpperCase()))].filter(c => /^[A-Z]{3}$/.test(c)).slice(0, 10);

  const prices = {}, fx = {};
  await Promise.all([
    ...symbols.map(async (sym, i) => { prices[sym] = await priceAtDates(sym, exchanges[i] || "XNAS", dates); }),
    ...currencies.map(async cur => { fx[cur] = await fxAtDates(cur, dates); }),
  ]);

  // Notowania historyczne się nie zmieniają — długi cache na brzegu, ale tylko gdy komplet danych
  const complete = [...Object.values(prices), ...Object.values(fx)].every(byDate => Object.values(byDate).every(Boolean));
  res.setHeader("Cache-Control", complete ? "public, s-maxage=86400, stale-while-revalidate=604800" : "no-store");
  return res.status(200).json({ prices, fx, dates });
}
