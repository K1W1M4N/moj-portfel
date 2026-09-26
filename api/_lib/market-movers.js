// api/market-movers.js
// Liderzy wzrostów i spadków:
//   Primary  → TradingView scanner (brak klucza, działa z serwera)
//   Fallback → Yahoo Finance screener

// ─── TradingView scanner ──────────────────────────────────────────────────────
const TV_COLUMNS = ["name", "description", "close", "change", "volume", "exchange"];

async function tvScan(market, filter, sortBy, sortOrder, count = 10) {
  const body = JSON.stringify({
    filter: filter || [],
    columns: TV_COLUMNS,
    sort: { sortBy, sortOrder },
    range: [0, count],
  });

  const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)",
      "Origin": "https://www.tradingview.com",
      "Referer": "https://www.tradingview.com/",
    },
    body,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`TradingView ${market} HTTP ${res.status}`);
  const data = await res.json();

  return (data.data || []).map(row => {
    const [symbol, name, close, change, volume, exchange] = row.d;
    return {
      symbol:   symbol  ?? "",
      name:     name    ?? symbol,
      close:    close   != null ? Math.round(close * 100) / 100 : null,
      change:   change  != null ? Math.round(change * 100) / 100 : null,
      volume:   volume  != null ? Math.round(volume) : null,
      exchange: exchange ?? "",
    };
  }).filter(r => r.symbol && r.change != null);
}

// ─── Yahoo Finance fallback ───────────────────────────────────────────────────
async function yahooScreener(screenerId, count = 10) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${screenerId}&count=${count}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Yahoo screener HTTP ${res.status}`);
  const data = await res.json();

  const quotes = data?.finance?.result?.[0]?.quotes || [];
  return quotes.map(q => ({
    symbol:   q.symbol ?? "",
    name:     q.longName || q.shortName || q.symbol,
    close:    q.regularMarketPrice ?? null,
    change:   q.regularMarketChangePercent != null ? Math.round(q.regularMarketChangePercent * 100) / 100 : null,
    volume:   q.regularMarketVolume ?? null,
    exchange: q.exchange ?? "",
  })).filter(r => r.symbol && r.change != null);
}

// ─── Fetch z próbą obu źródeł ─────────────────────────────────────────────────
async function fetchMovers(market, yahooGainersId, yahooLosersId) {
  try {
    const [gainers, losers] = await Promise.all([
      tvScan(market, [{ left: "change", operation: "greater", right: 0 }], "change", "desc"),
      tvScan(market, [{ left: "change", operation: "less",    right: 0 }], "change", "asc"),
    ]);
    return { gainers, losers, source: "tradingview" };
  } catch (e1) {
    console.warn(`TradingView ${market} failed:`, e1.message, "— trying Yahoo");
    try {
      const [gainers, losers] = await Promise.all([
        yahooScreener(yahooGainersId),
        yahooScreener(yahooLosersId),
      ]);
      return { gainers, losers, source: "yahoo" };
    } catch (e2) {
      console.error("Yahoo screener also failed:", e2.message);
      return { gainers: [], losers: [], source: "none", error: e2.message };
    }
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const market = req.query.market === "world" ? "world" : "poland";

  const yahooGainers = market === "world" ? "day_gainers"       : "day_gainers";
  const yahooLosers  = market === "world" ? "day_losers"        : "day_losers";
  const tvMarket     = market === "world" ? "global"            : "poland";

  const result = await fetchMovers(tvMarket, yahooGainers, yahooLosers);

  return res.status(200).json({
    ...result,
    market,
    fetchedAt: Date.now(),
  });
}
