// api/commodity-price.js — Vercel Serverless Proxy dla cen surowców
// Yahoo Finance futures (primary, darmowe) → GoldAPI.io (fallback)

const GOLDAPI_KEY = process.env.GOLDAPI_KEY || "goldapi-1ay1g1smnax7gq4-io";

// Mapowanie symbol → Yahoo Finance ticker futures
const YAHOO_TICKERS = {
  XAU: "GC=F",  // Gold Futures
  XAG: "SI=F",  // Silver Futures
  XPT: "PL=F",  // Platinum Futures
  XPD: "PA=F",  // Palladium Futures
};

// GoldAPI symbol mapping
const GOLDAPI_SYMBOLS = {
  XAU: "XAU",
  XAG: "XAG",
  XPT: "XPT",
  XPD: "XPD",
};

// Hardcoded fallback prices (USD/oz) — używane tylko gdy wszystko zawiedzie
const FALLBACK_PRICES = {
  XAU: 2650,
  XAG: 30,
  XPT: 950,
  XPD: 1050,
};

// ─── Yahoo Finance (bezpłatne, bez limitu) ─────────────────────────────────────
async function fetchYahooFutures(symbol) {
  const yahooTicker = YAHOO_TICKERS[symbol];
  if (!yahooTicker) return null;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice;
    if (!price || isNaN(price) || price <= 0) return null;

    return {
      priceUSD: parseFloat(price),
      provider: "yahoo",
      timestamp: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
    };
  } catch (e) {
    return null;
  }
}

// ─── GoldAPI.io (fallback, 100 req/mies.) ─────────────────────────────────────
async function fetchGoldAPI(symbol) {
  const goldSymbol = GOLDAPI_SYMBOLS[symbol];
  if (!goldSymbol || !GOLDAPI_KEY) return null;

  try {
    const url = `https://www.goldapi.io/api/${goldSymbol}/USD`;
    const res = await fetch(url, {
      headers: {
        "x-access-token": GOLDAPI_KEY,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // GoldAPI zwraca pole "price" (spot price) i "prev_close_price"
    const price = data?.price;
    if (!price || isNaN(price) || price <= 0) return null;

    return {
      priceUSD: parseFloat(price),
      provider: "goldapi",
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return null;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbols } = req.query;
  if (!symbols) {
    return res.status(400).json({ error: "Missing 'symbols'. Usage: /api/commodity-price?symbols=XAU,XAG" });
  }

  const symbolList = symbols.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const prices = {};

  await Promise.all(
    symbolList.map(async (symbol) => {
      // 1. Próbuj Yahoo Finance (darmowe, bez limitu)
      const yahoo = await fetchYahooFutures(symbol);
      if (yahoo) {
        prices[symbol] = yahoo;
        return;
      }

      // 2. Fallback: GoldAPI.io
      const goldapi = await fetchGoldAPI(symbol);
      if (goldapi) {
        prices[symbol] = goldapi;
        return;
      }

      // 3. Last resort: hardcoded fallback
      const fallback = FALLBACK_PRICES[symbol];
      if (fallback) {
        prices[symbol] = {
          priceUSD: fallback,
          provider: "fallback",
          timestamp: new Date().toISOString(),
        };
      }
    })
  );

  return res.status(200).json({
    prices,
    timestamp: new Date().toISOString(),
  });
}
