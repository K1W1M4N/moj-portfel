// src/MarketView.jsx — Widok rynku: liderzy wzrostów/spadków + newsy investing.com
import { useState, useEffect, useCallback, useRef } from "react";

// ─── Cache helpers ────────────────────────────────────────────────────────────
const MOVERS_TTL = 15 * 60 * 1000;   // 15 minut
const NEWS_TTL   = 60 * 60 * 1000;   // 1 godzina

function cacheLoad(key, ttl) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (!raw?.fetchedAt || Date.now() - raw.fetchedAt > ttl) return null;
    return raw;
  } catch { return null; }
}
function cacheSave(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ─── Formatowanie ─────────────────────────────────────────────────────────────
function fmtNum(n, decimals = 2) {
  if (n == null) return "—";
  return n.toLocaleString("pl-PL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtVol(n) {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " G";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " k";
  return String(n);
}
function timeAgo(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60000);
  const h    = Math.floor(diff / 3600000);
  const d    = Math.floor(diff / 86400000);
  if (d > 30) return new Date(ms).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  if (d >= 1)  return `${d} ${d === 1 ? "dzień" : "dni"} temu`;
  if (h >= 1)  return `${h} godz. temu`;
  if (min >= 1) return `${min} min temu`;
  return "przed chwilą";
}

// ─── Hook: liderzy rynku ──────────────────────────────────────────────────────
function useMarketMovers(market) {
  const cacheKey = `pt-movers-${market}`;
  const [data, setData]       = useState(() => cacheLoad(cacheKey, MOVERS_TTL));
  const [loading, setLoading] = useState(false);

  const fetchMovers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market-movers?market=${market}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      cacheSave(cacheKey, json);
      setData(json);
    } catch (e) {
      console.warn("market-movers error:", e);
    } finally {
      setLoading(false);
    }
  }, [market, cacheKey]);

  useEffect(() => {
    const cached = cacheLoad(cacheKey, MOVERS_TTL);
    if (cached) { setData(cached); return; }
    fetchMovers();
    const iv = setInterval(fetchMovers, MOVERS_TTL);
    return () => clearInterval(iv);
  }, [market, cacheKey, fetchMovers]);

  return { data, loading, refresh: fetchMovers };
}

// ─── Hook: newsy rynkowe ──────────────────────────────────────────────────────
const NEWS_CACHE_KEY = "pt-market-news";

function useMarketNews() {
  const [data, setData]       = useState(() => cacheLoad(NEWS_CACHE_KEY, NEWS_TTL));
  const [loading, setLoading] = useState(false);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/market-news", {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      cacheSave(NEWS_CACHE_KEY, json);
      setData(json);
    } catch (e) {
      console.warn("market-news error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = cacheLoad(NEWS_CACHE_KEY, NEWS_TTL);
    if (cached) { setData(cached); return; }
    fetchNews();
    const iv = setInterval(fetchNews, NEWS_TTL);
    return () => clearInterval(iv);
  }, [fetchNews]);

  return { articles: data?.articles ?? [], source: data?.source, fetchedAt: data?.fetchedAt, loading, refresh: fetchNews };
}

// ─── Tabela liderów ───────────────────────────────────────────────────────────
function MoverRow({ row, rank }) {
  const isUp = (row.change ?? 0) >= 0;
  const color = isUp ? "#00c896" : "#f05060";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "20px 1fr 80px 70px 60px",
      gap: 6, padding: "8px 4px",
      borderBottom: "1px solid #1a2535",
      alignItems: "center",
    }}>
      <span style={{ fontSize: 10, color: "#3a4a5e", textAlign: "right" }}>{rank}</span>
      <div style={{ overflow: "hidden" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.symbol}
        </div>
        <div style={{ fontSize: 10, color: "#5a7a9e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.name}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#e8f0f8", fontFamily: "'DM Mono', monospace", textAlign: "right" }}>
        {fmtNum(row.close)}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", textAlign: "right" }}>
        {isUp ? "+" : ""}{fmtNum(row.change)}%
      </div>
      <div style={{ fontSize: 10, color: "#3a4a5e", textAlign: "right" }}>
        {fmtVol(row.volume)}
      </div>
    </div>
  );
}

function MoversTable({ title, rows, loading, accent }) {
  return (
    <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 12, padding: "14px 16px", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: accent, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, fontFamily: "'DM Mono', monospace" }}>
        {title}
      </div>
      {/* Nagłówek kolumn */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr 80px 70px 60px",
        gap: 6, paddingBottom: 6,
        borderBottom: "1px solid #1e2a38",
        marginBottom: 2,
      }}>
        {["#", "Spółka", "Kurs", "Zmiana", "Wolumen"].map((h, i) => (
          <span key={i} style={{ fontSize: 9, color: "#3a4a5e", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: i > 1 ? "right" : "left" }}>
            {h}
          </span>
        ))}
      </div>
      {loading && rows.length === 0 && (
        <div style={{ fontSize: 12, color: "#3a4a5e", textAlign: "center", padding: "18px 0" }}>Wczytywanie…</div>
      )}
      {!loading && rows.length === 0 && (
        <div style={{ fontSize: 12, color: "#3a4a5e", textAlign: "center", padding: "18px 0" }}>Brak danych</div>
      )}
      {rows.slice(0, 10).map((r, i) => (
        <MoverRow key={r.symbol + i} row={r} rank={i + 1} />
      ))}
    </div>
  );
}

