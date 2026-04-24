// api/stock-chart.js — historyczne OHLCV z Yahoo Finance, fallback Biznesradar (GPW)

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

const RANGE_DAYS = {
  "5d": 7, "1mo": 31, "3mo": 93, "6mo": 186, "1y": 366, "5y": 1830, "max": 99999,
};

function isGPW(exchange) {
  return ["GPW", "WSE", "XWAR"].includes(exchange);
}

async function fetchYahooChart(yahooSymbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;

  const data = await r.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const closes    = result.indicators?.quote?.[0]?.close || [];
  const currency  = result.meta?.currency || "USD";

  const points = timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter(p => p.close != null && !isNaN(p.close));

  if (points.length === 0) return null;
  return { points, currency };
}

// Parsuje tabelę /notowania-historyczne/{SYMBOL}: Data | Open | High | Low | Close | Wolumen | Obrót
async function fetchBiznesradarChart(symbol, range) {
  try {
    const url = `https://www.biznesradar.pl/notowania-historyczne/${encodeURIComponent(symbol.toUpperCase())}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Wyłów wiersze: <td>DD.MM.YYYY</td><td>open</td><td>high</td><td>low</td><td>close</td><td>vol</td><td>mc</td>
    const rowRe = /<td>(\d{2}\.\d{2}\.\d{4})<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>/g;
    const points = [];
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      const [, dateStr, , , , closeStr] = m;
      const [dd, mm, yyyy] = dateStr.split(".");
      const ts = Math.floor(new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`).getTime() / 1000);
      const close = parseFloat(closeStr.replace(/\s/g, "").replace(",", "."));
      if (!isNaN(close) && close > 0 && !isNaN(ts)) {
        points.push({ ts, close });
      }
    }
    if (points.length === 0) return null;

    // Tabela idzie od najnowszych — posortuj rosnąco i przytnij do range
    points.sort((a, b) => a.ts - b.ts);
    const days = RANGE_DAYS[range] || 31;
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const filtered = points.filter(p => p.ts >= cutoff);
    const final = filtered.length > 0 ? filtered : points;

    return { points: final, currency: "PLN" };
  } catch (e) {
    return null;
  }
}

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
    // Yahoo — szybki JSON
    const yahoo = await fetchYahooChart(yahooSymbol, range, interval);
    if (yahoo) return res.status(200).json(yahoo);

    // Fallback Biznesradar dla GPW/NewConnect
    if (isGPW(exchange)) {
      const br = await fetchBiznesradarChart(symbol, range);
      if (br) return res.status(200).json(br);
    }

    return res.status(502).json({ error: "No chart data from any provider" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
