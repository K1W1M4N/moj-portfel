// api/stock-news.js — Newsy finansowe dla spółki z Yahoo Finance

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing 'symbol' parameter" });

  // Próba 1: Yahoo Finance v1 search (zwraca news dla symbolu)
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=8&enableFuzzyQuery=false&enableCb=false&enableNavLinks=false&enableEnhancedTrivialQuery=true`;
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

    return res.status(200).json({ articles, fetchedAt: Date.now() });
  } catch (e1) {
    // Próba 2: Yahoo Finance v2 news (alternatywny endpoint)
    try {
      const url2 = `https://query2.finance.yahoo.com/v2/finance/news?symbols=${encodeURIComponent(symbol)}&count=8`;
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

      return res.status(200).json({ articles, fetchedAt: Date.now() });
    } catch (e2) {
      console.error("stock-news: both endpoints failed", e1.message, e2.message);
      return res.status(502).json({ error: "Could not fetch news", details: e2.message });
    }
  }
}
