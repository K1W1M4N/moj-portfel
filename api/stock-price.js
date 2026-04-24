// api/stock-price.js — Vercel Serverless Proxy dla cen akcji/ETF
// Yahoo Finance v8 (primary) → Stooq CSV (fallback GPW) → Twelve Data (last resort)

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || "a681abc9ebc045a39c938d8b058567d9";

// ─── Mapowanie giełd ──────────────────────────────────────────────────────────
const EXCHANGE_MAP = {
  GPW:    { yahooSuffix: ".WA",  stooqSuffix: ".pl", currency: "PLN" },
  WSE:    { yahooSuffix: ".WA",  stooqSuffix: ".pl", currency: "PLN" },
  XWAR:   { yahooSuffix: ".WA",  stooqSuffix: ".pl", currency: "PLN" },
  XETR:   { yahooSuffix: ".DE",  stooqSuffix: ".de", currency: "EUR" },
  XLON:   { yahooSuffix: ".L",   stooqSuffix: ".uk", currency: "GBP" },
  LSE:    { yahooSuffix: ".L",   stooqSuffix: ".uk", currency: "GBP" },
  XNAS:   { yahooSuffix: "",     stooqSuffix: ".us", currency: "USD" },
  XNYS:   { yahooSuffix: "",     stooqSuffix: ".us", currency: "USD" },
  NASDAQ: { yahooSuffix: "",     stooqSuffix: ".us", currency: "USD" },
  NYSE:   { yahooSuffix: "",     stooqSuffix: ".us", currency: "USD" },
  XAMS:   { yahooSuffix: ".AS",  stooqSuffix: "",    currency: "EUR" },
  XPAR:   { yahooSuffix: ".PA",  stooqSuffix: "",    currency: "EUR" },
};

function isGPW(exchange) {
  return ["GPW", "WSE", "XWAR"].includes(exchange);
}

// ─── Yahoo Finance v8 ─────────────────────────────────────────────────────────
async function fetchYahoo(symbol, exchange) {
  const map = EXCHANGE_MAP[exchange] || { yahooSuffix: "", currency: "USD" };
  const yahooSymbol = symbol + map.yahooSuffix;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice;
    if (!price || isNaN(price)) return null;

    return {
      price: parseFloat(price),
      currency: meta.currency || map.currency,
      provider: "yahoo",
      timestamp: new Date(meta.regularMarketTime * 1000).toISOString(),
    };
  } catch (e) {
    return null;
  }
}

// ─── Stooq live quote (endpoint /q/l/ — bez API key) ──────────────────────────
async function fetchStooq(symbol, exchange) {
  const map = EXCHANGE_MAP[exchange] || { stooqSuffix: "", currency: "PLN" };
  const stooqSymbol = (symbol + map.stooqSuffix).toLowerCase();

  try {
    // /q/l/ zwraca live quote: Symbol,Date,Time,Open,High,Low,Close,Volume
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const text = await res.text();
    if (text.includes("<html") || text.includes("apikey")) return null;

    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;

    const parts = lines[1].split(",");
    if (parts.length < 7) return null;

    const close = parseFloat(parts[6]);
    if (isNaN(close) || close <= 0) return null;

    return {
      price: close,
      currency: map.currency,
      provider: "stooq",
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return null;
  }
}

// ─── Biznesradar.pl (scraping — pełne pokrycie GPW + NewConnect) ─────────────
async function fetchBiznesradar(symbol, exchange) {
  if (!isGPW(exchange)) return null;
  try {
    const url = `https://www.biznesradar.pl/notowania/${encodeURIComponent(symbol.toUpperCase())}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Pierwszy <span class="q_ch_act"> w profile-header = aktualny kurs
    const priceMatch = html.match(/<span class="q_ch_act">([^<]+)<\/span>/);
    if (!priceMatch) return null;

    const priceStr = priceMatch[1].replace(/\s/g, "").replace(",", ".");
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return null;

    const tMatch = html.match(/<time class="q_ch_date" datetime="([^"]+)"/);
    const timestamp = tMatch ? new Date(tMatch[1]).toISOString() : new Date().toISOString();

    return {
      price,
      currency: "PLN",
      provider: "biznesradar",
      timestamp,
    };
  } catch (e) {
    return null;
  }
}

// ─── Twelve Data (fallback) ───────────────────────────────────────────────────
async function fetchTwelveData(symbol) {
  try {
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_DATA_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();

    if (data?.price && !isNaN(parseFloat(data.price))) {
      return {
        price: parseFloat(data.price),
        currency: null, // Twelve Data nie zwraca waluty w /price
        provider: "twelvedata",
        timestamp: new Date().toISOString(),
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ─── Provider Chain ───────────────────────────────────────────────────────────
async function fetchPrice(symbol, exchange) {
  // GPW → Stooq (szybkie CSV) → Yahoo → Biznesradar (scraping, ale pełne pokrycie NC).
  // Bez TD: /price nie przyjmuje giełdy, więc dla MDT zwróciłby Medtronic (USD) zamiast sygnalizować brak.
  if (isGPW(exchange)) {
    const stooq = await fetchStooq(symbol, exchange);
    if (stooq) return stooq;

    const yahoo = await fetchYahoo(symbol, exchange);
    if (yahoo) return yahoo;

    const br = await fetchBiznesradar(symbol, exchange);
    if (br) return br;

    return null;
  }

  // Zagraniczne → Yahoo first, Stooq fallback, TD last resort
  const yahoo = await fetchYahoo(symbol, exchange);
  if (yahoo) return yahoo;

  const stooq = await fetchStooq(symbol, exchange);
  if (stooq) return stooq;

  const td = await fetchTwelveData(symbol);
  if (td) return td;

  return null;
}

// ─── API Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { symbols, exchanges } = req.query;

  if (!symbols) {
    return res.status(400).json({ error: "Missing 'symbols' parameter. Usage: /api/stock-price?symbols=CDR,AAPL&exchanges=GPW,XNAS" });
  }

  const symbolList = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const exchangeList = exchanges ? exchanges.split(",").map(s => s.trim()) : [];

  const prices = {};
  const errors = {};

  // Fetch all prices in parallel
  await Promise.all(
    symbolList.map(async (symbol, i) => {
      const exchange = exchangeList[i] || "XNAS"; // Default: NASDAQ
      try {
        const result = await fetchPrice(symbol, exchange);
        if (result) {
          prices[symbol] = result;
        } else {
          errors[symbol] = "No price data from any provider";
        }
      } catch (e) {
        errors[symbol] = e.message || "Unknown error";
      }
    })
  );

  return res.status(200).json({
    prices,
    errors,
    timestamp: new Date().toISOString(),
  });
}
