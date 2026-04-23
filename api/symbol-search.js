// api/symbol-search.js — Vercel Serverless Proxy do wyszukiwarki symboli
// Yahoo Finance search (primary, pokrywa GPW + NewConnect) + Twelve Data (supplement dla ETF)

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || "a681abc9ebc045a39c938d8b058567d9";

// Mapowanie kodów giełd Yahoo → nasze kody (używane przez api/stock-price.js)
const YAHOO_EXCHANGE_MAP = {
  WSE: "XWAR",          // Warsaw (GPW + NewConnect)
  NMS: "XNAS", NGM: "XNAS", NCM: "XNAS",  // NASDAQ tiers
  NYQ: "XNYS",          // NYSE
  ASE: "XNYS", PCX: "XNYS", BATS: "XNYS",
  GER: "XETR", FRA: "XETR",  // Frankfurt
  LSE: "XLON",
  AMS: "XAMS",
  PAR: "XPAR",
};

// Mapowanie kodów giełd Twelve Data → nasze kody (do spójnego dedup)
const TD_EXCHANGE_MAP = {
  GPW: "XWAR", WSE: "XWAR",
  NASDAQ: "XNAS", NYSE: "XNYS",
  FSX: "XETR", XETRA: "XETR",
  LSE: "XLON",
};

function normalizeYahooSymbol(symbol) {
  // Yahoo zwraca ICE.WA, BMW.DE, itd. — nasz stock-price.js sam dodaje sufiks
  return symbol.replace(/\.(WA|DE|L|AS|PA|F)$/i, "");
}

function mapYahooExchange(yahooExch) {
  return YAHOO_EXCHANGE_MAP[yahooExch] || yahooExch;
}

function yahooCurrencyForExchange(exchange) {
  const map = { XWAR: "PLN", XETR: "EUR", XLON: "GBP", XNAS: "USD", XNYS: "USD", XAMS: "EUR", XPAR: "EUR" };
  return map[exchange] || "USD";
}

// ─── Yahoo Finance search ─────────────────────────────────────────────────────
async function searchYahoo(query) {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=pl-PL&region=PL&quotesCount=20&newsCount=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const quotes = data?.quotes || [];

    return quotes
      .filter(q => q.isYahooFinance && ["EQUITY", "ETF"].includes(q.quoteType))
      // tylko giełdy, które obsługuje nasz stock-price.js
      .filter(q => YAHOO_EXCHANGE_MAP[q.exchange])
      .map(q => {
        const exchange = mapYahooExchange(q.exchange);
        return {
          symbol: normalizeYahooSymbol(q.symbol),
          name: q.longname || q.shortname || q.symbol,
          exchange,
          currency: yahooCurrencyForExchange(exchange),
          type: q.quoteType === "ETF" ? "ETF" : "Common Stock",
          source: "yahoo",
        };
      });
  } catch {
    return [];
  }
}

// ─── Twelve Data search (supplement) ──────────────────────────────────────────
async function searchTwelveData(query) {
  try {
    const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&outputsize=30&apikey=${TWELVE_DATA_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .filter(r => ["Common Stock", "ETF"].includes(r.instrument_type))
      // pomijamy giełdy nieobsługiwane przez nasz stock-price.js (BMV, TASE, PSX, IDX, OTC...)
      .filter(r => TD_EXCHANGE_MAP[r.exchange])
      .map(r => ({
        symbol: r.symbol,
        name: r.instrument_name,
        exchange: TD_EXCHANGE_MAP[r.exchange],
        currency: r.currency,
        type: r.instrument_type,
        source: "twelvedata",
      }));
  } catch {
    return [];
  }
}

// ─── Merge + dedup (preferuj Yahoo — lepsze pokrycie GPW) ─────────────────────
function mergeResults(yahoo, td) {
  const seen = new Map();
  for (const r of [...yahoo, ...td]) {
    const key = `${r.symbol}|${r.exchange}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values());
}

// ─── Sortowanie: GPW / ETF DE pierwsze ────────────────────────────────────────
const EXCHANGE_PRIORITY = ["XWAR", "WSE", "XETR", "XAMS", "XPAR", "XLON", "XNAS", "XNYS"];
function sortResults(results) {
  return [...results].sort((a, b) => {
    const ai = EXCHANGE_PRIORITY.indexOf(a.exchange);
    const bi = EXCHANGE_PRIORITY.indexOf(b.exchange);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ─── API Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const q = (req.query.q || "").toString().trim();
  if (q.length < 2) return res.status(400).json({ error: "Query too short (min 2 chars)" });

  // Auto-strip końcówki giełdy wpisanej przez usera (np. IUSQ.DE → IUSQ)
  const cleanQ = q.replace(/\.[A-Za-z]+$/, "").trim() || q;

  // Cache na edge 1h — wyszukiwanie jest per-query, rzadko się zmienia
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");

  // Yahoo + TD równolegle; TD jest supplementem
  const [yahoo, td] = await Promise.all([searchYahoo(cleanQ), searchTwelveData(cleanQ)]);
  const merged = sortResults(mergeResults(yahoo, td));

  return res.status(200).json({
    results: merged.slice(0, 15),
    timestamp: new Date().toISOString(),
  });
}
