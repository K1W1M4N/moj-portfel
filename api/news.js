// api/news.js — jedna funkcja serverless na newsy (limit 12 funkcji w planie Hobby Vercel).
//   /api/news                        → newsy rynkowe (api/_lib/market-news.js)
//   /api/news?symbol=…&exchange=…    → newsy spółki/ETF (api/_lib/stock-news.js)
// Pliki w api/_lib/ nie są osobnymi funkcjami (katalog z prefiksem „_”).
import marketNews from "./_lib/market-news.js";
import stockNews from "./_lib/stock-news.js";

export default function handler(req, res) {
  return req.query?.symbol ? stockNews(req, res) : marketNews(req, res);
}
