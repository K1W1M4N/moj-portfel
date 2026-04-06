// api/stock-news.js — Newsy finansowe dla spółki/ETF z Yahoo Finance

// Wykrywa czy nazwa to ETF
function detectETF(name = "") {
  return /\b(ETF|UCITS|iShares|Vanguard|Xtrackers|SPDR|Lyxor|Amundi|WisdomTree|Invesco|MSCI|FTSE)\b/i.test(name);
}

// Wyciąga nazwę indeksu z pełnej nazwy ETF
// np. "iShares Core MSCI World UCITS ETF USD (Acc)" → "MSCI World"
// np. "Vanguard FTSE All-World UCITS ETF" → "FTSE All-World"
// np. "Xtrackers S&P 500 Swap UCITS ETF" → "S&P 500"
function extractIndexName(name = "") {
  return name
    .replace(/^(iShares\s+Core\s+|iShares\s+|Vanguard\s+|Xtrackers\s+|SPDR\s+|Lyxor\s+|Amundi\s+|WisdomTree\s+|Invesco\s+|BlackRock\s+)/i, "")
    .replace(/\s+(Swap\s+)?UCITS\s+ETF.*/i, "")
    .replace(/\s+ETF.*/i, "")
    .replace(/\s+(USD|EUR|PLN|GBP)\s*\(.*\)\s*$/i, "")
    .replace(/\s+(USD|EUR|PLN|GBP)\s*$/i, "")
    .trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing 'symbol' parameter" });

  // Inteligentne zapytanie: dla ETF wyciągnij nazwę indeksu
  const isEtf = detectETF(symbol);
  const searchQuery = isEtf ? (extractIndexName(symbol) || symbol) : symbol;

  // Próba 1: Yahoo Finance v1 search
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&newsCount=8&enableFuzzyQuery=false&enableCb=false&enableNavLinks=false&enableEnhancedTrivialQuery=true`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
    const data = await r.json();

    const articles = (data.news || [])
      .map(n => ({
        title:       n.title        || null,
        publisher:   n.publisher    || null,
        link:        n.link         || null,
        publishedAt: n.providerPublishTime ? n.providerPublishTime * 1000 : null,
        thumbnail:   n.thumbnail?.resolutions?.[0]?.url || null,
      }))
      .filter(a => a.title && a.link);

    return res.status(200).json({ articles, fetchedAt: Date.now(), searchQuery, isEtf });
  } catch (e1) {
    // Próba 2: Yahoo Finance v2 news
    try {
      const url2 = `https://query2.finance.yahoo.com/v2/finance/news?symbols=${encodeURIComponent(searchQuery)}&count=8`;
      const r2 = await fetch(url2, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r2.ok) throw new Error(`Yahoo v2 HTTP ${r2.status}`);
      const data2 = await r2.json();

      const items = data2?.items?.result || [];
      const articles = items
        .map(n => ({
          title:       n.title     || null,
          publisher:   n.publisher || null,
          link:        n.clickThroughUrl?.url || n.canonicalUrl?.url || null,
          publishedAt: n.pubDate ? new Date(n.pubDate).getTime() : null,
          thumbnail:   n.thumbnail?.url || null,
        }))
        .filter(a => a.title && a.link);

      return res.status(200).json({ articles, fetchedAt: Date.now(), searchQuery, isEtf });
    } catch (e2) {
      console.error("stock-news: both endpoints failed", e1.message, e2.message);
      return res.status(502).json({ error: "Could not fetch news", details: e2.message });
    }
  }
}
