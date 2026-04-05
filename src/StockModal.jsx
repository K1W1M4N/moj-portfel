// src/StockModal.jsx
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Proxy URL — omija CORS i limity Twelve Data ─────────────────────────────
const PROXY_BASE = "/api/stock-price";

// ─── Style helpers ────────────────────────────────────────────────────────────
const labelSt = {
  fontSize: 11, color: "#5a6a7e", display: "block",
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em"
};
const baseInp = {
  display: "block", width: "100%", padding: "9px 12px", fontSize: 13,
  borderRadius: 8, background: "#1a2535", border: "1px solid #243040",
  color: "#e8f0f8", fontFamily: "'Sora', sans-serif", outline: "none",
  WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
  boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s",
};
const focusInp = e => { e.target.style.borderColor = "#e8e040"; e.target.style.boxShadow = "0 0 0 3px #e8e04018"; };
const blurInp  = e => { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; };

const fmtPLN  = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
const fmtPLN2 = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n);
const fmtCur  = (n, cur) => n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " " + (cur || "");

// ─── Cache kursów NBP ─────────────────────────────────────────────────────────
const fxCache = {};

export async function fetchFxRate(currency) {
  if (!currency || currency === "PLN") return 1;
  if (fxCache[currency]) return fxCache[currency];
  const fallback = { USD: 3.95, EUR: 4.27, GBP: 5.0, CHF: 4.4, GBX: 0.049 };
  try {
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency}/last/1/?format=json`);
    if (!res.ok) throw new Error("NBP A error");
    const data = await res.json();
    const rate = data.rates?.[0]?.mid;
    if (rate) { fxCache[currency] = rate; return rate; }
  } catch {
    try {
      const res2 = await fetch(`https://api.nbp.pl/api/exchangerates/rates/b/${currency}/last/1/?format=json`);
      if (res2.ok) {
        const data2 = await res2.json();
        const rate2 = data2.rates?.[0]?.mid;
        if (rate2) { fxCache[currency] = rate2; return rate2; }
      }
    } catch {}
  }
  return fallback[currency] || 4.0;
}

// ─── Fetch przez proxy — timeout 8s, 1 retry po 3s przy timeout ──────────────
async function fetchViaProxy(symbols, exchanges = []) {
  const symStr = Array.isArray(symbols) ? symbols.join(",") : symbols;
  const exchStr = Array.isArray(exchanges) ? exchanges.join(",") : (exchanges || "");
  const url = `${PROXY_BASE}?symbols=${encodeURIComponent(symStr)}${exchStr ? `&exchanges=${encodeURIComponent(exchStr)}` : ""}`;

  const attemptFetch = async () => {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(tid);
    }
  };

  try {
    return await attemptFetch();
  } catch (e) {
    if (e.name === "AbortError") {
      await new Promise(r => setTimeout(r, 3000));
      return await attemptFetch();
    }
    throw e;
  }
}

// ─── Helper: czas temu (pl) ───────────────────────────────────────────────────
function timeAgo(ms) {
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60000);
  const h    = Math.floor(diff / 3600000);
  const d    = Math.floor(diff / 86400000);
  if (d > 30) return new Date(ms).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  if (d >= 1)  return `${d} ${d === 1 ? "dzień" : d < 5 ? "dni" : "dni"} temu`;
  if (h >= 1)  return `${h} godz. temu`;
  if (min >= 1) return `${min} min temu`;
  return "przed chwilą";
}

// ─── Cache newsów ─────────────────────────────────────────────────────────────
const NEWS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 godziny

function loadNewsCache(symbol) {
  try {
    const raw = JSON.parse(localStorage.getItem(`pt-news-${symbol}`) || "null");
    if (!raw || !raw.fetchedAt || Date.now() - raw.fetchedAt > NEWS_CACHE_TTL) return null;
    return raw;
  } catch { return null; }
}

function saveNewsCache(symbol, data) {
  try { localStorage.setItem(`pt-news-${symbol}`, JSON.stringify(data)); } catch {}
}