// ─── Sekcja newsów ────────────────────────────────────────────────────────────
function NewsSection() {
  const { articles, source, fetchedAt, loading, refresh } = useMarketNews();

  return (
    <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 12, padding: "14px 16px", marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#5a7a9e", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Aktualności rynkowe
          </span>
          {source && (
            <span style={{ fontSize: 9, color: "#2a4a6e", background: "#0d1a2a", border: "1px solid #1e3a5a", borderRadius: 4, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {source}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {fetchedAt && !loading && (
            <span style={{ fontSize: 10, color: "#3a4a5e" }}>{timeAgo(fetchedAt)}</span>
          )}
          <button
            onClick={refresh} disabled={loading}
            style={{
              fontSize: 13, color: loading ? "#3a4a5e" : "#4a7a9e",
              background: "transparent", border: "1px solid #2a3a50",
              borderRadius: 5, padding: "1px 7px", cursor: loading ? "default" : "pointer",
              fontFamily: "'Sora', sans-serif",
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.color = "#8ab8de"; }}
            onMouseLeave={e => { e.currentTarget.style.color = loading ? "#3a4a5e" : "#4a7a9e"; }}
          >
            {loading ? "···" : "↻"}
          </button>
        </div>
      </div>

      {loading && articles.length === 0 && (
        <div style={{ fontSize: 12, color: "#3a4a5e", textAlign: "center", padding: "20px 0" }}>Wczytywanie newsów…</div>
      )}
      {!loading && articles.length === 0 && (
        <div style={{ fontSize: 12, color: "#3a4a5e", textAlign: "center", padding: "20px 0" }}>Brak newsów</div>
      )}

      {articles.map((a, i) => (
        <a
          key={i}
          href={a.link} target="_blank" rel="noopener noreferrer"
          style={{
            display: "block", textDecoration: "none",
            padding: "10px 0",
            borderBottom: i < articles.length - 1 ? "1px solid #1a2535" : "none",
          }}
        >
          <div
            style={{ fontSize: 13, color: "#c8d8e8", lineHeight: 1.45, marginBottom: 4, transition: "color .1s" }}
            onMouseEnter={e => e.currentTarget.style.color = "#e8f4ff"}
            onMouseLeave={e => e.currentTarget.style.color = "#c8d8e8"}
          >
            {a.title}
          </div>
          {a.description && (
            <div style={{ fontSize: 11, color: "#4a5a6e", lineHeight: 1.4, marginBottom: 4 }}>
              {a.description}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {a.publisher && <span style={{ fontSize: 10, color: "#3a5a7e" }}>{a.publisher}</span>}
            {a.publishedAt && <span style={{ fontSize: 10, color: "#3a4a5e" }}>{timeAgo(a.publishedAt)}</span>}
          </div>
        </a>
      ))}
    </div>
  );
}

// ─── Główny widok ─────────────────────────────────────────────────────────────
export function MarketView() {
  const [tab, setTab] = useState("pl");
  const market = tab === "pl" ? "poland" : "world";
  const { data, loading, refresh } = useMarketMovers(market);

  const gainers = data?.gainers ?? [];
  const losers  = data?.losers  ?? [];
  const moversSource  = data?.source;
  const moversFetched = data?.fetchedAt;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px 40px" }}>

      {/* Zakładki PL / Świat */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "pl",    label: "Polska (GPW)" },
            { id: "world", label: "Świat"        },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: "1px solid",
                borderColor: tab === t.id ? "#00c896" : "#2a3a50",
                background:  tab === t.id ? "#00c89615" : "transparent",
                color:       tab === t.id ? "#00c896" : "#5a6a7e",
                cursor: "pointer", fontFamily: "'Sora', sans-serif", transition: "all .15s",
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {moversSource && (
            <span style={{ fontSize: 9, color: "#2a4a6e", background: "#0d1a2a", border: "1px solid #1e3a5a", borderRadius: 4, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {moversSource}
            </span>
          )}
          {moversFetched && !loading && (
            <span style={{ fontSize: 10, color: "#3a4a5e" }}>{timeAgo(moversFetched)}</span>
          )}
          <button onClick={refresh} disabled={loading}
            style={{
              fontSize: 13, color: loading ? "#3a4a5e" : "#4a7a9e",
              background: "transparent", border: "1px solid #2a3a50",
              borderRadius: 5, padding: "1px 7px", cursor: loading ? "default" : "pointer",
              fontFamily: "'Sora', sans-serif",
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.color = "#8ab8de"; }}
            onMouseLeave={e => { e.currentTarget.style.color = loading ? "#3a4a5e" : "#4a7a9e"; }}>
            {loading ? "···" : "↻"}
          </button>
        </div>
      </div>

      {/* Tabele liderów */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <MoversTable title="▲ Wzrosty" rows={gainers} loading={loading} accent="#00c896" />
        <MoversTable title="▼ Spadki"  rows={losers}  loading={loading} accent="#f05060" />
      </div>

      {/* Newsy */}
      <NewsSection />
    </div>
  );
}
