// api/stock-chart.js — historyczne dane OHLCV z Yahoo Finance

const EXCHANGE_SUFFIX = {
  GPW: ".WA", WSE: ".WA", XWAR: ".WA",
  XETR: ".DE",
  XLON: ".L", LSE: ".L",
  XNAS: "", XNYS: "", NASDAQ: "", NYSE: "",
  XAMS: ".AS", XPAR: ".PA",
};

const RANGE_INTERVAL = {
  "5d":  "1h",
  "1mo": "1d",
  "3mo": "1d",
  "6mo": "1wk",
  "1y":  "1wk",
  "5y":  "1mo",
  "max": "1mo",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, exchange, range = "1mo" } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const suffix = EXCHANGE_SUFFIX[exchange] ?? "";
  const yahooSymbol = symbol + suffix;
  const interval = RANGE_INTERVAL[range] || "1d";

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) return res.status(502).json({ error: `Yahoo Finance returned ${r.status}` });

    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(502).json({ error: "No chart data" });

    const timestamps = result.timestamp || [];
    const closes    = result.indicators?.quote?.[0]?.close || [];
    const currency  = result.meta?.currency || "USD";

    const points = timestamps
      .map((ts, i) => ({ ts, close: closes[i] }))
      .filter(p => p.close != null && !isNaN(p.close));

    if (points.length === 0) return res.status(502).json({ error: "Empty chart data" });

    return res.status(200).json({ points, currency });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