function useStockNews(symbol) {
  const [data, setData]       = useState(() => loadNewsCache(symbol));
  const [loading, setLoading] = useState(false);

  const fetchNews = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(`/api/stock-news?symbol=${encodeURIComponent(symbol)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        saveNewsCache(symbol, json);
        setData(json);
      } finally {
        clearTimeout(tid);
      }
    } catch (e) {
      console.warn("News fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    const cached = loadNewsCache(symbol);
    if (cached) { setData(cached); return; }
    fetchNews();
    const interval = setInterval(fetchNews, NEWS_CACHE_TTL);
    return () => clearInterval(interval);
  }, [symbol, fetchNews]);

  return { articles: data?.articles || [], fetchedAt: data?.fetchedAt ?? null, loading, refresh: fetchNews };
}

// ─── Komponent: sekcja newsów w panelu szczegółów ─────────────────────────────
function StockNewsSection({ symbol, pnlPct }) {
  const { articles, fetchedAt, loading, refresh } = useStockNews(symbol);
  const bigMove = Math.abs(pnlPct) >= 5;
  const moveUp  = pnlPct >= 0;
  const accentColor = moveUp ? "#00c896" : "#f05060";

  return (
    <div style={{ background: "#0f1a27", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
      {/* Nagłówek sekcji */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "#5a7a9e", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Aktualności
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {fetchedAt && !loading && (
            <span style={{ fontSize: 10, color: "#3a4a5e" }}>
              {timeAgo(fetchedAt)}
            </span>
          )}
          <button
            onClick={refresh} disabled={loading}
            title="Odśwież newsy"
            style={{
              fontSize: 13, color: loading ? "#3a4a5e" : "#4a7a9e",
              background: "transparent", border: "1px solid #2a3a50",
              borderRadius: 5, padding: "1px 7px", cursor: loading ? "default" : "pointer",
              fontFamily: "'Sora', sans-serif", lineHeight: "18px",
              transition: "color .15s, border-color .15s",
            }}
            onMouseEnter={e => { if (!loading) { e.currentTarget.style.color = "#8ab8de"; e.currentTarget.style.borderColor = "#4a6a8e"; } }}
            onMouseLeave={e => { e.currentTarget.style.color = loading ? "#3a4a5e" : "#4a7a9e"; e.currentTarget.style.borderColor = "#2a3a50"; }}
          >
            {loading ? "···" : "↻"}
          </button>
        </div>
      </div>

      {/* Banner kontekstowy przy dużej zmianie kursu */}
      {bigMove && (
        <div style={{
          background: `${accentColor}10`,
          border: `1px solid ${accentColor}35`,
          borderRadius: 8, padding: "8px 11px", marginBottom: 10,
          fontSize: 11, color: accentColor, lineHeight: 1.5,
        }}>
          <span style={{ fontWeight: 600 }}>
            {moveUp ? "▲" : "▼"} Kurs zmienił się o {moveUp ? "+" : ""}{pnlPct.toFixed(1)}% od zakupu.
          </span>
          {" "}Poniższe newsy mogły mieć wpływ na tę zmianę.
        </div>
      )}

      {/* Stan: ładowanie */}
      {loading && articles.length === 0 && (
        <div style={{ fontSize: 12, color: "#3a4a5e", textAlign: "center", padding: "14px 0" }}>
          Wczytywanie newsów…
        </div>
      )}

      {/* Stan: brak wyników */}
      {!loading && articles.length === 0 && (
        <div style={{ fontSize: 12, color: "#3a4a5e", textAlign: "center", padding: "14px 0" }}>
          Brak newsów dla tego symbolu
        </div>
      )}

      {/* Lista artykułów */}
      {articles.map((a, i) => (
        <a
          key={i}
          href={a.link} target="_blank" rel="noopener noreferrer"
          style={{
            display: "block", textDecoration: "none",
            paddingBottom: i < articles.length - 1 ? 9 : 0,
            borderBottom: i < articles.length - 1 ? "1px solid #1a2535" : "none",
            marginBottom: i < articles.length - 1 ? 9 : 0,
          }}>
          <div style={{ fontSize: 12, color: "#c8d8e8", lineHeight: 1.45, marginBottom: 3, transition: "color .1s" }}
            onMouseEnter={e => e.currentTarget.style.color = "#e8f4ff"}
            onMouseLeave={e => e.currentTarget.style.color = "#c8d8e8"}
          >
            {a.title}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#3a5a7e" }}>{a.publisher}</span>
            {a.publishedAt && (
              <span style={{ fontSize: 10, color: "#3a4a5e" }}>{timeAgo(a.publishedAt)}</span>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}

// ─── Klucz cache localStorage dla cen akcji ──────────────────────────────────
const PRICE_CACHE_KEY = "pt-stock-cache";
const CACHE_TTL = 30 * 60 * 1000; // 30 minut

function loadPriceCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || "{}");
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v.ts && now - v.ts < CACHE_TTL));
  } catch { return {}; }
}
function savePriceCache(cache) {
  try { localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache)); } catch {}
}
function loadStalePriceCache() {
  try { return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || "{}"); } catch { return {}; }
}

// Czy giełdy są prawdopodobnie otwarte (pon–pt, 8:00–22:00 czasu lokalnego)
export function isMarketHours() {
  const now = new Date();
  const day = now.getDay(); // 0=niedz, 6=sob
  if (day === 0 || day === 6) return false;
  const h = now.getHours();
  return h >= 8 && h < 22;
}
function getRefreshInterval() {
  return isMarketHours() ? 5 * 60 * 1000 : 30 * 60 * 1000;
}

// ─── Hook: live ceny dla aktywów giełdowych ───────────────────────────────────
export function useStockPrices(assets) {
  const [stockPrices, setStockPrices] = useState(() => loadPriceCache());
  const [stockLastUpdated, setStockLastUpdated] = useState(null);

  const stockAssets = assets.filter(a => a.isStock && a.stockSymbol);
  const symbolKey = stockAssets.map(a => `${a.stockSymbol}:${a.stockExchange || ""}`).join(",");

  const fetchAll = useCallback(async () => {
    if (stockAssets.length === 0) return;
    const unique = [...new Map(stockAssets.map(a => [a.stockSymbol, a])).values()];
    const symbols = unique.map(a => a.stockSymbol);
    const exchanges = unique.map(a => a.stockExchange || "");

    try {
      const data = await fetchViaProxy(symbols, exchanges);

      // Kursy walut z NBP — jeden request na walutę
      const currencies = [...new Set(unique.map(a => a.stockCurrency).filter(c => c && c !== "PLN"))];
      const fxRates = { PLN: 1 };
      await Promise.all(currencies.map(async cur => { fxRates[cur] = await fetchFxRate(cur); }));

      const newPrices = {};

      if (symbols.length === 1) {
        const entry = data?.prices?.[symbols[0]];
        const priceVal = entry?.price ?? data?.price;
        if (priceVal && !isNaN(parseFloat(priceVal))) {
          const asset = unique[0];
          const currency = asset?.stockCurrency || "PLN";
          const priceOrig = parseFloat(priceVal);
          const fx = fxRates[currency] || 1;
          newPrices[symbols[0]] = { priceOrig, pricePLN: priceOrig * fx, currency, fx, ts: Date.now(), provider: entry?.provider || data?.provider || null };
        }
      } else {
        for (const sym of symbols) {
          const entry = data?.prices?.[sym];
          const priceVal = entry?.price ?? data?.[sym]?.price;
          if (priceVal && !isNaN(parseFloat(priceVal))) {
            const asset = unique.find(a => a.stockSymbol === sym);
            const currency = asset?.stockCurrency || "PLN";
            const priceOrig = parseFloat(priceVal);
            const fx = fxRates[currency] || 1;
            newPrices[sym] = { priceOrig, pricePLN: priceOrig * fx, currency, fx, ts: Date.now(), provider: entry?.provider || null };
          }
        }
      }

      if (Object.keys(newPrices).length > 0) {
        setStockPrices(prev => {
          const merged = { ...prev, ...newPrices };
          savePriceCache(merged);
          return merged;
        });
        setStockLastUpdated(new Date());
      }
    } catch (e) {
      console.warn("Stock proxy error:", e);
      const stale = loadStalePriceCache();
      if (Object.keys(stale).length > 0) {
        const marked = Object.fromEntries(Object.entries(stale).map(([k, v]) => [k, { ...v, stale: true }]));
        setStockPrices(prev => ({ ...prev, ...marked }));
        const latestTs = Math.max(...Object.values(stale).map(v => v.ts || 0));
        if (latestTs > 0) setStockLastUpdated(new Date(latestTs));
      }
    }
  }, [symbolKey]); // eslint-disable-line

  useEffect(() => {
    fetchAll();
    let timer;
    function schedule() {
      timer = setTimeout(() => { fetchAll(); schedule(); }, getRefreshInterval());
    }
    schedule();
    return () => clearTimeout(timer);
  }, [fetchAll]);

  return { stockPrices, stockLastUpdated, refetchStocks: fetchAll };
}

// ─── Wyszukiwarka symboli (przez Twelve Data symbol_search — nie jest ograniczona limitem cen) ──
const EXCHANGE_PRIORITY = ["WSE", "XETR", "XWAR", "XAMS", "XPAR", "XLON", "XNAS", "XNYS"];
const TWELVE_DATA_KEY = "a681abc9ebc045a39c938d8b058567d9";

function sortByExchange(results) {
  return [...results].sort((a, b) => {
    const ai = EXCHANGE_PRIORITY.indexOf(a.exchange);
    const bi = EXCHANGE_PRIORITY.indexOf(b.exchange);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function exchangeLabel(exchange) {
  const map = {
    XETR: "Frankfurt (XETRA)", WSE: "GPW Warszawa", XWAR: "GPW Warszawa",
    XAMS: "Amsterdam", XPAR: "Paryż", XLON: "Londyn", XNAS: "NASDAQ", XNYS: "NYSE",
  };
  return map[exchange] || exchange;
}

function SymbolSearch({ initialValue, onSelect }) {
  const [query, setQuery] = useState(initialValue || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    setOpen(true);
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        // Auto-strip końcówki giełdy (np. IUSQ.DE → IUSQ, CDR.WA → CDR)
        const cleanQ = q.replace(/\.[A-Z]+$/, "").trim();
        const res = await fetch(
          `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(cleanQ)}&outputsize=30&apikey=${TWELVE_DATA_KEY}`
        );
        const data = await res.json();
        const filtered = (data.data || []).filter(r => ["Common Stock", "ETF"].includes(r.instrument_type));
        setResults(sortByExchange(filtered).slice(0, 6));
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 450);
  }

  function handleSelect(item) {
    setQuery(`${item.symbol} — ${item.instrument_name}`);
    setOpen(false);
    setResults([]);
    onSelect({
      symbol: item.symbol,
      name: item.instrument_name,
      exchange: item.exchange,
      currency: item.currency,
      type: item.instrument_type,
    });
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        style={baseInp}
        placeholder="np. IUSQ, CDR, NVDA (bez .DE .WA)"
        value={query}
        onChange={handleInput}
        onFocus={e => { setOpen(true); focusInp(e); }}
        onBlur={blurInp}
        autoComplete="off"
      />
      {open && (loading || results.length > 0 || query.length >= 2) && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10,
          zIndex: 300, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          {loading && <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>Szukam...</div>}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>
              Brak wyników. Spróbuj wpisać sam ticker bez końcówki (np. "IUSQ" zamiast "IUSQ.DE")
            </div>
          )}
          {results.map((item, i) => (
            <div key={i}
              onClick={() => handleSelect(item)}
              onTouchEnd={e => { e.preventDefault(); handleSelect(item); }}
              style={{
                padding: "10px 14px", cursor: "pointer",
                borderBottom: i < results.length - 1 ? "1px solid #1e2a38" : "none",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
                    {item.symbol}
                  </span>
                  <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 8 }}>{item.instrument_name}</span>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: "#5a6a7e", background: "#1e2a38", padding: "2px 6px", borderRadius: 4 }}>
                    {exchangeLabel(item.exchange)}
                  </span>
                  <span style={{ fontSize: 10, color: "#4a8a6e", background: "#0a2018", padding: "2px 6px", borderRadius: 4 }}>
                    {item.currency}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 2 }}>{item.instrument_type}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Wykres historyczny ────────────────────────────────────────────────────────
const CHART_RANGES = [
  { label: "1T", value: "5d" },
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1R", value: "1y" },
  { label: "5L", value: "5y" },
];

function StockChart({ symbol, exchange, currency, open: openProp, onToggle }) {
  const controlled = openProp !== undefined;
  const [openInner, setOpenInner] = useState(false);
  const open    = controlled ? openProp : openInner;
  const setOpen = controlled ? (v => onToggle?.()) : setOpenInner;
  const [range, setRange]         = useState("1mo");
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(false);
  const [hoverIdx, setHoverIdx]   = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(false); setChartData(null);
    fetch(`/api/stock-chart?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange || "")}&range=${range}`)
      .then(r => r.json())
      .then(d => { if (d.points?.length > 1) setChartData(d); else setError(true); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [open, range, symbol, exchange]);

  // SVG układ
  const W = 420, H = 150;
  const PT = 12, PR = 52, PB = 22, PL = 6;
  const iW = W - PL - PR, iH = H - PT - PB;

  let geom = null;
  if (chartData?.points?.length > 1) {
    const pts = chartData.points;
    const prices = pts.map(p => p.close);
    const minP = Math.min(...prices), maxP = Math.max(...prices);
    const pRange = maxP - minP || 1;
    const toX = i  => PL + (i / (pts.length - 1)) * iW;
    const toY = v  => PT + iH - ((v - minP) / pRange) * iH;

    const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${toX(pts.length - 1).toFixed(1)},${H - PB} L${PL},${H - PB} Z`;
    const changePct   = ((pts[pts.length - 1].close - pts[0].close) / pts[0].close) * 100;
    const changeColor = changePct >= 0 ? "#00c896" : "#f05060";

    const yLabels = [0, 1, 2].map(i => ({
      y: toY(minP + pRange * i / 2),
      label: (minP + pRange * i / 2).toFixed(2),
    }));
    const xLabels = [0, 1, 2, 3].map(i => {
      const idx = Math.round(i / 3 * (pts.length - 1));
      const d = new Date(pts[idx].ts * 1000);
      return { x: toX(idx), label: d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" }) };
    });

    let hoverInfo = null;
    if (hoverIdx !== null) {
      const ci = Math.max(0, Math.min(pts.length - 1, hoverIdx));
      hoverInfo = {
        x: toX(ci), y: toY(pts[ci].close),
        price: pts[ci].close,
        date: new Date(pts[ci].ts * 1000).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" }),
      };
    }

    geom = { linePath, areaPath, changePct, changeColor, yLabels, xLabels, hoverInfo,
             lastX: toX(pts.length - 1), lastY: toY(pts[pts.length - 1].close), pts };
  }

  const handleMouseMove = e => {
    if (!svgRef.current || !chartData?.points) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W - PL;
    const idx = Math.round((relX / iW) * (chartData.points.length - 1));
    setHoverIdx(Math.max(0, Math.min(chartData.points.length - 1, idx)));
  };

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Toggle button — tylko w trybie niekontrolowanym */}
      {!controlled && (
        <button onClick={() => setOpen(o => !o)} style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "#0f1a27", border: `1px solid ${open ? "#2a3a50" : "#1e2a38"}`,
          borderRadius: open ? "10px 10px 0 0" : 10, padding: "10px 14px",
          cursor: "pointer", color: "#8a9bb0", fontSize: 12, transition: "border-color .15s",
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#2a3a50"}
          onMouseLeave={e => e.currentTarget.style.borderColor = open ? "#2a3a50" : "#1e2a38"}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13 }}>📈</span>
            <span>Wykres kursu</span>
            {geom && (
              <span style={{ color: geom.changeColor, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
                {geom.changePct >= 0 ? "+" : ""}{geom.changePct.toFixed(2)}%
              </span>
            )}
          </span>
          <span style={{ fontSize: 13, color: "#5a6a7e", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", display: "inline-block" }}>▾</span>
        </button>
      )}

      {open && (
        <div style={{ background: "#0f1a27", border: "1px solid #2a3a50", borderTop: controlled ? "none" : "none", borderRadius: controlled ? "0 0 14px 14px" : "0 0 10px 10px", padding: "12px 14px" }}>
          {/* Zakresy */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {CHART_RANGES.map(r => (
              <button key={r.value} onClick={() => setRange(r.value)} style={{
                padding: "3px 9px", borderRadius: 6, border: "1px solid",
                borderColor: range === r.value ? "#e8e040" : "#1e2a38",
                background: range === r.value ? "#e8e04018" : "transparent",
                color: range === r.value ? "#e8e040" : "#5a6a7e",
                fontSize: 11, cursor: "pointer", fontFamily: "'Sora', sans-serif", transition: "all .12s",
              }}>
                {r.label}
              </button>
            ))}
          </div>

          {loading && (
            <div style={{ textAlign: "center", padding: "28px 0", color: "#5a6a7e", fontSize: 12 }}>
              Ładowanie danych...
            </div>
          )}
          {error && !loading && (
            <div style={{ textAlign: "center", padding: "28px 0", color: "#f05060", fontSize: 12 }}>
              Nie udało się pobrać danych wykresu
            </div>
          )}

          {geom && !loading && (
            <div>
              {/* Hover info bar */}
              <div style={{ height: 18, display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11 }}>
                {geom.hoverInfo ? (
                  <>
                    <span style={{ color: "#5a6a7e" }}>{geom.hoverInfo.date}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", color: "#e8f0f8" }}>
                      {geom.hoverInfo.price.toFixed(2)} {currency}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ color: "#5a6a7e" }}>
                      {new Date(geom.pts[0].ts * 1000).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" })}
                      {" → "}
                      {new Date(geom.pts[geom.pts.length-1].ts * 1000).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                    <span style={{ fontFamily: "'DM Mono', monospace", color: geom.changeColor }}>
                      {geom.changePct >= 0 ? "+" : ""}{geom.changePct.toFixed(2)}%
                    </span>
                  </>
                )}
              </div>

              {/* SVG chart */}
              <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
                style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverIdx(null)}
              >
                <defs>
                  <linearGradient id={`cg_${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={geom.changeColor} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={geom.changeColor} stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {/* Grid */}
                {geom.yLabels.map((l, i) => (
                  <line key={i} x1={PL} y1={l.y} x2={W - PR} y2={l.y} stroke="#1a2535" strokeWidth="1" />
                ))}

                {/* Area */}
                <path d={geom.areaPath} fill={`url(#cg_${symbol})`} />

                {/* Line */}
                <path d={geom.linePath} fill="none" stroke={geom.changeColor} strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />

                {/* Y labels */}
                {geom.yLabels.map((l, i) => (
                  <text key={i} x={W - PR + 5} y={l.y + 4} fontSize="9" fill="#4a5a6e" textAnchor="start">
                    {l.label}
                  </text>
                ))}

                {/* X labels */}
                {geom.xLabels.map((l, i) => (
                  <text key={i} x={l.x} y={H - 4} fontSize="9" fill="#4a5a6e" textAnchor="middle">
                    {l.label}
                  </text>
                ))}

                {/* Hover: linia + kółko */}
                {geom.hoverInfo && (
                  <>
                    <line x1={geom.hoverInfo.x} y1={PT} x2={geom.hoverInfo.x} y2={H - PB}
                      stroke="#2a3a50" strokeWidth="1" strokeDasharray="3,3" />
                    <circle cx={geom.hoverInfo.x} cy={geom.hoverInfo.y} r="4"
                      fill={geom.changeColor} stroke="#0f1a27" strokeWidth="2" />
                  </>
                )}

                {/* Ostatni punkt (bez hovera) */}
                {!geom.hoverInfo && (
                  <circle cx={geom.lastX} cy={geom.lastY} r="3"
                    fill={geom.changeColor} stroke="#0f1a27" strokeWidth="2" />
                )}
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Mini sparkline SVG ───────────────────────────────────────────────────────
function Sparkline({ paid, current, color }) {
  if (!paid || !current) return null;
  const w = 80, h = 28;
  const points = [paid, paid * 0.98, paid * 1.01, paid * 0.995, paid * 1.015, current];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Panel szczegółów akcji/ETF ───────────────────────────────────────────────
export function StockDetailPanel({ stock, stockPrices, onEdit, onDelete, onClose, onMove }) {
  const [menuOpen, setMenuOpen]   = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const priceData = stockPrices[stock.stockSymbol];
  const isBroker = stock.stockBrokerValue != null;
  const currentValuePLN = priceData
    ? stock.stockQuantity * priceData.pricePLN
    : isBroker ? stock.stockBrokerValue : stock.value;

  // Koszt zakupu — obsługa wszystkich trybów zapisu
  let paidPLN = stock.stockPaidPLN || 0;
  if (!paidPLN && stock.stockTranches?.length) {
    paidPLN = stock.stockTranches.reduce((s, t) => s + (t.totalPLN || 0), 0);
  }
  if (!paidPLN) paidPLN = stock.value;

  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  const pnlColor = pnlPLN >= 0 ? "#00c896" : "#f05060";
  const hasLive = !!priceData;

  const cacheAge = priceData?.ts ? Math.round((Date.now() - priceData.ts) / 60000) : null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16
    }}>
      <div style={{
        background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16,
        padding: 28, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto"
      }}>
        {/* Nagłówek */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
              {stock.stockSymbol}
            </div>
            <div style={{ fontSize: 13, color: "#8a9bb0", marginTop: 2 }}>{stock.stockName || stock.name}</div>
            <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
              <span style={{ fontSize: 10, color: "#5a6a7e", background: "#1e2a38", padding: "2px 8px", borderRadius: 4 }}>
                {stock.stockExchange}
              </span>
              <span style={{ fontSize: 10, color: "#4a8a6e", background: "#0a2018", padding: "2px 8px", borderRadius: 4 }}>
                {stock.stockCurrency}
              </span>
              {stock.stockType && (
                <span style={{ fontSize: 10, color: "#4a6a8e", background: "#0a1828", padding: "2px 8px", borderRadius: 4 }}>
                  {stock.stockType}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* ··· menu */}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button onClick={() => setMenuOpen(o => !o)}
                style={{ background: menuOpen ? "#1e2a38" : "transparent", border: `1px solid ${menuOpen ? "#2a3a50" : "#1e2a38"}`, borderRadius: 8, color: "#8a9bb0", cursor: "pointer", width: 32, height: 32, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ···
              </button>
              {menuOpen && (
                <div style={{ position: "absolute", top: 38, right: 0, background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10, padding: "4px", minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 10 }}>
                  {[
                    { label: "Edytuj", action: () => { setMenuOpen(false); onEdit(stock); } },
                    { label: "Przenieś", action: () => { setMenuOpen(false); onMove?.(stock); }, hidden: !onMove },
                    { label: "Usuń", action: () => { setMenuOpen(false); onDelete(stock.id); }, danger: true },
                  ].filter(i => !i.hidden).map((item, i) => (
                    <button key={i} onClick={item.action}
                      style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: item.danger ? "#f05060" : "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Zamknij */}
            <button onClick={onClose}
              style={{ background: "transparent", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f0506018"; e.currentTarget.style.borderColor = "#f05060"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "#f0506030"; }}>
              ×
            </button>
          </div>
        </div>

        {/* Wartość główna */}
        <div style={{ background: "#0f1a27", border: `1px solid ${pnlColor}30`, borderRadius: chartOpen ? "14px 14px 0 0" : 14, padding: "18px 20px", marginBottom: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: "#5a7a9e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                Aktualna wartość
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>
                {fmtPLN(currentValuePLN)}
              </div>
              {hasLive && priceData && (
                <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 3 }}>
                  {priceData.priceOrig.toFixed(2)} {stock.stockCurrency}
                  {stock.stockCurrency !== "PLN" && (
                    <span style={{ marginLeft: 6, color: "#5a6a7e" }}>
                      × {priceData.fx.toFixed(2)} PLN/
                      {stock.stockCurrency}
                    </span>
                  )}
                </div>
              )}
              {!hasLive && (
                <div style={{ fontSize: 11, color: "#3a4a5e", marginTop: 3 }}>odświeżanie...</div>
              )}
            </div>
            {/* Sparkline — klikalny toggle wykresu */}
            <button onClick={() => setChartOpen(o => !o)}
              title="Kliknij, aby rozwinąć wykres kursu"
              style={{
                background: chartOpen ? `${pnlColor}18` : "transparent",
                border: `1px solid ${chartOpen ? pnlColor + "60" : "transparent"}`,
                borderRadius: 8, padding: 4, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
                transition: "background .15s, border-color .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${pnlColor}18`; e.currentTarget.style.borderColor = pnlColor + "60"; }}
              onMouseLeave={e => { e.currentTarget.style.background = chartOpen ? `${pnlColor}18` : "transparent"; e.currentTarget.style.borderColor = chartOpen ? pnlColor + "60" : "transparent"; }}
            >
              <Sparkline paid={paidPLN} current={currentValuePLN} color={pnlColor} />
              <span style={{ fontSize: 9, color: "#4a5a6e", letterSpacing: "0.04em" }}>
                {chartOpen ? "zwiń ▴" : "wykres ▾"}
              </span>
            </button>
          </div>

          {/* P&L */}
          <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zainwestowano</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#8a9bb0", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(paidPLN)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zysk / strata</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: pnlColor, fontFamily: "'DM Mono', monospace" }}>
                {pnlPLN >= 0 ? "+" : ""}{fmtPLN2(pnlPLN)}
                <span style={{ fontSize: 12, marginLeft: 6 }}>({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Wykres kursu — kontrolowany przez sparkline */}
        <StockChart
          symbol={stock.stockSymbol}
          exchange={stock.stockExchange}
          currency={stock.stockCurrency}
          open={chartOpen}
          onToggle={() => setChartOpen(o => !o)}
        />

        {/* Szczegóły pozycji */}
        <div style={{ background: "#0f1a27", borderRadius: 12, padding: "14px 16px", marginBottom: 14, marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "#5a7a9e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Szczegóły pozycji</div>

          <Row label="Ilość" value={`${Number(stock.stockQuantity).toFixed(4)} szt.`} />

          {/* Transze — lista zakupów */}
          {stock.stockTranches?.length > 0 ? (
            <div>
              <div style={{ fontSize: 11, color: "#5a6a7e", marginTop: 8, marginBottom: 4 }}>Transze zakupu</div>
              {stock.stockTranches.map((t, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8a9bb0", paddingBottom: 3 }}>
                  <span>{t.qty} szt.</span>
                  <span style={{ fontFamily: "'DM Mono', monospace" }}>{fmtPLN(t.totalPLN)}</span>
                </div>
              ))}
            </div>
          ) : (
            stock.stockAvgPrice > 0 && (
              <Row label={`Śr. cena zakupu (${stock.stockCurrency})`} value={fmtCur(stock.stockAvgPrice, stock.stockCurrency)} />
            )
          )}

          {stock.note && <Row label="Notatka" value={stock.note} />}

          {cacheAge !== null && (
            <div style={{ fontSize: 10, color: "#3a4a5e", marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>Cena z {cacheAge < 1 ? "chwilę temu" : `${cacheAge} min temu`}</span>
              {priceData?.provider && (
                <span style={{ color: "#2a3a4e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {priceData.provider === "twelvedata" ? "twelve data" : priceData.provider}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Aktualności i kontekst */}
        <StockNewsSection symbol={stock.stockSymbol} pnlPct={pnlPct} />
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 7, borderBottom: "1px solid #1a2535", marginBottom: 7 }}>
      <span style={{ fontSize: 11, color: "#5a7a9e" }}>{label}</span>
      <span style={{ fontSize: 13, color: "#e8f0f8", fontFamily: "'DM Mono', monospace", textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

// ─── Modal dodawania/edycji akcji/ETF ─────────────────────────────────────────
export function StockModal({ stock, onSave, onDelete, onClose }) {
  const isEdit = !!stock;

  // Tryb wprowadzania danych
  const [mode, setMode] = useState(() => {
    if (!stock) return "szybko";
    if (stock.stockTranches?.length) return "transze";
    if (stock.stockBrokerValue != null) return "broker";
    return "szybko";
  });

  const [selected, setSelected] = useState(stock ? {
    symbol: stock.stockSymbol,
    name: stock.stockName,
    exchange: stock.stockExchange,
    currency: stock.stockCurrency,
    type: stock.stockType,
  } : null);

  // Tryb Szybko
  const [quantity, setQuantity]  = useState(stock?.stockQuantity?.toString() || "");
  const [avgPrice, setAvgPrice]  = useState(stock?.stockAvgPrice?.toString() || "");

  // Tryb Transze
  const [tranches, setTranches] = useState(() => {
    if (stock?.stockTranches?.length) return stock.stockTranches.map(t => ({ qty: t.qty.toString(), totalPLN: t.totalPLN.toString() }));
    return [{ qty: "", totalPLN: "" }];
  });

  // Tryb Z brokera
  const [brokerValue, setBrokerValue]    = useState(stock?.stockBrokerValue?.toString() || "");
  const [brokerPnl, setBrokerPnl]        = useState(stock?.stockBrokerPnl?.toString() || "");
  const [brokerQty, setBrokerQty]        = useState(stock?.stockBrokerValue != null ? (stock?.stockQuantity?.toString() || "") : "");

  const [note, setNote] = useState(stock?.note || "");

  // Live cena
  const [currentPrice, setCurrentPrice] = useState(null);
  const [fxRate, setFxRate]     = useState(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [priceError, setPriceError]     = useState(false);

  const [hovSave, setHovSave]   = useState(false);
  const [hovDel, setHovDel]     = useState(false);
  const [hovClose, setHovClose] = useState(false);

  // Pobierz cenę po wyborze symbolu
  useEffect(() => {
    if (!selected?.symbol) return;
    setLoadingPrice(true);
    setCurrentPrice(null);
    setPriceError(false);
    let cancelled = false;

    async function load() {
      try {
        const [priceData, fx] = await Promise.all([
          fetchViaProxy([selected.symbol], [selected.exchange || ""]),
          fetchFxRate(selected.currency),
        ]);
        if (cancelled) return;
        const priceVal = priceData?.prices?.[selected.symbol]?.price ?? priceData?.price;
        if (priceVal && !isNaN(parseFloat(priceVal))) {
          setCurrentPrice(parseFloat(priceVal));
        } else {
          setPriceError(true);
        }
        setFxRate(fx);
      } catch {
        if (!cancelled) setPriceError(true);
      }
      if (!cancelled) setLoadingPrice(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selected?.symbol, selected?.exchange, selected?.currency]);

  const currency = selected?.currency || "PLN";
  const fx = fxRate || 1;

  // Obliczenia per tryb
  const calcSzybko = () => {
    const qty = parseFloat(String(quantity).replace(",", ".")) || 0;
    const avg = parseFloat(String(avgPrice).replace(",", ".")) || 0;
    const paidPLN = qty > 0 && avg > 0 ? qty * avg * fx : 0;
    const currentValuePLN = currentPrice && qty > 0 ? qty * currentPrice * fx : null;
    return { qty, avg, paidPLN, currentValuePLN };
  };

  const calcTranches = () => {
    const parsed = tranches.map(t => ({
      qty:      parseFloat(String(t.qty).replace(",", ".")) || 0,
      totalPLN: parseFloat(String(t.totalPLN).replace(",", ".")) || 0,
    })).filter(t => t.qty > 0 && t.totalPLN > 0);
    const totalQty  = parsed.reduce((s, t) => s + t.qty, 0);
    const totalPaid = parsed.reduce((s, t) => s + t.totalPLN, 0);
    const currentValuePLN = currentPrice && totalQty > 0 ? totalQty * currentPrice * fx : null;
    return { parsed, totalQty, totalPaid, currentValuePLN };
  };

  const calcBroker = () => {
    const val = parseFloat(String(brokerValue).replace(",", ".")) || 0;
    const pnl = parseFloat(String(brokerPnl).replace(",", ".")) || 0;
    const invested = val - pnl; // wartość aktualna − P&L = zainwestowano
    return { val, pnl, invested };
  };

  // Czy można zapisać?
  const canSave = (() => {
    if (!selected) return false;
    if (mode === "szybko") {
      const { qty, avg } = calcSzybko();
      return qty > 0 && avg > 0;
    }
    if (mode === "transze") {
      const { parsed } = calcTranches();
      return parsed.length > 0;
    }
    if (mode === "broker") {
      const { val } = calcBroker();
      return val > 0;
    }
    return false;
  })();

  function submit() {
    if (!canSave) return;

    let asset = {
      id: stock?.id || Date.now(),
      name: selected.name || selected.symbol,
      category: "Akcje / ETF",
      note,
      isStock: true,
      stockSymbol: selected.symbol,
      stockName: selected.name,
      stockExchange: selected.exchange,
      stockCurrency: currency,
      stockType: selected.type,
    };

    if (mode === "szybko") {
      const { qty, avg, paidPLN, currentValuePLN } = calcSzybko();
      asset = { ...asset,
        value: currentValuePLN ?? paidPLN,
        stockQuantity: qty,
        stockAvgPrice: avg,
        stockPaidPLN: paidPLN,
      };
    } else if (mode === "transze") {
      const { parsed, totalQty, totalPaid, currentValuePLN } = calcTranches();
      asset = { ...asset,
        value: currentValuePLN ?? totalPaid,
        stockQuantity: totalQty,
        stockPaidPLN: totalPaid,
        stockTranches: parsed,
      };
    } else if (mode === "broker") {
      const { val, pnl, invested } = calcBroker();
      const qty = parseFloat(String(brokerQty).replace(",", ".")) || 0;
      asset = { ...asset,
        value: val,
        stockQuantity: qty,
        stockPaidPLN: invested,
        stockBrokerValue: val,
        stockBrokerPnl: pnl,
      };
    }

    onSave(asset);
    onClose();
  }

  const MODES = [
    { id: "szybko",  label: "Szybko" },
    { id: "transze", label: "Transze" },
    { id: "broker",  label: "Z brokera" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Nagłówek */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>
            {isEdit ? "Edytuj akcje / ETF" : "Dodaj akcje / ETF"}
          </div>
          <button onClick={onClose}
            onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
            ×
          </button>
        </div>

        {/* Wyszukiwarka */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelSt}>Wyszukaj akcję lub ETF</label>
          <SymbolSearch
            initialValue={stock ? `${stock.stockSymbol} — ${stock.stockName}` : ""}
            onSelect={sel => { setSelected(sel); setCurrentPrice(null); setFxRate(null); setPriceError(false); }}
          />
          <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>
            Wpisz ticker bez końcówki giełdy, np. "IUSQ" lub "NVDA"
          </div>
        </div>

        {/* Wybrany instrument */}
        {selected && (
          <div style={{ background: "#0f1a27", border: "1px solid #1e3040", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{selected.symbol}</span>
                <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 8 }}>{selected.name}</span>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <span style={{ fontSize: 11, color: "#5a6a7e", background: "#1e2a38", padding: "2px 8px", borderRadius: 4 }}>{selected.exchange}</span>
                <span style={{ fontSize: 11, color: "#4a8a6e", background: "#0a2018", padding: "2px 8px", borderRadius: 4 }}>{currency}</span>
              </div>
            </div>
            {loadingPrice && <div style={{ fontSize: 11, color: "#5a6a7e", marginTop: 6 }}>Pobieram aktualną cenę...</div>}
            {currentPrice && !loadingPrice && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#8a9bb0" }}>
                Aktualna cena:{" "}
                <span style={{ color: "#e8e040", fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                  {fmtCur(currentPrice, currency)}
                </span>
                {currency !== "PLN" && fxRate && (
                  <span style={{ marginLeft: 8, color: "#5a6a7e" }}>≈ {fmtPLN2(currentPrice * fxRate)}</span>
                )}
              </div>
            )}
            {priceError && !loadingPrice && (
              <div style={{ fontSize: 11, color: "#f05060", marginTop: 6 }}>
                Nie udało się pobrać ceny. Możesz dodać aktywo — cena zaktualizuje się później.
              </div>
            )}
          </div>
        )}

        {/* Wybór trybu */}
        {selected && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {MODES.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${mode === m.id ? "#e8e040" : "#243040"}`,
                    background: mode === m.id ? "#e8e04015" : "#1a2535",
                    color: mode === m.id ? "#e8e040" : "#5a6a7e",
                    fontSize: 12, fontWeight: mode === m.id ? 600 : 400, cursor: "pointer",
                    fontFamily: "'Sora', sans-serif", transition: "all .15s",
                  }}>
                  {m.label}
                </button>
              ))}
            </div>

            {/* ── Tryb Szybko ── */}
            {mode === "szybko" && (() => {
              const { qty, avg, paidPLN, currentValuePLN } = calcSzybko();
              const pnlPLN = currentValuePLN !== null && paidPLN > 0 ? currentValuePLN - paidPLN : null;
              const pnlPct = pnlPLN !== null && paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : null;
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={labelSt}>Ilość jednostek</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="np. 10 lub 5.234"
                        value={quantity} onChange={e => setQuantity(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp} />
                    </div>
                    <div>
                      <label style={labelSt}>Śr. cena zakupu ({currency})</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="z XTB → pozycja → Śr. cena"
                        value={avgPrice} onChange={e => setAvgPrice(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp}
                        onKeyDown={e => e.key === "Enter" && submit()} />
                    </div>
                  </div>
                  {qty > 0 && avg > 0 && (
                    <Summary
                      paid={paidPLN}
                      current={currentValuePLN}
                      pnl={pnlPLN}
                      pnlPct={pnlPct}
                      sub={`${qty} × ${fmtCur(avg, currency)}`}
                    />
                  )}
                </>
              );
            })()}

            {/* ── Tryb Transze ── */}
            {mode === "transze" && (() => {
              const { parsed, totalQty, totalPaid, currentValuePLN } = calcTranches();
              const pnlPLN = currentValuePLN !== null && totalPaid > 0 ? currentValuePLN - totalPaid : null;
              const pnlPct = pnlPLN !== null && totalPaid > 0 ? (pnlPLN / totalPaid) * 100 : null;
              return (
                <>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 6, marginBottom: 6 }}>
                      <span style={{ ...labelSt, marginBottom: 0 }}>Ilość (szt.)</span>
                      <span style={{ ...labelSt, marginBottom: 0 }}>Zapłacono łącznie (PLN)</span>
                      <span />
                    </div>
                    {tranches.map((t, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 6, marginBottom: 6 }}>
                        <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                          placeholder="np. 5.5"
                          value={t.qty}
                          onChange={e => setTranches(ts => ts.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                          onFocus={focusInp} onBlur={blurInp} />
                        <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                          placeholder="np. 1350"
                          value={t.totalPLN}
                          onChange={e => setTranches(ts => ts.map((x, j) => j === i ? { ...x, totalPLN: e.target.value } : x))}
                          onFocus={focusInp} onBlur={blurInp} />
                        <button onClick={() => setTranches(ts => ts.filter((_, j) => j !== i))}
                          disabled={tranches.length === 1}
                          style={{ height: 36, alignSelf: "center", background: "transparent", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: tranches.length === 1 ? "not-allowed" : "pointer", opacity: tranches.length === 1 ? 0.3 : 1, fontSize: 14 }}>
                          ×
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setTranches(ts => [...ts, { qty: "", totalPLN: "" }])}
                      style={{ fontSize: 12, color: "#e8e040", background: "transparent", border: "1px dashed #e8e04040", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontFamily: "'Sora', sans-serif", marginTop: 2 }}>
                      + Dodaj transzę
                    </button>
                  </div>
                  {parsed.length > 0 && (
                    <Summary
                      paid={totalPaid}
                      current={currentValuePLN}
                      pnl={pnlPLN}
                      pnlPct={pnlPct}
                      sub={`${totalQty} szt. · ${parsed.length} ${parsed.length === 1 ? "transza" : parsed.length < 5 ? "transze" : "transz"}`}
                    />
                  )}
                </>
              );
            })()}

            {/* ── Tryb Z brokera ── */}
            {mode === "broker" && (() => {
              const { val, pnl, invested } = calcBroker();
              return (
                <>
                  <div style={{ fontSize: 11, color: "#5a6a7e", marginBottom: 10, lineHeight: 1.5 }}>
                    Przepisz wartości wprost z XTB: otwórz pozycję i wpisz aktualną wartość, P&L i ilość jednostek.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={labelSt}>Aktualna wartość (PLN)</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="z XTB → wartość"
                        value={brokerValue} onChange={e => setBrokerValue(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp} />
                    </div>
                    <div>
                      <label style={labelSt}>P&L (PLN, może być ujemny)</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="z XTB → zysk/strata"
                        value={brokerPnl} onChange={e => setBrokerPnl(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelSt}>Ilość jednostek</label>
                    <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                      placeholder="z XTB → ilość jednostek"
                      value={brokerQty} onChange={e => setBrokerQty(e.target.value)}
                      onFocus={focusInp} onBlur={blurInp}
                      onKeyDown={e => e.key === "Enter" && submit()} />
                  </div>
                  {val > 0 && (
                    <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Podsumowanie</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zainwestowano (wyliczone)</div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(invested)}</div>
                          <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 1 }}>wartość − P&L</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#5a7a9e" }}>Aktualna wartość</div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(val)}</div>
                          {pnl !== 0 && (
                            <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: pnl >= 0 ? "#00c896" : "#f05060" }}>
                              {pnl >= 0 ? "+" : ""}{fmtPLN(pnl)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* Notatka */}
        {selected && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Notatka (opcjonalnie)</label>
            <input style={baseInp} placeholder="np. XTB, zakup marzec 2024..."
              value={note} onChange={e => setNote(e.target.value)}
              onFocus={focusInp} onBlur={blurInp} />
          </div>
        )}

        {/* Przyciski */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={submit}
            onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
            disabled={!canSave}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 8,
              border: "2px solid #e8e040",
              background: hovSave && canSave ? "#e8e04012" : "transparent",
              color: "#e8e040", fontWeight: 700, fontSize: 13,
              cursor: canSave ? "pointer" : "not-allowed",
              fontFamily: "'Sora', sans-serif", transition: "all .2s",
              opacity: canSave ? 1 : 0.4,
            }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj do portfela"}
          </button>
          {isEdit && (
            <button onClick={() => { onDelete(stock.id); onClose(); }}
              onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${hovDel ? "#f05060" : "#f0506040"}`, background: hovDel ? "#f0506018" : "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", transition: "all .15s" }}>
              Usuń
            </button>
          )}
          <button onClick={onClose}
            style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #f0506040", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer" }}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Podkomponent: podsumowanie zakupu ────────────────────────────────────────
function Summary({ paid, current, pnl, pnlPct, sub }) {
  return (
    <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Podsumowanie</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zapłacono łącznie</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(paid)}</div>
          {sub && <div style={{ fontSize: 11, color: "#4a5a6e" }}>{sub}</div>}
        </div>
        {current !== null && (
          <div>
            <div style={{ fontSize: 11, color: "#5a7a9e" }}>Aktualna wartość</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(current)}</div>
            {pnl !== null && (
              <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: pnl >= 0 ? "#00c896" : "#f05060" }}>
                {pnl >= 0 ? "+" : ""}{fmtPLN(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct?.toFixed(1)}%)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Logo spółki/ETF ─────────────────────────────────────────────────────────
const GPW_LOGOS = {
  "CDR": "cdprojekt.com",
  "PKN": "orlen.pl",
  "PKO": "pkobp.pl",
  "PEO": "pekao.com.pl",
  "PZU": "pzu.pl",
  "ALE": "allegro.eu",
  "DNP": "dino-polska.pl",
  "LPP": "lpp.com.pl",
  "MBK": "mbank.pl",
  "OPL": "orange.pl",
  "KGH": "kghm.com",
  "KTY": "grupakety.com",
  "PGE": "gkpge.pl",
  "BDX": "budimex.pl",
  "SPL": "santander.pl",
  "ALR": "aliorbank.pl",
  "KRU": "kruk.pl",
  "PEP": "pepco.eu",
  "ZBK": "zabka.pl",
  "MOD": "modivo.com",
  "XTB": "xtb.com",
  "CBF": "cyberfolks.pl",
  "CCC": "ccc.eu",
  "CMR": "comarch.pl",
  "GPW": "gpw.pl",
  "ING": "ing.pl",
  "JSW": "jsw.pl",
  "LVC": "livechat.com",
  "MIL": "bankmillennium.pl",
  "PKP": "pkpcargo.com",
  "PLY": "playway.com",
  "RBW": "rainbow.pl",
  "SHO": "shoper.pl",
  "TEN": "tensquaregames.com",
  "TPE": "tauron.pl",
  "VGO": "vigosystem.com",
  "WLT": "wielton.com",
  "WPL": "wirtualna-polska.pl",
  "ENA": "enea.pl",
  "EUR": "eurocash.pl",
  "PCF": "pcf.pl",
  "ACG": "assecosee.pl",
  "MRC": "mercator.com.pl",
  "TIM": "tim.pl",
  "ACP": "asseco.pl",
  "CIE": "ciech.com",
  "ECH": "echo.com.pl",
  "GTC": "gtc.pl",
  "MLG": "mleasing.pl",
  "PGN": "pgnig.pl",
  "AMC": "amica.com.pl",
  "ATT": "atende.pl",
  "BOS": "bosbank.pl",
  "DAT": "datawalk.com",
  "DEK": "dekpol.pl",
  "EFK": "efgkrakow.pl",
  "FAM": "famur.pl",
  "GNB": "getin.pl",
  "LUG": "lug.eu",
  "MAB": "mabion.eu",
  "OEX": "oex.pl",
  "PHN": "phnsa.pl",
  "RLP": "robyg.pl",
  "SNK": "sanok.com.pl",
  "TRK": "torpol.pl",
  "VER": "vercom.pl",
  "VTI": "votum.pl",
  "ZEP": "zpue.pl",
  "BIO": "bioton.pl",
  "CMP": "comp.com.pl"
};

function StockLogo({ symbol, size = 28 }) {
  const [step, setStep] = useState(0);
  const gpwDomain = GPW_LOGOS[symbol];
  const srcs = [
    gpwDomain ? `/api/logo?domain=${gpwDomain}` : null,
    `https://assets.parqet.com/logos/symbol/${symbol}?format=svg`,
    `https://img.logo.dev/ticker/${symbol}?token=sk_fSfcjjqGRsK5evfG9hHOuA&size=64`,
  ].filter(Boolean);
  const colors = ["#e8e040","#00c896","#3b9eff","#ff5ecb","#f0a030"];
  const color = colors[symbol.charCodeAt(0) % colors.length];
  if (step >= srcs.length) {
    return (
      <div style={{ width: size, height: size, borderRadius: 6, background: color + "22", border: `1px solid ${color}60`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: size * 0.35, fontWeight: 700, color, fontFamily: "'DM Mono', monospace" }}>{symbol.slice(0,2)}</span>
      </div>
    );
  }
  return <img src={srcs[step]} onError={() => setStep(s => s + 1)} style={{ width: size, height: size, borderRadius: 6, objectFit: "contain", background: "#1a2535", flexShrink: 0 }} alt={symbol} />;
}

// ─── Wiersz akcji/ETF na liście ───────────────────────────────────────────────
export function StockRow({ stock, stockPrices, onClick }) {
  const [hov, setHov] = useState(false);
  const color = "#e8e040";

  const priceData = stockPrices[stock.stockSymbol];
  const isBroker = stock.stockBrokerValue != null;
  const currentValuePLN = priceData
    ? stock.stockQuantity * priceData.pricePLN
    : isBroker ? stock.stockBrokerValue : stock.value;

  // Koszt zakupu — obsługa wszystkich trybów
  let paidPLN = stock.stockPaidPLN || 0;
  if (!paidPLN && stock.stockTranches?.length) {
    paidPLN = stock.stockTranches.reduce((s, t) => s + (t.totalPLN || 0), 0);
  }
  if (!paidPLN) paidPLN = stock.value;

  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  const hasLivePrice = !!priceData;

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8,
        border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s"
      }}>
      <StockLogo symbol={stock.stockSymbol} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
              {stock.stockSymbol}
            </span>
            <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {stock.stockName || stock.name}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8", flexShrink: 0 }}>
            {priceData?.stale ? "~" : ""}{fmtPLN2(currentValuePLN)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", whiteSpace: "nowrap" }}>
            {stock.stockQuantity > 0 && `${Number(stock.stockQuantity).toFixed(4)} szt.`}
            {priceData && (
              <span style={{ marginLeft: 4, color: "#5a6a7e" }}>
                @ {priceData.stale ? "~" : ""}{priceData.priceOrig.toFixed(2)} {stock.stockCurrency}
              </span>
            )}
            {!hasLivePrice && (
              <span style={{ color: "#3a4a5e", marginLeft: 4 }}>• odświeżanie...</span>
            )}
            {hasLivePrice && priceData?.ts && (() => {
              const age = Math.round((Date.now() - priceData.ts) / 60000);
              return age > 10 ? <span style={{ color: "#3a4a5e", marginLeft: 4 }}>• {age} min temu</span> : null;
            })()}
          </div>
          {hasLivePrice && (
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: "nowrap", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
              {pnlPLN >= 0 ? "+" : ""}{fmtPLN2(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}