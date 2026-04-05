// api/market-news.js
// Newsy rynkowe:
//   Primary  → investing.com RSS (pl.investing.com/rss/news.rss)
//   Fallback → Yahoo Finance RSS (finance.yahoo.com/rss/...)

// ─── Minimalny parser RSS/XML ─────────────────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];

    const title = extractCDATA(block, "title") || extractTag(block, "title");
    const link  = extractTag(block, "link")  ||
                  extractTag(block, "guid")   ||
                  extractAttr(block, "guid", "isPermaLink");
    const pubDate    = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    const desc       = extractCDATA(block, "description") || extractTag(block, "description");
    const publisher  = extractCDATA(block, "source") || extractTag(block, "source") || null;

    if (!title || !link) continue;
    items.push({
      title:       htmlDecode(title).trim(),
      link:        link.trim(),
      publishedAt: pubDate ? new Date(pubDate).getTime() : null,
      description: desc ? htmlDecode(desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 250) : null,
      publisher:   publisher ? htmlDecode(publisher).trim() : null,
    });
  }
  return items;
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return re.exec(xml)?.[1] ?? null;
}

function extractCDATA(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i");
  return re.exec(xml)?.[1] ?? null;
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*${attr}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return re.exec(xml)?.[1] ?? null;
}

function htmlDecode(s) {
  return s
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code))
    .replace(/&nbsp;/g, " ");
}

// ─── Źródła RSS ───────────────────────────────────────────────────────────────
const SOURCES = [
  {
    name:    "investing.com",
    url:     "https://pl.investing.com/rss/news.rss",
    headers: {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":          "application/rss+xml, application/xml, text/xml, */*",
      "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
      "Referer":         "https://pl.investing.com/",
      "Cache-Control":   "no-cache",
    },
  },
  {
    name:    "investing.com (EN)",
    url:     "https://www.investing.com/rss/news_1.rss",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept":     "application/rss+xml, text/xml, */*",
      "Referer":    "https://www.investing.com/",
    },
  },
  {
    name:    "Yahoo Finance",
    url:     "https://finance.yahoo.com/rss/topstories",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)" },
  },
];

async function fetchRSS(source) {
  const res = await fetch(source.url, {
    headers: source.headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${source.name} HTTP ${res.status}`);
  const text = await res.text();
  if (text.length < 200) throw new Error(`${source.name} response too short (${text.length} bytes)`);
  return { text, source: source.name };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const errors = [];

  for (const source of SOURCES) {
    try {
      const { text, source: srcName } = await fetchRSS(source);
      const articles = parseRSS(text);
      if (articles.length === 0) {
        errors.push(`${srcName}: parsed 0 items`);
        continue;
      }
      return res.status(200).json({
        articles: articles.slice(0, 20),
        source:   srcName,
        fetchedAt: Date.now(),
      });
    } catch (e) {
      errors.push(`${source.name}: ${e.message}`);
    }
  }

  console.error("market-news: all sources failed:", errors);
  return res.status(502).json({ error: "All RSS sources failed", details: errors });
}
