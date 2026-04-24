// api/fx-rate.js — Proxy kursów walut. Yahoo (primary) → NBP (fallback) → hardcoded.
// Yahoo daje kurs mid-market intraday, NBP daje fixing średni (raz dziennie).
// Różnica praktyczna 0.1–0.3% — Yahoo ciut bliżej kursu real-time używanego przez brokerów.

const FALLBACK = { USD: 4.0, EUR: 4.3, GBP: 5.0, CHF: 4.5 };

async function fetchYahoo(currency) {
  try {
    const symbol = `${currency.toUpperCase()}PLN=X`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const rate = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (rate && !isNaN(rate) && rate > 0) return { rate: parseFloat(rate), source: "yahoo" };
    return null;
  } catch { return null; }
}

async function fetchNBP(currency) {
  for (const table of ["a", "b"]) {
    try {
      const url = `https://api.nbp.pl/api/exchangerates/rates/${table}/${currency.toLowerCase()}/last/1/?format=json`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const data = await r.json();
      const rate = data.rates?.[0]?.mid;
      if (rate) return { rate: parseFloat(rate), source: `nbp-${table}` };
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // 10 min edge cache — kurs intraday zmienia się plynnie, cache oszczedza Yahoo
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { currency, currencies } = req.query;

  // Batch mode: ?currencies=USD,EUR,GBP → { rates: { USD: 3.6, EUR: 4.25, ... } }
  if (currencies) {
    const list = currencies.split(",").map(c => c.trim().toUpperCase()).filter(Boolean);
    const rates = {};
    const sources = {};
    await Promise.all(list.map(async cur => {
      if (cur === "PLN") { rates.PLN = 1; sources.PLN = "static"; return; }
      const yahoo = await fetchYahoo(cur);
      if (yahoo) { rates[cur] = yahoo.rate; sources[cur] = yahoo.source; return; }
      const nbp = await fetchNBP(cur);
      if (nbp) { rates[cur] = nbp.rate; sources[cur] = nbp.source; return; }
      rates[cur] = FALLBACK[cur] || 4.0;
      sources[cur] = "fallback";
    }));
    return res.status(200).json({ rates, sources, ts: new Date().toISOString() });
  }

  // Single mode: ?currency=USD → { rate, source, ts }
  if (!currency) return res.status(400).json({ error: "Missing 'currency' or 'currencies' parameter" });

  const cur = currency.toUpperCase();
  if (cur === "PLN") return res.status(200).json({ rate: 1, source: "static", ts: new Date().toISOString() });

  const yahoo = await fetchYahoo(cur);
  if (yahoo) return res.status(200).json({ ...yahoo, ts: new Date().toISOString() });

  const nbp = await fetchNBP(cur);
  if (nbp) return res.status(200).json({ ...nbp, ts: new Date().toISOString() });

  return res.status(200).json({ rate: FALLBACK[cur] || 4.0, source: "fallback", ts: new Date().toISOString() });
}
