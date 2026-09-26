// api/_lib/news.js — newsy (obsługiwane przez router api/[route].js).
//   /api/news                        → newsy rynkowe (api/_lib/market-news.js)
//   /api/news?symbol=…&exchange=…    → newsy spółki/ETF (api/_lib/stock-news.js)
import marketNews from "./market-news.js";
import stockNews from "./stock-news.js";

export default function handler(req, res) {
  return req.query?.symbol ? stockNews(req, res) : marketNews(req, res);
}
