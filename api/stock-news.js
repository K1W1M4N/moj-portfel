// api/stock-news.js — Newsy finansowe dla spółki/ETF (Yahoo Finance + Bankier.pl dla GPW)

// ─── Helpers ETF ──────────────────────────────────────────────────────────────
function detectETF(name = "") {
  return /\b(ETF|UCITS|iShares|Vanguard|Xtrackers|SPDR|Lyxor|Amundi|WisdomTree|Invesco|MSCI|FTSE)\b/i.test(name);
}

function extractIndexName(name = "") {
  return name
    .replace(/^(iShares\s+Core\s+|iShares\s+|Vanguard\s+|Xtrackers\s+|SPDR\s+|Lyxor\s+|Amundi\s+|WisdomTree\s+|Invesco\s+|BlackRock\s+)/i, "")
    .replace(/\s+(Swap\s+)?UCITS\s+ETF.*/i, "")
    .replace(/\s+ETF.*/i, "")
    .replace(/\s+(USD|EUR|PLN|GBP)\s*\(.*\)\s*$/i, "")
    .replace(/\s+(USD|EUR|PLN|GBP)\s*$/i, "")
    .trim();
}

// ─── Parser RSS ───────────────────────────────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
      return m ? m[1].trim() : null;
    };
    const title       = get("title");
    const link        = get("link") || get("guid");
    const pubDate     = get("pubDate") || get("dc:date");
    const publisher   = get("author") || get("dc:creator") || null;
    if (title && link) {
      items.push({
        title,
        link,
        publisher,
        publishedAt: pubDate ? new Date(pubDate).getTime() : null,
        thumbnail: null,
      });
    }
  }
  return items;
}

// ─── Bankier.pl RSS dla spółki GPW ───────────────────────────────────────────
async function fetchBankier(ticker) {
  // Bankier używa własnych skrótów — próbujemy kilka wariantów URL
  const urls = [
    `https://www.bankier.pl/rss/spolka/${ticker}.xml`,
    `https://www.bankier.pl/rss/spółka/${ticker}.xml`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = parseRSS(xml);
      if (items.length > 0) {
        return items.map(a => ({ ...a, publisher: a.publisher || "Bankier.pl" }));
      }
    } catch { /* próbuj dalej */ }
  }
  return [];
}

// ─── Sprawdzenie czy spółka jest z GPW ───────────────────────────────────────
function isPolishStock(exchange = "") {
  return /^(WSE|GPW|XWAR|NC|NewConnect)$/i.test(exchange.trim());
}

// ─── Handler główny ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, exchange } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing 'symbol' parameter" });

  const isEtf    = detectETF(symbol);
  const isPL     = isPolishStock(exchange || "");
  const searchQuery = isEtf ? (extractIndexName(symbol) || symbol) : symbol;

  // ─── Fetch równoległy: Yahoo Finance + opcjonalnie Bankier ─────────────────
  const [yahooArticles, bankierArticles] = await Promise.all([
    fetchYahoo(searchQuery),
    isPL && !isEtf ? fetchBankier(symbol) : Promise.resolve([]),
  ]);

  // Scalanie i deduplicacja po tytule
  const seen = new Set();
  const articles = [...bankierArticles, ...yahooArticles]
    .filter(a => {
      if (!a.title || !a.link) return false;
      const key = a.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
    .slice(0, 10);

  return res.status(200).json({ articles, fetchedAt: Date.now(), searchQuery, isEtf, isPL });
}

// ─── Yahoo Finance fetch (wydzielone dla czytelności) ─────────────────────────
async function fetchYahoo(query) {
  // Próba 1: Yahoo Finance v1 search
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=8&enableFuzzyQuery=false&enableCb=false&enableNavLinks=false&enableEnhancedTrivialQuery=true`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
    const data = await r.json();
    return (data.news || [])
      .map(n => ({
        title:       n.title        || null,
        publisher:   n.publisher    || null,
        link:        n.link         || null,
        publishedAt: n.providerPublishTime ? n.providerPublishTime * 1000 : null,
        thumbnail:   n.thumbnail?.resolutions?.[0]?.url || null,
      }))
      .filter(a => a.title && a.link);
  } catch {
    // Próba 2: Yahoo Finance v2 news
    try {
      const url2 = `https://query2.finance.yahoo.com/v2/finance/news?symbols=${encodeURIComponent(query)}&count=8`;
      const r2 = await fetch(url2, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r2.ok) throw new Error(`Yahoo v2 HTTP ${r2.status}`);
      const data2 = await r2.json();
      return (data2?.items?.result || [])
        .map(n => ({
          title:       n.title     || null,
          publisher:   n.publisher || null,
          link:        n.clickThroughUrl?.url || n.canonicalUrl?.url || null,
          publishedAt: n.pubDate ? new Date(n.pubDate).getTime() : null,
          thumbnail:   n.thumbnail?.url || null,
        }))
        .filter(a => a.title && a.link);
    } catch {
      return [];
    }
  }
}
