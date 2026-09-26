// api/[route].js — jedna funkcja serverless dla szybkich endpointów GET (limit 12 funkcji w planie Hobby Vercel).
// /api/<nazwa> → api/_lib/<nazwa>.js. Adresy bez zmian dla frontendu.
// Osobnymi funkcjami zostają tylko api/news-summary.js i api/xtb-screenshot.js (POST, AI, dłuższe limity) —
// konkretne pliki mają na Vercelu pierwszeństwo przed tym dynamicznym.
//
// Nowy szybki endpoint: dodaj plik w api/_lib/ i wpis poniżej (jawna lista = brak dostępu do innych plików,
// a literalne import() pozwalają Vercelowi dołączyć moduły do paczki). Ładowany jest tylko potrzebny moduł.
const ROUTES = {
  "stock-price":     () => import("./_lib/stock-price.js"),
  "stock-chart":     () => import("./_lib/stock-chart.js"),
  "symbol-search":   () => import("./_lib/symbol-search.js"),
  "commodity-price": () => import("./_lib/commodity-price.js"),
  "fx-rate":         () => import("./_lib/fx-rate.js"),
  "market-movers":   () => import("./_lib/market-movers.js"),
  "news":            () => import("./_lib/news.js"),
  "bond-rates":      () => import("./_lib/bond-rates.js"),
  "logo":            () => import("./_lib/logo.js"),
};

export default async function handler(req, res) {
  const { route, ...query } = req.query || {};
  const load = Object.hasOwn(ROUTES, route) ? ROUTES[route] : null;
  if (!load) return res.status(404).json({ error: `Unknown endpoint: ${route}` });
  req.query = query;
  const mod = await load();
  return mod.default(req, res);
}
