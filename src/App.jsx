import { Component, useState, useRef, useEffect, useCallback } from "react";
import { BondModal, BondDetailPanel, BondRow, calcBondCurrentValue } from "./BondModal";
import { StockModal, StockRow, StockDetailPanel, useStockPrices, isMarketHours } from "./StockModal";
import { SavingsModal, SavingsFormModal, SavingsRow, getSavingsValue } from "./SavingsModal";
import { CommodityModal, CommodityRow, CommodityDetailPanel, useCommodityPrices, calcCommodityValue } from "./CommodityModal";
import { CurrencyModal, CurrencyRow, SUPPORTED_CURRENCIES } from "./CurrencyModal";
import { fetchFxRate } from "./fxUtils";
import { BOND_RATES_HISTORY } from "./bondRates";
import { INFLATION_HISTORY } from "./inflationData";
import { SAVINGS_RATES_DB } from "./savingsRates";
import { MarketView } from "./MarketView";

const CRYPTO_LIST = [
  { label: "Bitcoin (BTC)",    id: "bitcoin" },
  { label: "Ethereum (ETH)",   id: "ethereum" },
  { label: "BNB",              id: "binancecoin" },
  { label: "Solana (SOL)",     id: "solana" },
  { label: "XRP",              id: "ripple" },
  { label: "Dogecoin (DOGE)", id: "dogecoin" },
  { label: "USDT",             id: "tether" },
  { label: "USDC",             id: "usd-coin" },
  { label: "Shiba Inu (SHIB)", id: "shiba-inu" },
  { label: "Toncoin (TON)",    id: "the-open-network" },
];

const DEFAULT_CATEGORIES = [
  { name: "Konto oszczędnościowe", color: "#00c896" },
  { name: "Konto osobiste",        color: "#3b9eff" },
  { name: "Lokata",                color: "#f0a030" },
  { name: "Obligacje",             color: "#a78bfa" },
  { name: "PPK",                   color: "#f24060" },
  { name: "Akcje / ETF",           color: "#e8e040" },
  { name: "Krypto",                color: "#ff5ecb" },
  { name: "Surowce",               color: "#00d4f0" },
  { name: "Waluty",                color: "#1e88e5" },
  { name: "Nieruchomości",         color: "#b8f060" },
];

function catColor(categories, name) {
  return (categories.find(c => c.name === name) || { color: "#8a9bb0" }).color;
}

function fmt(n) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency", currency: "PLN", maximumFractionDigits: 0
  }).format(n);
}

function fmtSmall(n) {
  if (Math.abs(n) < 0.01) return n.toFixed(6);
  if (Math.abs(n) < 1) return n.toFixed(4);
  return n.toLocaleString("pl-PL", { maximumFractionDigits: 4 });
}

function fmtK(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".", ",") + " M";
  if (n >= 1000) return Math.round(n / 1000) + " k";
  return Math.round(n).toString();
}

// ─── Cache kursów krypto ──────────────────────────────────────────────────────
const CRYPTO_CACHE_KEY = "pt-crypto-cache";
const CRYPTO_CACHE_TTL = 10 * 60 * 1000; // 10 minut

function loadCryptoCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CRYPTO_CACHE_KEY) || "{}");
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v.ts && now - v.ts < CRYPTO_CACHE_TTL));
  } catch { return {}; }
}
function saveCryptoCache(data) {
  try {
    const withTs = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...v, ts: Date.now() }]));
    localStorage.setItem(CRYPTO_CACHE_KEY, JSON.stringify(withTs));
  } catch {}
}
function loadStaleCryptoCache() {
  try { return JSON.parse(localStorage.getItem(CRYPTO_CACHE_KEY) || "{}"); } catch { return {}; }
}

function useCryptoPrices(assets) {
  const [prices, setPrices] = useState(() => loadCryptoCache());
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const cryptoAssets = assets.filter(a => a.cryptoId);
    if (cryptoAssets.length === 0) return;
    const ids = [...new Set(cryptoAssets.map(a => a.cryptoId))].join(",");

    const attemptFetch = async () => {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=pln&include_24hr_change=true`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } finally {
        clearTimeout(tid);
      }
    };

    async function fetchPrices() {
      try {
        let data;
        try {
          data = await attemptFetch();
        } catch (e) {
          if (e.name === "AbortError") {
            await new Promise(r => setTimeout(r, 3000));
            data = await attemptFetch();
          } else {
            throw e;
          }
        }
        saveCryptoCache(data);
        setPrices(data);
        setLastUpdated(new Date());
      } catch (e) {
        console.warn("CoinGecko error:", e);
        const stale = loadStaleCryptoCache();
        if (Object.keys(stale).length > 0) {
          const marked = Object.fromEntries(Object.entries(stale).map(([k, v]) => [k, { ...v, stale: true }]));
          setPrices(prev => ({ ...prev, ...marked }));
          const latestTs = Math.max(...Object.values(stale).map(v => v.ts || 0));
          if (latestTs > 0) setLastUpdated(new Date(latestTs));
        }
      }
    }

    fetchPrices();
    const interval = setInterval(fetchPrices, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [assets.map(a => a.cryptoId).join(",")]);

  return { prices, lastUpdated };
}

function useCurrencyRates(assets) {
  const [rates, setRates] = useState({ PLN: 1 });
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const currencies = [...new Set(assets.filter(a => a.isCurrency).map(a => a.currencyCode))];
    if (currencies.length === 0) return;

    async function fetchAll() {
      const newRates = { PLN: 1 };
      await Promise.all(currencies.map(async code => {
        newRates[code] = await fetchFxRate(code);
      }));
      setRates(newRates);
      setLastUpdated(new Date());
    }

    fetchAll();
    const interval = setInterval(fetchAll, 30 * 60 * 1000); // 30 min
    return () => clearInterval(interval);
  }, [assets.filter(a => a.isCurrency).map(a => a.currencyCode).join(",")]);

  return { rates, lastUpdated };
}

// ─── Widok Obligacji ──────────────────────────────────────────────────────────
const BOND_DESCRIPTIONS = {
  OTS: { full: "Trzymiesięczne Oszczędnościowe Skarbowe", desc: "Stałe oprocentowanie przez 3 miesiące. Odsetki wypłacane jednorazowo w dniu wykupu. Wcześniejszy wykup po 7 dniach — zwrot kapitału bez odsetek.", color: "#34d399", years: 0.25 },
  TOS: { full: "Trzyletnie Oszczędnościowe Skarbowe", desc: "Stałe oprocentowanie przez 3 lata. Odsetki kapitalizowane rocznie — wypłata w dniu wykupu.", color: "#f0a030", years: 3 },
  COI: { full: "Czteroletnie Oszczędnościowe Indeksowane", desc: "Rok 1: stałe. Rok 2–4: inflacja GUS + marża 1,5%. Odsetki wypłacane co rok.", color: "#a78bfa", years: 4 },
  EDO: { full: "Emerytalne Dziesięcioletnie Oszczędnościowe", desc: "Rok 1: stałe. Rok 2–10: inflacja GUS + marża 2%. Odsetki kapitalizowane rocznie.", color: "#00c896", years: 10 },
  ROS: { full: "Rodzinne Sześcioletnie Oszczędnościowe", desc: "Rok 1: stałe. Rok 2–6: inflacja GUS + marża 2%. Dostępne dla beneficjentów 500+.", color: "#3b9eff", years: 6 },
  ROD: { full: "Rodzinne Dwunastoletnie Oszczędnościowe", desc: "Rok 1: stałe. Rok 2–12: inflacja GUS + marża 2,5%. Najwyższa marża spośród wszystkich obligacji.", color: "#ff5ecb", years: 12 },
  ROR: { full: "Roczne Oszczędnościowe o Zmiennej Stopie", desc: "Oprocentowanie zmienne — stopa referencyjna NBP. Odsetki wypłacane co miesiąc.", color: "#00d4f0", years: 1 },
  DOR: { full: "Dwuletnie Oszczędnościowe o Zmiennej Stopie", desc: "Rok 1: stałe. Rok 2: stopa referencyjna NBP + marża 0,15%. Odsetki wypłacane co miesiąc.", color: "#e8e040", years: 2 },
};

function getLatestRate(bondType) {
  const rates = BOND_RATES_HISTORY[bondType];
  if (!rates) return null;
  const keys = Object.keys(rates).sort();
  if (keys.length === 0) return null;
  return { rate: rates[keys[keys.length - 1]], month: keys[keys.length - 1] };
}

function getLastUpdateDate() {
  let latest = "";
  Object.values(BOND_RATES_HISTORY).forEach(rates => {
    const keys = Object.keys(rates).sort();
    if (keys.length > 0 && keys[keys.length - 1] > latest) {
      latest = keys[keys.length - 1];
    }
  });
  return latest;
}

function BondRatesView() {
  const lastUpdate = getLastUpdateDate();
  const [expanded, setExpanded] = useState(null);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px 32px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#5a6a7e" }}>
          Aktualne stawki obligacji skarbowych
          {lastUpdate && (
            <span style={{ marginLeft: 8, color: "#4a5a6e", fontSize: 11 }}>
              · dane z {lastUpdate}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {Object.entries(BOND_DESCRIPTIONS).map(([type, info]) => {
          const latest = getLatestRate(type);
          const isOpen = expanded === type;
          const rates = BOND_RATES_HISTORY[type] || {};
          const allKeys = Object.keys(rates).sort().reverse();
          const recentKeys = allKeys.filter((key, i) => {
            if (i === 0) return true;
            const prevKey = allKeys[i - 1];
            return rates[key] !== rates[prevKey];
          }).slice(0, 8);
          const prevRate = recentKeys.length > 1 ? rates[recentKeys[1]] : null;
          const delta = latest && prevRate != null ? latest.rate - prevRate : null;

          return (
            <div key={type}
              onClick={() => setExpanded(isOpen ? null : type)}
              style={{
                background: "#161d28",
                border: `1px solid ${isOpen ? info.color + "60" : "#1e2a38"}`,
                borderRadius: 14, padding: "16px 18px", cursor: "pointer",
                transition: "all .2s",
                boxShadow: isOpen ? `0 0 20px ${info.color}20` : "none",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: info.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{type}</span>
                    <span style={{ fontSize: 11, color: "#4a5a6e" }}>{info.years < 1 ? `${Math.round(info.years * 12)} mies.` : `${info.years} ${info.years === 1 ? "rok" : info.years < 5 ? "lata" : "lat"}`}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5a6a7e", marginLeft: 16 }}>{info.full}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {latest ? (
                    <>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
                        {delta !== null && Math.abs(delta) > 0.00001 && (
                          <span style={{ fontSize: 11, fontWeight: 500, color: delta > 0 ? "#4ade80" : "#f87171", fontFamily: "'DM Mono', monospace" }}>
                            {delta > 0 ? "+" : ""}{(delta * 100).toFixed(2)}%
                          </span>
                        )}
                        <div style={{ fontSize: 20, fontWeight: 700, color: info.color, fontFamily: "'DM Mono', monospace" }}>
                          {(latest.rate * 100).toFixed(2)}%
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: "#4a5a6e" }}>{info.years < 1 ? "stałe" : "rok 1"} · {latest.month}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: "#4a5a6e" }}>brak danych</div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#5a7a9e", lineHeight: 1.6, marginBottom: isOpen ? 14 : 0 }}>
                {info.desc}
              </div>
              {isOpen && recentKeys.length > 0 && (
                <div style={{ marginTop: 12, borderTop: "1px solid #1e2a38", paddingTop: 12 }}>
                  <div style={{ fontSize: 10, color: "#4a5a6e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Historia stawek (rok 1)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {recentKeys.map(key => (
                      <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#5a6a7e", fontFamily: "'DM Mono', monospace" }}>{key}</span>
                        <span style={{ fontSize: 12, color: key === latest?.month ? info.color : "#8a9bb0", fontWeight: key === latest?.month ? 600 : 400, fontFamily: "'DM Mono', monospace" }}>
                          {(rates[key] * 100).toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ textAlign: "right", marginTop: 8, fontSize: 11, color: "#3a4a5e" }}>
                {isOpen ? "▲ zwiń" : "▼ historia"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
function MenuDropdown({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, []);

  const items = [
    { id: "savings", label: "Konta Oszcz.", desc: "Zarządzaj kontami" },
    { id: "bonds",   label: "Obligacje", desc: "Aktualne stawki" },
    { id: "history", label: "Historia", desc: "Wartość portfela w czasie" },
    { id: "market",  label: "Rynek", desc: "Liderzy wzrostów i newsy" },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: open ? "#1e2a38" : "transparent",
          border: `1px solid ${open ? "#2a3a50" : "#1e2a38"}`,
          borderRadius: 10, color: "#8a9bb0", cursor: "pointer",
          width: 36, height: 36, display: "flex", alignItems: "center",
          justifyContent: "center", transition: "all .15s",
          flexDirection: "column", gap: 4, padding: "8px 9px",
        }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 16, height: 2, borderRadius: 1,
              background: open ? "#e8f0f8" : "#5a6a7e",
              transition: "all .15s",
              transform: open && i === 0 ? "translateY(6px) rotate(45deg)" :
                         open && i === 1 ? "scaleX(0)" :
                         open && i === 2 ? "translateY(-6px) rotate(-45deg)" : "none",
            }} />
          ))}
        </div>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 44, right: 0,
          background: "#161d28", border: "1px solid #2a3a50",
          borderRadius: 12, padding: "6px", minWidth: 200,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 100,
        }}>
          {items.map(item => (
            <button key={item.id}
              onClick={() => { onNavigate(item.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "none", background: "transparent", cursor: "pointer",
                textAlign: "left", transition: "background .1s",
                WebkitTapHighlightColor: "transparent",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#e8f0f8", fontFamily: "'Sora', sans-serif" }}>{item.label}</div>
                <div style={{ fontSize: 11, color: "#4a5a6e", fontFamily: "'Sora', sans-serif" }}>{item.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Wykres kołowy ────────────────────────────────────────────────────────────
function getAssetCostBasis(a) {
  if (a.isStock)  return a.stockPaidPLN || a.value || 0;
  if (a.isCrypto || a.cryptoId) return a.cryptoPaid || a.value || 0;
  if (a.isBond) return (a.quantity || 0) * 100;
  if (a.isSavings) { const txs = a.transactions || []; return txs.length > 0 ? txs.reduce((s, tx) => s + tx.amount, 0) : (a.value || 0); }
  if (a.isCurrency) return a.value || 0;
  if (a.isCommodity) return a.commodityPaid || a.value || 0;
  if (a.purchaseAmount > 0) return a.purchaseAmount;
  return a.value || 0;
}

function fmtSigned(n) {
  return (n >= 0 ? "+" : "") + new Intl.NumberFormat("pl-PL", {
    style: "currency", currency: "PLN", maximumFractionDigits: 0,
  }).format(n);
}

function PieChart({ assets, categories, activeFilter, onFilterChange, hovered, setHovered }) {
  const canvasRef = useRef(null);
  const sliceMapRef = useRef([]);

  const getGrouped = useCallback(() => {
    const total = assets.reduce((s, a) => s + a.value, 0);
    return categories
      .map(c => ({
        name: c.name, color: c.color,
        value: assets.filter(a => a.category === c.name).reduce((s, a) => s + a.value, 0)
      }))
      .filter(g => g.value > 0)
      .map(g => ({ ...g, pct: g.value / total }));
  }, [assets, categories]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 220;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const grouped = getGrouped();
    const total = assets.reduce((s, a) => s + a.value, 0);
    const cx = 110, cy = 110, r = 96, inner = 62;
    ctx.clearRect(0, 0, size, size);
    sliceMapRef.current = [];
    let angle = -Math.PI / 2;

    grouped.forEach(g => {
      const start = angle;
      angle += g.pct * 2 * Math.PI;
      const end = angle;
      sliceMapRef.current.push({
        name: g.name, color: g.color, pct: g.pct, value: g.value,
        start: start + Math.PI / 2, end: end + Math.PI / 2
      });
      const isActive = activeFilter === g.name;
      const isHov = hovered === g.name;
      const scale = (isActive || isHov) ? 1.05 : 1;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
      ctx.beginPath();
      ctx.moveTo(cx + inner * Math.cos(start), cy + inner * Math.sin(start));
      ctx.lineTo(cx + r * Math.cos(start), cy + r * Math.sin(start));
      ctx.arc(cx, cy, r, start, end);
      ctx.lineTo(cx + inner * Math.cos(end), cy + inner * Math.sin(end));
      ctx.arc(cx, cy, inner, end, start, true);
      ctx.closePath();
      ctx.globalAlpha = (activeFilter && !isActive) ? 0.28 : 1;
      ctx.fillStyle = g.color; ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();
    });

    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = "#161d28"; ctx.fill();
    ctx.textAlign = "center";

    const disp = hovered || activeFilter;
    const dispG = disp ? sliceMapRef.current.find(s => s.name === disp) : null;

    if (dispG) {
      ctx.fillStyle = dispG.color; ctx.font = "500 11px 'Sora', sans-serif";
      ctx.fillText(dispG.name.split(" ")[0], cx, cy - 14);
      
      let fstV = fmt(dispG.value);
      ctx.fillStyle = "#e8f0f8"; ctx.font = "bold 15px 'DM Mono', monospace";
      if (ctx.measureText(fstV).width > 105) ctx.font = "bold 13px 'DM Mono', monospace";
      if (ctx.measureText(fstV).width > 105) ctx.font = "bold 11px 'DM Mono', monospace";
      ctx.fillText(fstV, cx, cy + 8);
      
      ctx.fillStyle = dispG.color; ctx.font = "500 13px 'DM Mono', monospace";
      ctx.fillText((dispG.pct * 100).toFixed(1) + "%", cx, cy + 27);
    } else {
      ctx.fillStyle = "#8a9bb0"; ctx.font = "500 10px 'Sora', sans-serif";
      ctx.fillText("ŁĄCZNIE", cx, cy - 6);
      
      let fst = fmt(total);
      ctx.fillStyle = "#00c896"; ctx.font = "bold 18px 'DM Mono', monospace";
      if (ctx.measureText(fst).width > 105) ctx.font = "bold 15px 'DM Mono', monospace";
      if (ctx.measureText(fst).width > 105) ctx.font = "bold 13px 'DM Mono', monospace";
      ctx.fillText(fst, cx, cy + 16);
    }
  }, [getGrouped, assets, activeFilter, hovered]);

  useEffect(() => { draw(); }, [draw]);

  function getCatFromPoint(x, y) {
    const cx = 110, cy = 110, r = 96, inner = 62;
    const dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < inner || dist > r) return null;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    if (a > Math.PI * 2) a -= Math.PI * 2;
    for (const s of sliceMapRef.current) {
      const st = ((s.start % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const en = ((s.end % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (st < en) { if (a >= st && a <= en) return s.name; }
      else { if (a >= st || a <= en) return s.name; }
    }
    return null;
  }

  function isInCenter(x, y) {
    const cx = 110, cy = 110, inner = 62;
    const dx = x - cx, dy = y - cy;
    return Math.sqrt(dx * dx + dy * dy) < inner;
  }

  function getScaledCoords(clientX, clientY) {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = 220 / rect.width;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleX };
  }

  function handleMouseMove(e) {
    const { x, y } = getScaledCoords(e.clientX, e.clientY);
    const cat = getCatFromPoint(x, y);
    canvasRef.current.style.cursor = (cat || isInCenter(x, y)) ? "pointer" : "default";
    if (cat !== hovered) setHovered(cat);
  }

  function handleClick(e) {
    const { x, y } = getScaledCoords(e.clientX, e.clientY);
    const cat = getCatFromPoint(x, y);
    if (cat) { setHovered(null); onFilterChange(cat === activeFilter ? null : cat); }
    else if (isInCenter(x, y)) { setHovered(null); onFilterChange(null); }
  }

  function handleTouch(e) {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const { x, y } = getScaledCoords(touch.clientX, touch.clientY);
    const cat = getCatFromPoint(x, y);
    if (cat) { setHovered(null); onFilterChange(cat === activeFilter ? null : cat); }
    else if (isInCenter(x, y)) { setHovered(null); onFilterChange(null); }
  }

  const grouped = getGrouped();

  const groupedPnl = grouped.map(g => {
    const catAssets = assets.filter(a => a.category === g.name);
    const paid = catAssets.reduce((s, a) => s + getAssetCostBasis(a), 0);
    const pnl    = paid > 0 ? g.value - paid : null;
    const pnlPct = paid > 0 ? (g.value - paid) / paid * 100 : null;
    return { ...g, paid, pnl, pnlPct };
  });

  const totalPaid  = groupedPnl.reduce((s, g) => s + (g.paid || 0), 0);
  const totalValue = assets.reduce((s, a) => s + a.value, 0);
  const totalPnl   = totalPaid > 0 ? totalValue - totalPaid : null;
  const totalPnlPct = totalPaid > 0 ? (totalValue - totalPaid) / totalPaid * 100 : null;

  const shownPnl = activeFilter
    ? groupedPnl.filter(g => g.name === activeFilter)
    : groupedPnl;

  return (
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap", width: "100%", alignItems: "flex-start", userSelect: "none", WebkitUserSelect: "none" }}>

      {/* Lewa kolumna: wykres kołowy + legenda % */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, flex: "1 1 300px", flexWrap: "wrap", justifyContent: "center" }}>
        <canvas ref={canvasRef}
          style={{ flexShrink: 0, width: "220px", height: "220px", cursor: "pointer", WebkitTouchCallout: "none" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
          onClick={handleClick}
          onTouchEnd={handleTouch}
        />
        <div className="pie-legend" style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1, minWidth: 200, WebkitTouchCallout: "none" }}>
          <div style={{ fontSize: 11, color: "#5a6a7e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Podział portfela</div>
          {grouped.map(g => (
            <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 10, opacity: activeFilter && activeFilter !== g.name ? 0.35 : 1, transition: "opacity .15s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", minWidth: 140 }}
                onClick={() => { setHovered(null); onFilterChange(g.name === activeFilter ? null : g.name); }}
                onTouchEnd={e => { e.preventDefault(); setHovered(null); onFilterChange(g.name === activeFilter ? null : g.name); }}
                onMouseEnter={() => setHovered(g.name)}
                onMouseLeave={() => setHovered(null)}
              >
                <div style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "#8a9bb0" }}>{g.name}</span>
              </div>
              <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "#e8f0f8", flex: 1, textAlign: "right" }}>{fmt(g.value)}</span>
              <span style={{ fontSize: 11, color: g.color, minWidth: 42, textAlign: "right", fontFamily: "'DM Mono', monospace" }}>
                {(g.pct * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>


    </div>
  );
}

// ─── Podsumowanie Portfela (Live) ──────────────────────────────────────────────

// Oblicz wartość konta oszczędnościowego na dowolną datę w przeszłości
function calcSavingsValueAtDate(account, targetDate) {
  const { openDate, rate, transactions = [] } = account;
  if (!openDate || rate == null) return null;
  const annualRate = rate / 100;
  const tDate = new Date(targetDate); tDate.setHours(0, 0, 0, 0);
  const openDateObj = new Date(openDate); openDateObj.setHours(0, 0, 0, 0);
  if (tDate < openDateObj) return 0;
  if (transactions.length === 0) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysBack = Math.round((today - tDate) / 86400000);
    const cv = account.value || 0;
    return Math.round((cv - cv * annualRate * (daysBack / 365)) * 100) / 100;
  }
  const sorted = [...transactions].sort((a, b) => (a.date > b.date ? 1 : -1));
  const tStr = tDate.toISOString().slice(0, 10);
  let balance = 0;
  for (const tx of sorted) { if (tx.date <= openDate) balance += tx.amount; }
  let periodStart = new Date(openDateObj);
  let safety = 0;
  while (safety++ < 600) {
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    if (periodEnd > tDate) break;
    const pStartStr = periodStart.toISOString().slice(0, 10);
    const pEndStr = periodEnd.toISOString().slice(0, 10);
    const txSum = sorted.filter(tx => tx.date > pStartStr && tx.date <= pEndStr).reduce((s, tx) => s + tx.amount, 0);
    const days = Math.round((periodEnd - periodStart) / 86400000);
    const interest = Math.round(balance * annualRate * (days / 365) * 100) / 100;
    balance = Math.round((balance + interest + txSum) * 100) / 100;
    periodStart = new Date(periodEnd);
  }
  const lastCapStr = periodStart.toISOString().slice(0, 10);
  balance = Math.round((balance + sorted.filter(tx => tx.date > lastCapStr && tx.date <= tStr).reduce((s, tx) => s + tx.amount, 0)) * 100) / 100;
  const daysAccrued = Math.max(0, Math.round((tDate - periodStart) / 86400000));
  return Math.round((balance + balance * annualRate * (daysAccrued / 365)) * 100) / 100;
}

function PortfolioSummaryPanel({ assets, activeFilter, categories, history }) {
  const cats = activeFilter ? [activeFilter] : categories.map(c => c.name);
  let totalValue = 0, totalPaid = 0;

  cats.forEach(c => {
    const catAssets = assets.filter(a => a.category === c);
    totalValue += catAssets.reduce((s, a) => s + a.value, 0);
    totalPaid += catAssets.reduce((s, a) => s + getAssetCostBasis(a), 0);
  });

  const totalPnl = totalPaid > 0 ? totalValue - totalPaid : null;
  const totalPnlPct = totalPaid > 0 ? (totalValue - totalPaid) / totalPaid * 100 : null;

  // Oblicz historyczną wartość TYLKO dla obliczalnych kategorii
  const calculableCategories = ["Obligacje", "Konto oszczędnościowe"];
  const isCalculable = activeFilter && calculableCategories.includes(activeFilter);

  function getHistVal(daysAgo) {
    if (!isCalculable) return null;
    const t = new Date(); t.setDate(t.getDate() - daysAgo);
    const targetAssets = assets.filter(a => a.category === activeFilter);
    if (targetAssets.length === 0) return null;
    let total = 0;
    for (const a of targetAssets) {
      if (a.isBond && a.purchaseDate && a.quantity) { total += calcBondCurrentValue(a, t).currentValue; continue; }
      if (a.isSavings && a.openDate && a.rate != null) { const v = calcSavingsValueAtDate(a, t); if (v !== null) { total += v; continue; } }
      return null;
    }
    return total;
  }

  const v1d = getHistVal(1);
  const v30d = getHistVal(30);
  const v365d = getHistVal(365);
  const diff1d = v1d !== null ? totalValue - v1d : null;
  const pct1d = v1d && v1d > 0 ? (diff1d / v1d) * 100 : null;
  const diff30d = v30d !== null ? totalValue - v30d : null;
  const pct30d = v30d && v30d > 0 ? (diff30d / v30d) * 100 : null;
  const diff365d = v365d !== null ? totalValue - v365d : null;
  const pct365d = v365d && v365d > 0 ? (diff365d / v365d) * 100 : null;

  const hasTimeTiles = diff1d !== null || diff30d !== null || diff365d !== null;

  // Formatowanie kwot — bez groszy gdy >= 1000 zł (kompaktowe kafelki)
  function fmtCompact(n) {
    if (n === null || isNaN(n)) return "—";
    const abs = Math.abs(n);
    const d = abs >= 1000 ? 0 : 2;
    return (n >= 0 ? "+" : "") + new Intl.NumberFormat("pl-PL", {
      style: "currency", currency: "PLN", minimumFractionDigits: d, maximumFractionDigits: d,
    }).format(n);
  }

  const mBlock = (label, diff, pct) => (
    <div style={{ background: "#0f1621", border: "1px solid " + (diff !== null && diff !== 0 ? (diff > 0 ? "#00c89630" : "#f0506030") : "#1e2a38"), borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2, flex: "1 1 120px", minWidth: 0 }}>
      <div style={{ fontSize: 9, color: "#5a6a7e", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Sora', sans-serif" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: "auto" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: diff > 0 ? "#00c896" : diff < 0 ? "#f05060" : "#e8f0f8", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>
          {diff !== null ? fmtCompact(diff) : "—"}
        </div>
        {pct !== null && (
          <div style={{ fontSize: 9, fontWeight: 600, color: diff > 0 ? "#00c896" : diff < 0 ? "#f05060" : "#5a6a7e", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap", flexShrink: 0 }}>
            ({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed #1e2a38" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#e8f0f8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Podsumowanie: <span style={{ color: activeFilter ? catColor(categories, activeFilter) : "#00c896" }}>{activeFilter || "Cały Portfel"}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: hasTimeTiles ? 8 : 0 }}>
        <div style={{ background: "linear-gradient(145deg, #0d131c, #111720)", border: "1px solid #1e2a38", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 9, color: "#5a6a7e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Bieżąca Wartość</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e8f0f8", fontFamily: "'DM Mono', monospace", marginTop: "auto", whiteSpace: "nowrap" }}>{fmt(totalValue)}</div>
        </div>
        <div style={{ background: "linear-gradient(145deg, #0d131c, #111720)", border: "1px solid #1e2a38", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ fontSize: 9, color: "#5a6a7e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Zysk Całkowity</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: totalPnl >= 0 ? "#00c896" : "#f05060", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>
              {totalPnl !== null ? fmtCompact(totalPnl) : "—"}
            </div>
            {totalPnlPct !== null && (
              <div style={{ fontSize: 9, fontWeight: 600, color: totalPnlPct >= 0 ? "#00c896" : "#f05060", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap", flexShrink: 0 }}>
                ({totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(1)}%)
              </div>
            )}
          </div>
        </div>
      </div>

      {hasTimeTiles && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {mBlock("Zysk dzienny", diff1d, pct1d)}
          {mBlock("Zysk miesięczny", diff30d, pct30d)}
          {mBlock("Zysk roczny", diff365d, pct365d)}
          <div style={{ background: "#0f1621", border: "1px solid #1e2a38", borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "#5a6a7e", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Sora', sans-serif" }}>Średnia Roczna</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: pct365d !== null ? (pct365d >= 0 ? "#00c896" : "#f05060") : "#5a6a7e", fontFamily: "'DM Mono', monospace", marginTop: "auto", whiteSpace: "nowrap" }}>
              {pct365d !== null ? (pct365d >= 0 ? "+" : "") + pct365d.toFixed(2) + "%" : "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

function neonBtnStyle(hov) {
  return {
    flex: 1, padding: "10px 16px", borderRadius: 8,
    border: "2px solid #00c896",
    background: hov ? "#00c89612" : "transparent",
    color: "#00c896", fontWeight: 700, fontSize: 13, cursor: "pointer",
    letterSpacing: ".03em", fontFamily: "'Sora', sans-serif",
    textShadow: "0 0 6px #00c89680",
    boxShadow: hov ? "0 0 14px #00c896, inset 0 0 10px #00c89620" : "0 0 8px #00c89630, inset 0 0 6px #00c89610",
    transition: "all .2s",
  };
}

function redBtnStyle(hov) {
  return {
    padding: "10px 16px", borderRadius: 8,
    border: `1px solid ${hov ? "#f05060" : "#f0506040"}`,
    background: hov ? "#f0506018" : "transparent",
    color: "#f05060", fontSize: 13, cursor: "pointer",
    fontFamily: "'Sora', sans-serif", transition: "all .15s",
  };
}

function closeBtnStyle(hov) {
  return {
    background: hov ? "#f0506018" : "#161d28",
    border: `1px solid ${hov ? "#f05060" : "#f0506030"}`,
    borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18,
    width: 30, height: 30, display: "flex", alignItems: "center",
    justifyContent: "center", transition: "all .15s",
  };
}

function AssetModal({ asset, categories, onSave, onDelete, onClose, onMove }) {
  const isEdit = !!asset && !asset.isNew;
  const [form, setForm] = useState(
    asset && !asset.isNew ? { ...asset } : { name: "", category: asset?.category || categories[0]?.name || "", value: "", note: "", cryptoId: "", cryptoAmount: "", cryptoPaid: "" }
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [hovSave, setHovSave] = useState(false);
  const [hovDel, setHovDel]   = useState(false);
  const [hovCancel, setHovCancel] = useState(false);
  const [hovClose, setHovClose]   = useState(false);

  const isCrypto = form.category === "Krypto";
  const isCustomCrypto = form.cryptoId === "other";

  function focusInp(e) { e.target.style.borderColor = "#00c896"; e.target.style.boxShadow = "0 0 0 3px #00c89618"; }
  function blurInp(e)  { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; }

  function submit() {
    if (isCrypto && form.cryptoId && form.cryptoId !== "other") {
      const amount = parseFloat(String(form.cryptoAmount).replace(",", "."));
      const paid   = parseFloat(String(form.cryptoPaid).replace(",", "."));
      if (!form.name.trim() || isNaN(amount) || amount <= 0 || isNaN(paid) || paid <= 0) return;
      onSave({ ...form, value: paid, cryptoAmount: amount, cryptoPaid: paid, id: asset?.id || Date.now() });
    } else {
      const val = parseFloat(String(form.value).replace(",", "."));
      if (!form.name.trim() || isNaN(val) || val <= 0) return;
      onSave({ ...form, value: val, cryptoId: "", cryptoAmount: "", cryptoPaid: "", id: asset?.id || Date.now() });
    }
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>{isEdit ? "Edytuj aktywo" : "Dodaj aktywo"}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {isEdit && onMove && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setMenuOpen(o => !o)}
                  style={{ background: menuOpen ? "#1e2a38" : "transparent", border: `1px solid ${menuOpen ? "#2a3a50" : "#1e2a38"}`, borderRadius: 8, color: "#8a9bb0", cursor: "pointer", width: 32, height: 32, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  ···
                </button>
                {menuOpen && (
                  <div style={{ position: "absolute", top: 38, right: 0, background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10, padding: "4px", minWidth: 150, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 10 }}>
                    <button onClick={() => { setMenuOpen(false); onMove(asset); }}
                      style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      Przenieś
                    </button>
                  </div>
                )}
              </div>
            )}
            <button onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
              onClick={onClose} style={closeBtnStyle(hovClose)}>×</button>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Nazwa aktywa</label>
          <input style={baseInp} placeholder="np. Mój Bitcoin, Konto PKO..."
            value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onFocus={focusInp} onBlur={blurInp} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div>
            <label style={labelSt}>Kategoria</label>
            {addingCat ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...baseInp, flex: 1 }} placeholder="Nazwa nowej kategorii..." value={newCat} autoFocus
                  onChange={e => setNewCat(e.target.value)} onFocus={focusInp} onBlur={blurInp}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newCat.trim()) { setForm(f => ({ ...f, category: newCat.trim() })); setAddingCat(false); }
                    if (e.key === "Escape") setAddingCat(false);
                  }} />
                <button onClick={() => { if (newCat.trim()) setForm(f => ({ ...f, category: newCat.trim() })); setAddingCat(false); }}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#00c896", color: "#000", fontWeight: 600, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>OK</button>
                <button onClick={() => setAddingCat(false)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #f0506060", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", flexShrink: 0 }}>✕</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <select style={{ ...baseInp, flex: 1 }} value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value, cryptoId: "", cryptoAmount: "", cryptoPaid: "" }))}
                  onFocus={focusInp} onBlur={blurInp}>
                  {categories.map(c => <option key={c.name} value={c.name} style={{ background: "#1a2535", color: "#e8f0f8" }}>{c.name}</option>)}
                  {!categories.find(c => c.name === form.category) && form.category &&
                    <option value={form.category} style={{ background: "#1a2535", color: "#e8f0f8" }}>{form.category}</option>}
                </select>
                <button onClick={() => { setAddingCat(true); setNewCat(""); }}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #243040", background: "#1a2535", color: "#8a9bb0", fontSize: 16, cursor: "pointer", flexShrink: 0 }}>+</button>
              </div>
            )}
          </div>
        </div>

        {isCrypto && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={labelSt}>Wybierz kryptowalutę</label>
              <select style={baseInp} value={form.cryptoId}
                onChange={e => setForm(f => ({ ...f, cryptoId: e.target.value }))}
                onFocus={focusInp} onBlur={blurInp}>
                <option value="" style={{ background: "#1a2535", color: "#4a5a6e" }}>-- wybierz --</option>
                {CRYPTO_LIST.map(c => (
                  <option key={c.id} value={c.id} style={{ background: "#1a2535", color: "#e8f0f8" }}>{c.label}</option>
                ))}
                <option value="other" style={{ background: "#1a2535", color: "#e8f0f8" }}>Inne (wpisz ręcznie)</option>
              </select>
            </div>

            {isCustomCrypto && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>ID z CoinGecko (np. "bitcoin")</label>
                <input style={baseInp} placeholder="np. bitcoin, ethereum, solana..."
                  value={form.cryptoIdCustom || ""}
                  onChange={e => setForm(f => ({ ...f, cryptoIdCustom: e.target.value }))}
                  onFocus={focusInp} onBlur={blurInp} />
                <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>Sprawdź ID na coingecko.com/pl</div>
              </div>
            )}

            {form.cryptoId && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={labelSt}>Ilość jednostek</label>
                  <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" placeholder="0.00314"
                    value={form.cryptoAmount}
                    onChange={e => setForm(f => ({ ...f, cryptoAmount: e.target.value }))}
                    onFocus={focusInp} onBlur={blurInp} />
                </div>
                <div>
                  <label style={labelSt}>Zapłacono łącznie (PLN)</label>
                  <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" placeholder="1000"
                    value={form.cryptoPaid}
                    onChange={e => setForm(f => ({ ...f, cryptoPaid: e.target.value }))}
                    onFocus={focusInp} onBlur={blurInp}
                    onKeyDown={e => e.key === "Enter" && submit()} />
                </div>
              </div>
            )}
          </>
        )}

        {!isCrypto && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelSt}>Wartość (PLN)</label>
              <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" placeholder="0"
                value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                onFocus={focusInp} onBlur={blurInp}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            <div>
              <label style={labelSt}>Notatka</label>
              <input style={baseInp} placeholder="np. 6.95%, data zakupu..."
                value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                onFocus={focusInp} onBlur={blurInp} />
            </div>
          </div>
        )}

        {isCrypto && form.cryptoId && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Notatka (opcjonalnie)</label>
            <input style={baseInp} placeholder="np. giełda Binance, data zakupu..."
              value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              onFocus={focusInp} onBlur={blurInp} />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
            onClick={submit} style={neonBtnStyle(hovSave)}>
            {isEdit ? "Zapisz zmiany" : "Dodaj do portfela"}
          </button>
          {isEdit && (
            <button onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              onClick={() => { onDelete(asset.id); onClose(); }} style={redBtnStyle(hovDel)}>Usuń</button>
          )}
          <button onMouseEnter={() => setHovCancel(true)} onMouseLeave={() => setHovCancel(false)}
            onClick={onClose} style={redBtnStyle(hovCancel)}>Anuluj</button>
        </div>
      </div>
    </div>
  );
}

function AssetRow({ asset, total, categories, prices, onClick }) {
  const color = catColor(categories, asset.category);
  const [hov, setHov] = useState(false);

  let displayValue = asset.value;
  let pnlAmt = null;
  let pnlPct = null;
  let change24h = null;
  let cryptoPrice = null;

  let isCryptoStale = false;
  if (asset.cryptoId && asset.cryptoId !== "other" && prices[asset.cryptoId]) {
    const priceData = prices[asset.cryptoId];
    cryptoPrice = priceData.pln;
    displayValue = asset.cryptoAmount * cryptoPrice;
    change24h = priceData.pln_24h_change;
    isCryptoStale = !!priceData.stale;
    if (asset.cryptoPaid && asset.cryptoPaid > 0) {
      pnlAmt = displayValue - asset.cryptoPaid;
      pnlPct = (pnlAmt / asset.cryptoPaid) * 100;
    }
  } else if (asset.purchaseAmount && asset.purchaseAmount > 0) {
    pnlAmt = displayValue - asset.purchaseAmount;
    pnlPct = (pnlAmt / asset.purchaseAmount) * 100;
  }

  const hasSubline = asset.cryptoAmount || pnlAmt !== null || change24h !== null;

  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8,
        border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s"
      }}>
      <div style={{ width: 4, borderRadius: 2, background: color, flexShrink: 0, alignSelf: "stretch" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#e8f0f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            {asset.name}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8", flexShrink: 0 }}>
            {isCryptoStale ? "~" : ""}{fmt(displayValue)}
          </div>
        </div>
        {hasSubline && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 11, color: "#4a5a6e", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {asset.cryptoAmount
                ? `${fmtSmall(asset.cryptoAmount)} ${CRYPTO_LIST.find(c => c.id === asset.cryptoId)?.label.split(" ")[0] || ""}${cryptoPrice ? ` @ ${fmt(cryptoPrice)}` : ""}`
                : asset.note || asset.category}
            </div>
            {pnlAmt !== null ? (
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: "nowrap", color: pnlAmt >= 0 ? "#00c896" : "#f05060" }}>
                {pnlAmt >= 0 ? "+" : ""}{fmt(pnlAmt)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
              </div>
            ) : change24h !== null ? (
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: "nowrap", color: change24h >= 0 ? "#00c896" : "#f05060" }}>
                {change24h >= 0 ? "▲" : "▼"} {Math.abs(change24h).toFixed(2)}% dziś
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function WelcomeScreen({ onStart }) {
  const [hov, setHov] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "24px 16px" }}>
      <div style={{ fontSize: 11, letterSpacing: ".18em", color: "#4a5a6e", fontFamily: "'DM Mono', monospace", marginBottom: 36 }}>PORTFOLIO TRACKER</div>
      <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 16, padding: "40px 32px", width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>📊</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: "#e8f0f8", marginBottom: 10 }}>Twój prywatny tracker inwestycji</div>
        <div style={{ fontSize: 14, color: "#8a9bb0", lineHeight: 1.6, marginBottom: 28 }}>
          Śledź wszystkie swoje aktywa w jednym miejscu — konta, obligacje, ETF-y, krypto i więcej.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28, textAlign: "left" }}>
          {[
            ["Dodaj aktywa", "wpisz nazwę, kategorię i aktualną wartość"],
            ["Obserwuj wykres", "kółko pokazuje podział twojego portfela"],
            ["Aktualizuj wartości", "kliknij dowolne aktywo żeby je edytować"],
          ].map(([title, desc], i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#00c89620", border: "1px solid #00c89660", color: "#00c896", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
              <div style={{ fontSize: 13, color: "#8a9bb0", lineHeight: 1.5 }}>
                <span style={{ color: "#e8f0f8", fontWeight: 500 }}>{title}</span> — {desc}
              </div>
            </div>
          ))}
        </div>
        <button onClick={onStart}
          onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
          style={{
            width: "100%", padding: 14, borderRadius: 12, border: "2px solid #00c896",
            background: hov ? "#00c89612" : "transparent", color: "#00c896",
            fontWeight: 700, fontSize: 15, cursor: "pointer", letterSpacing: ".04em",
            fontFamily: "'Sora', sans-serif",
            textShadow: "0 0 8px #00c896, 0 0 20px #00c89680",
            boxShadow: hov
              ? "0 0 16px #00c896, 0 0 40px #00c89660, inset 0 0 16px #00c89620"
              : "0 0 10px #00c89640, 0 0 30px #00c89620, inset 0 0 10px #00c89610",
            transition: "all .2s"
          }}>
          Zacznij budować portfel →
        </button>
        <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 12 }}>Dane zapisują się lokalnie w twojej przeglądarce</div>
      </div>
    </div>
  );
}

// ─── Modal wyboru typu aktywa ─────────────────────────────────────────────────
function AssetTypeSelectorModal({ onClose, onSelect }) {
  const [hovClose, setHovClose] = useState(false);
  const TYPES = [
    { id: "Waluty / Gotówka" },
    { id: "Konto osobiste" },
    { id: "Konto oszczędnościowe" },
    { id: "Lokata" },
    { id: "Obligacje" },
    { id: "PPK" },
    { id: "Akcje / ETF" },
    { id: "Surowce" },
    { id: "Krypto" },
    { id: "Nieruchomości" },
    { id: "Inne" },
  ];

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: "24px 20px", width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f0f8" }}>Jaką kategorię aktywa chcesz dodać?</div>
          <button onClick={onClose} onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {TYPES.map(t => {
            const [hov, setHov] = useState(false);
            return (
              <div key={t.id} onClick={() => onSelect(t.id)}
                onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                  background: hov ? "#111720" : "#1a2535", borderRadius: 12, cursor: "pointer",
                  border: `1px solid ${hov ? "#00c89650" : "#243040"}`, transition: "all .15s"
                }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: hov ? "#00c896" : "#e8f0f8" }}>{t.id}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MoveAssetModal({ asset, portfolios, onClose, onConfirm }) {
  const [selected, setSelected] = useState(asset?.portfolioId || (portfolios[0] && portfolios[0].id) || "default");
  if (!asset) return null;
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{position:"fixed",inset:0,background:"#000a",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000,padding:16}}>
      <div style={{background:"#161d28",padding:24,borderRadius:16,border:"1px solid #2a3a50",width:"100%",maxWidth:360}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700,color:"#e8f0f8"}}>Przenieś do portfela</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"#5a6a7e",cursor:"pointer",fontSize:18}}>×</button>
        </div>
        <div style={{fontSize:13,color:"#8a9bb0",marginBottom:16}}>Wybierz nowy portfel docelowy:</div>
        <select value={selected} onChange={e=>setSelected(e.target.value)}
          style={{width:"100%",padding:"12px 14px",background:"#1a2535",border:"1px solid #243040",color:"#e8f0f8",borderRadius:10,marginBottom:24,fontSize:14,outline:"none",fontFamily:"'Sora', sans-serif"}}>
          {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{display:"flex",gap:12}}>
          <button onClick={onClose} style={{flex:1,padding:"10px 12px",background:"#1a2535",border:"1px solid #2a3a50",color:"#e8f0f8",fontWeight:600,borderRadius:10,cursor:"pointer",fontFamily:"'Sora', sans-serif"}}>Anuluj</button>
          <button onClick={()=>{ onConfirm(asset.id, selected); onClose(); }} style={{flex:1,padding:"10px 12px",background:"#00c896",border:"none",color:"#000",fontWeight:700,borderRadius:10,cursor:"pointer",fontFamily:"'Sora', sans-serif"}}>Zatwierdź</button>
        </div>
      </div>
    </div>
  )
}

// ─── Historia wartości portfela ───────────────────────────────────────────────
function saveSnapshot(history, total, assetsWithLivePrices, categories) {
  const today = new Date().toISOString().slice(0, 10);
  if (history.length > 0 && history[history.length - 1].date === today) return history;
  const byCategory = {};
  categories.forEach(c => {
    const val = assetsWithLivePrices.filter(a => a.category === c.name).reduce((s, a) => s + a.value, 0);
    if (val > 0) byCategory[c.name] = Math.round(val * 100) / 100;
  });
  const next = [...history, { date: today, total: Math.round(total * 100) / 100, byCategory }];
  while (next.length > 365) next.shift();
  try { localStorage.setItem("pt-history", JSON.stringify(next)); } catch {}
  return next;
}

function HistoryChart({ history }) {
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const values = history.map(e => e.total);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;
    const pad = { top: 20, right: 16, bottom: 32, left: 64 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    const xOf = i => pad.left + (i / (history.length - 1)) * chartW;
    const yOf = v => pad.top + (1 - (v - minV) / range) * chartH;

    ctx.clearRect(0, 0, W, H);

    // Poziome linie siatki
    ctx.strokeStyle = "#1e2a38";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = "#4a5a6e";
      ctx.font = `11px 'DM Mono', monospace`;
      ctx.textAlign = "right";
      ctx.fillText(fmtK(maxV - (i / 4) * range), pad.left - 6, y + 4);
    }

    // Wypełnienie gradientem
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, "rgba(0,200,150,0.25)");
    grad.addColorStop(1, "rgba(0,200,150,0)");
    ctx.beginPath();
    history.forEach((e, i) => {
      i === 0 ? ctx.moveTo(xOf(i), yOf(e.total)) : ctx.lineTo(xOf(i), yOf(e.total));
    });
    ctx.lineTo(xOf(history.length - 1), pad.top + chartH);
    ctx.lineTo(xOf(0), pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Linia
    ctx.beginPath();
    history.forEach((e, i) => {
      i === 0 ? ctx.moveTo(xOf(i), yOf(e.total)) : ctx.lineTo(xOf(i), yOf(e.total));
    });
    ctx.strokeStyle = "#00c896";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Etykiety osi X (max 6)
    const labelCount = Math.min(6, history.length);
    ctx.fillStyle = "#4a5a6e";
    ctx.font = `10px 'DM Mono', monospace`;
    ctx.textAlign = "center";
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.round((i / (labelCount - 1)) * (history.length - 1));
      ctx.fillText(history[idx].date.slice(5), xOf(idx), H - pad.bottom + 16);
    }

    // Kropka tooltipa
    if (tooltip !== null && tooltip >= 0 && tooltip < history.length) {
      const x = xOf(tooltip), y = yOf(history[tooltip].total);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "#00c896"; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = "#0a0e14"; ctx.fill();
    }
  }, [history, tooltip]);

  function handleMouseMove(e) {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = canvas.offsetWidth;
    const pad = { left: 64, right: 16 };
    const frac = (x - pad.left) / (W - pad.left - pad.right);
    const idx = Math.round(frac * (history.length - 1));
    setTooltip(idx >= 0 && idx < history.length ? idx : null);
  }

  const active = tooltip !== null ? history[tooltip] : null;

  return (
    <div style={{ position: "relative" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: 200, display: "block" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)} />
      {active && (
        <div style={{
          position: "absolute", top: 8, left: 74, background: "#1a2535",
          border: "1px solid #2a3a50", borderRadius: 8, padding: "6px 12px",
          pointerEvents: "none", fontSize: 12, lineHeight: 1.6,
        }}>
          <div style={{ color: "#5a6a7e", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{active.date}</div>
          <div style={{ color: "#00c896", fontWeight: 600 }}>{fmt(active.total)}</div>
        </div>
      )}
    </div>
  );
}

function HistoryView({ history }) {
  if (history.length === 0) {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "60px 16px 32px", textAlign: "center", color: "#5a6a7e" }}>
        <div style={{ fontSize: 13 }}>Brak danych historycznych</div>
        <div style={{ fontSize: 12, marginTop: 8, color: "#3a4a5e" }}>Snapshoty są tworzone automatycznie raz dziennie przy starcie aplikacji.</div>
      </div>
    );
  }

  const today = history[history.length - 1];
  const monthAgo = history.length >= 30 ? history[history.length - 30] : history[0];
  const diff = today.total - monthAgo.total;
  const diffPct = monthAgo.total > 0 ? (diff / monthAgo.total) * 100 : 0;
  const isPos = diff >= 0;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px 32px" }}>
      <div style={{ fontSize: 13, color: "#5a6a7e", marginBottom: 20 }}>
        Wartość portfela w czasie ({history.length} {history.length === 1 ? "dzień" : "dni"})
      </div>

      <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 16, padding: "20px 16px", marginBottom: 16 }}>
        <HistoryChart history={history} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 12, padding: "16px 14px" }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", marginBottom: 6, fontFamily: "'DM Mono', monospace" }}>DZIŚ</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmt(today.total)}</div>
        </div>
        <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 12, padding: "16px 14px" }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", marginBottom: 6, fontFamily: "'DM Mono', monospace" }}>MIESIĄC TEMU</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmt(monthAgo.total)}</div>
          {history.length < 30 && <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 4 }}>({monthAgo.date})</div>}
        </div>
        <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 12, padding: "16px 14px" }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", marginBottom: 6, fontFamily: "'DM Mono', monospace" }}>ZMIANA</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: isPos ? "#00c896" : "#f05060", fontFamily: "'DM Mono', monospace" }}>
            {isPos ? "+" : ""}{diffPct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 11, color: isPos ? "#00c896" : "#f05060", marginTop: 2 }}>
            {isPos ? "+" : ""}{fmt(diff)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error("ErrorBoundary:", err, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 12, padding: 24, textAlign: "center", color: "#8a9bb0", margin: "16px 0" }}>
          <div style={{ fontSize: 13, marginBottom: 12 }}>Nie udało się załadować tej sekcji</div>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{ padding: "6px 16px", borderRadius: 8, background: "#1e2a38", border: "1px solid #2a3a50", color: "#e8f0f8", cursor: "pointer", fontSize: 12, fontFamily: "'Sora', sans-serif" }}>
            Spróbuj ponownie
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Wersja schematu localStorage ────────────────────────────────────────────
const SCHEMA_VERSION = 2;

function migrateData(oldVersion) {
  // v0 → v1: brak migracji danych, tylko zapis wersji
  if (oldVersion < 2) {
    try { if (!localStorage.getItem("pt-history")) localStorage.setItem("pt-history", "[]"); } catch {}
  }
  try { localStorage.setItem("pt-schema-version", String(SCHEMA_VERSION)); } catch {}
}

// ─── Główna aplikacja ─────────────────────────────────────────────────────────
export default function App() {
  const [welcomed, setWelcomed] = useState(() => {
    try { return localStorage.getItem("pt-welcomed") === "1"; } catch { return false; }
  });
  const [portfolios, setPortfolios] = useState(() => {
    try { 
      const s = localStorage.getItem("pt-portfolios"); 
      return s ? JSON.parse(s) : [{ id: "default", name: "Portfel 1" }]; 
    } catch { return [{ id: "default", name: "Portfel 1" }]; }
  });
  const [activePortfolioId, setActivePortfolioId] = useState(() => {
    try { return localStorage.getItem("pt-active-portfolio") || "default"; } catch { return "default"; }
  });
  const [allAssets, setAllAssets] = useState(() => {
    try { 
      const s = localStorage.getItem("pt-assets"); 
      const arr = s ? JSON.parse(s) : []; 
      return arr.map(a => a.portfolioId ? a : { ...a, portfolioId: "default" });
    } catch { return []; }
  });
  const assets = allAssets.filter(a => a.portfolioId === activePortfolioId);

  const [categories, setCategories] = useState(() => {
    try {
      const s = localStorage.getItem("pt-categories");
      if (!s) return DEFAULT_CATEGORIES;
      const stored = JSON.parse(s);
      
      const mapped = stored.map(c => {
        const def = DEFAULT_CATEGORIES.find(d => d.name === c.name);
        return def ? def : c;
      });
      
      DEFAULT_CATEGORIES.forEach(def => {
        if (!mapped.find(m => m.name === def.name)) {
          mapped.push(def);
        }
      });
      
      return mapped;
    } catch {
      return DEFAULT_CATEGORIES;
    }
  });
  const [activeFilter, setActiveFilter] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [modal, setModal] = useState(null);
  const [bondModal, setBondModal] = useState(null);
  const [bondDetail, setBondDetail] = useState(null);
  const [stockModal, setStockModal] = useState(null);
  const [stockDetail, setStockDetail] = useState(null);
  const [commodityModal, setCommodityModal] = useState(null);
  const [commodityDetail, setCommodityDetail] = useState(null);
  const [currencyModal, setCurrencyModal] = useState(null);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [movingAsset, setMovingAsset] = useState(null);
  const [hovAdd, setHovAdd] = useState(false);
  const [currentView, setCurrentView] = useState("portfolio");

  // ── Stany kont oszczędnościowych ──
  const [selectedSavings, setSelectedSavings] = useState(null);
  const [showSavingsForm, setShowSavingsForm] = useState(false);
  const [editingSavings, setEditingSavings] = useState(null);
  const [offersPage, setOffersPage] = useState(1);
  const [expandedOffer, setExpandedOffer] = useState(null);

  const { prices, lastUpdated } = useCryptoPrices(assets);
  const { stockPrices, stockLastUpdated, refetchStocks } = useStockPrices(assets);
  const { commodityPrices, commodityLastUpdated } = useCommodityPrices(assets);
  const { rates, lastUpdated: currencyLastUpdated } = useCurrencyRates(assets);

  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pt-history") || "[]"); } catch { return []; }
  });
  const snapshotTakenRef = useRef(false);

  const [editingPortfolio, setEditingPortfolio] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");

  // Aktualizuj wartości live (krypto, akcje, surowce, konta oszczędnościowe, waluty)
  const assetsWithLivePrices = assets.map(a => {
    if (a.isBond) {
      return { ...a, value: calcBondCurrentValue(a).currentValue };
    }
    if (a.isSavings) {
      return { ...a, value: getSavingsValue(a) };
    }
    if (a.isStock && a.stockSymbol) {
      if (stockPrices[a.stockSymbol]) return { ...a, value: a.stockQuantity * stockPrices[a.stockSymbol].pricePLN };
    }
    if (a.isCommodity && a.commoditySymbol) {
      return { ...a, value: calcCommodityValue(a, commodityPrices) };
    }
    if (a.cryptoId && a.cryptoId !== "other" && prices[a.cryptoId]) {
      return { ...a, value: a.cryptoAmount * prices[a.cryptoId].pln };
    }
    if (a.isCurrency && a.currencyCode && rates[a.currencyCode]) {
      return { ...a, value: a.currencyAmount * rates[a.currencyCode] };
    }
    return a;
  });

  useEffect(() => {
    try {
      const stored = parseInt(localStorage.getItem("pt-schema-version") || "0", 10);
      if (stored < SCHEMA_VERSION) migrateData(stored);
    } catch {}
  }, []); // eslint-disable-line

  useEffect(() => { try { localStorage.setItem("pt-portfolios", JSON.stringify(portfolios)); } catch {} }, [portfolios]);
  useEffect(() => { try { localStorage.setItem("pt-active-portfolio", activePortfolioId); } catch {} }, [activePortfolioId]);
  useEffect(() => { try { localStorage.setItem("pt-assets", JSON.stringify(allAssets)); } catch {} }, [allAssets]);
  useEffect(() => { try { localStorage.setItem("pt-categories", JSON.stringify(categories)); } catch {} }, [categories]);

  function handleStart() {
    try { localStorage.setItem("pt-welcomed", "1"); } catch {}
    setWelcomed(true);
  }

  function handleFilterChange(cat) {
    setHovered(null);
    setActiveFilter(cat);
  }

  function handleSave(asset) {
    if (!categories.find(c => c.name === asset.category)) {
      const hue = Math.floor(Math.random() * 360);
      setCategories(cs => [...cs, { name: asset.category, color: `hsl(${hue},65%,58%)` }]);
    }
    const assetToSave = { ...asset, portfolioId: asset.portfolioId || activePortfolioId };
    setAllAssets(all => {
      const exists = all.find(a => a.id === assetToSave.id);
      return exists ? all.map(a => a.id === assetToSave.id ? assetToSave : a) : [...all, assetToSave];
    });
  }

  function handleDelete(id) {
    setAllAssets(all => all.filter(a => a.id !== id));
  }

  function handleMoveAsset(id, newPortfolioId) {
    setAllAssets(all => all.map(a => a.id === id ? { ...a, portfolioId: newPortfolioId } : a));
    // Jeśli zamykamy panel po przeniesieniu:
    setBondDetail(null);
    setStockDetail(null);
    setCommodityDetail(null);
    setEditingSavings(null);
  }

  // ── Zapis konta oszczędnościowego ──
  function handleSaveSavings(account) {
    if (!categories.find(c => c.name === "Konto oszczędnościowe")) {
      setCategories(cs => [...cs, { name: "Konto oszczędnościowe", color: "#00c896" }]);
    }
    const withValue = { ...account, value: getSavingsValue(account), portfolioId: account.portfolioId || activePortfolioId };
    setAllAssets(all => {
      const exists = all.find(a => a.id === withValue.id);
      return exists ? all.map(a => a.id === withValue.id ? withValue : a) : [...all, withValue];
    });
    if (selectedSavings && selectedSavings.id === withValue.id) {
      setSelectedSavings(withValue);
    }
  }

  function handleDeleteSavings(id) {
    setAllAssets(all => all.filter(a => a.id !== id));
    setSelectedSavings(null);
  }

  function handleAddPortfolio() {
    const name = window.prompt("Nazwa nowego portfela:", "Mój nowy portfel");
    if (!name || !name.trim()) return;
    const newId = "portfel_" + Date.now();
    setPortfolios(prev => [...prev, { id: newId, name: name.trim() }]);
    setActivePortfolioId(newId);
  }

  function handleDeletePortfolio(id) {
    if (portfolios.length <= 1) {
      alert("Nie możesz usunąć jedynego portfela!");
      return;
    }
    const port = portfolios.find(p => p.id === id);
    if (!window.confirm(`Czy na pewno chcesz usunąć '${port?.name}'? Wszystkie aktywa w tym portfelu zostaną trwale usunięte.`)) return;
    
    setAllAssets(all => all.filter(a => a.portfolioId !== id));
    const nextList = portfolios.filter(p => p.id !== id);
    setPortfolios(nextList);
    if (activePortfolioId === id) {
      setActivePortfolioId(nextList[0].id);
    }
    setEditingPortfolio(false);
  }

  function handleRenamePortfolio() {
    if (!newPortfolioName.trim()) return;
    setPortfolios(prev => prev.map(p => p.id === activePortfolioId ? { ...p, name: newPortfolioName.trim() } : p));
    setEditingPortfolio(false);
  }

  const total = assetsWithLivePrices.reduce((s, a) => s + a.value, 0);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (snapshotTakenRef.current || total <= 0) return;
    snapshotTakenRef.current = true;
    setHistory(h => saveSnapshot(h, total, assetsWithLivePrices, categories));
  }, [total]); // eslint-disable-line

  const visible = activeFilter ? assetsWithLivePrices.filter(a => a.category === activeFilter) : assetsWithLivePrices;
  const usedCats = categories.filter(c => assetsWithLivePrices.some(a => a.category === c.name));

  const allUpdates = [stockLastUpdated, lastUpdated, commodityLastUpdated, currencyLastUpdated].filter(Boolean);
  const anyLastUpdated = allUpdates.length > 0 ? allUpdates.reduce((a, b) => a > b ? a : b) : null;

  const viewTitles = {
    portfolio: "PORTFOLIO TRACKER",
    bonds: "← PORTFOLIO TRACKER",
    savings: "← PORTFOLIO TRACKER",
  };

  const globalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@400;500;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body { background: #0a0e14; font-family: 'Sora', sans-serif; min-height: 100vh; color: #e8f0f8; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    input, textarea, select { user-select: auto; -webkit-user-select: auto; }
    input[type=number]::-webkit-inner-spin-button,
    input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
      -webkit-box-shadow: 0 0 0 100px #1a2535 inset !important;
      -webkit-text-fill-color: #e8f0f8 !important;
    }
    select option { background: #1a2535; color: #e8f0f8; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #0a0e14; }
    ::-webkit-scrollbar-thumb { background: #1e2a38; border-radius: 3px; }
    @media (max-width: 500px) {
      #main-container { padding: 16px 12px !important; }
      .chip-btn { padding: 5px 10px !important; font-size: 11px !important; }
      #add-btns { flex-direction: column !important; }
      #add-btns button { width: 100% !important; }
    }
  `;

  if (!welcomed) return (
    <>
      <style>{globalStyles}</style>
      <WelcomeScreen onStart={handleStart} />
    </>
  );

  return (
    <>
      <style>{globalStyles}</style>
      <div id="main-container" style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>

        {/* Nagłówek */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: "#4a5a6e", fontFamily: "'DM Mono', monospace", textAlign: "center", flex: 1 }}>
            {currentView !== "portfolio" ? (
              <button onClick={() => setCurrentView("portfolio")}
                style={{ background: "none", border: "none", color: "#5a6a7e", cursor: "pointer", fontSize: 11, letterSpacing: ".1em", fontFamily: "'DM Mono', monospace", display: "flex", alignItems: "center", gap: 6, margin: "0 auto" }}>
                ← PORTFOLIO TRACKER
              </button>
            ) : "PORTFOLIO TRACKER"}
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <MenuDropdown onNavigate={id => {
              setCurrentView(id);
            }} />
          </div>
        </div>

        {/* ── Widok kont oszczędnościowych ── */}
        {currentView === "savings" && (() => {
          const sortedOffers = [...SAVINGS_RATES_DB.accounts].sort((a, b) => {
            const rateA = a.ratePromo ?? a.rateStandard;
            const rateB = b.ratePromo ?? b.rateStandard;
            return rateB - rateA;
          });
          const PAGE_SIZE = 8;
          const visibleOffers = sortedOffers.slice(0, offersPage * PAGE_SIZE);
          const hasMore = visibleOffers.length < sortedOffers.length;
          const fmt = v => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(v);

          return (
            <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px 32px" }}>
              {/* Twoje konta */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 13, color: "#5a6a7e" }}>Twoje konta oszczędnościowe w tym portfelu</div>
                <button onClick={() => setShowSavingsForm(true)}
                  style={{ padding: "8px 16px", borderRadius: 8, background: "#00c896", color: "#000", fontWeight: 700, fontSize: 12, border: "none", cursor: "pointer", fontFamily: "'Sora',sans-serif" }}>
                  + Dodaj konto
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {assetsWithLivePrices.filter(a => a.isSavings).map(account => (
                  <div key={account.id}
                    onClick={() => setSelectedSavings(account)}
                    style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 14, padding: "16px", cursor: "pointer", transition: "all .15s" }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#00c896", marginBottom: 4, fontFamily: "'DM Mono',monospace" }}>{account.savingsBankName}</div>
                    <div style={{ fontSize: 12, color: "#8a9bb0", display: "flex", justifyContent: "space-between" }}>
                      <span>Saldo: {new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN",maximumFractionDigits:0}).format(account.savingsBalance)}</span>
                      <span style={{ color: "#e8f0f8" }}>{account.savingsRate}%</span>
                    </div>
                  </div>
                ))}
                {assetsWithLivePrices.filter(a => a.isSavings).length === 0 && (
                  <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "40px 0", color: "#5a6a7e", fontSize: 13, background: "#161d28", borderRadius: 12, border: "2px dashed #2a3a50" }}>
                    Brak zapisanych kont oszczędnościowych. Kliknij "Dodaj konto" aby rozpocząć.
                  </div>
                )}
              </div>

              {/* Oferty kont oszczędnościowych */}
              <div style={{ marginTop: 36 }}>
                {(() => {
                  const [year, month] = SAVINGS_RATES_DB.lastUpdated.split('-').map(Number);
                  const dataDate = new Date(year, month - 1, 1);
                  const now = new Date();
                  const diffDays = Math.floor((now - dataDate) / (1000 * 60 * 60 * 24));
                  const isStale = diffDays > 45;
                  return isStale ? (
                    <div style={{ background: "#2a1a00", border: "1px solid #5a3a00", borderRadius: 8, padding: "8px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#f0a030" }}>
                      <span>⚠</span>
                      <span>Dane mogą być nieaktualne (ostatnia aktualizacja: {SAVINGS_RATES_DB.lastUpdated}). Zawsze weryfikuj na stronie banku.</span>
                    </div>
                  ) : null;
                })()}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf3", letterSpacing: ".05em" }}>
                    Najlepsze oferty kont oszczędnościowych
                  </div>
                  <div style={{ fontSize: 11, color: "#4a5a6e", fontFamily: "'DM Mono',monospace" }}>
                    aktualizacja: {SAVINGS_RATES_DB.lastUpdated}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {visibleOffers.map((offer, i) => {
                    const bestRate = offer.ratePromo ?? offer.rateStandard;
                    const isPromo = offer.ratePromo != null;
                    return (
                      <div key={i}
                        onClick={() => setExpandedOffer(offer)}
                        style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "border-color .15s" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "#2a4060"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "#1e2a38"}>
                        {/* Rank */}
                        <div style={{ minWidth: 24, fontSize: 11, color: "#4a5a6e", fontFamily: "'DM Mono',monospace", textAlign: "right" }}>
                          {i + 1}.
                        </div>
                        {/* Rate badge */}
                        <div style={{ minWidth: 54, textAlign: "center" }}>
                          <div style={{ fontSize: 17, fontWeight: 700, color: isPromo ? "#00c896" : "#6bcfae", fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
                            {bestRate.toFixed(1)}%
                          </div>
                          {isPromo && (
                            <div style={{ fontSize: 9, color: "#4a5a6e", marginTop: 2, fontFamily: "'DM Mono',monospace" }}>
                              promo
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8edf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {offer.bank}
                          </div>
                          <div style={{ fontSize: 11, color: "#6b7f96", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {offer.name}
                          </div>
                        </div>
                        {/* Details */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, minWidth: 100 }}>
                          {offer.promoLimit != null && (
                            <div style={{ fontSize: 10, color: "#8a9bb0", fontFamily: "'DM Mono',monospace" }}>
                              do {fmt(offer.promoLimit)}
                            </div>
                          )}
                          {offer.promoDays != null && (
                            <div style={{ fontSize: 10, color: "#8a9bb0", fontFamily: "'DM Mono',monospace" }}>
                              przez {offer.promoDays} dni
                            </div>
                          )}
                          {isPromo && (
                            <div style={{ fontSize: 10, color: "#4a5a6e", fontFamily: "'DM Mono',monospace" }}>
                              std: {offer.rateStandard}%
                            </div>
                          )}
                        </div>
                        {/* ROR badge */}
                        {offer.requiresROR && (
                          <div style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#1e2a38", color: "#6b7f96", fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap" }}>
                            wymaga ROR
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: "#3a4a5e" }}>›</div>
                      </div>
                    );
                  })}
                </div>

                {/* Popup szczegółów oferty */}
                {expandedOffer && (() => {
                  const o = expandedOffer;
                  const bestRate = o.ratePromo ?? o.rateStandard;
                  const isPromo = o.ratePromo != null;
                  return (
                    <div onClick={() => setExpandedOffer(null)}
                      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                      <div onClick={e => e.stopPropagation()}
                        style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: "28px 24px", maxWidth: 480, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
                        {/* Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: "#e8edf3" }}>{o.bank}</div>
                            <div style={{ fontSize: 12, color: "#6b7f96", marginTop: 4 }}>{o.name}</div>
                          </div>
                          <button onClick={() => setExpandedOffer(null)}
                            style={{ background: "none", border: "none", color: "#6b7f96", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>
                            ×
                          </button>
                        </div>

                        {/* Oprocentowanie */}
                        <div style={{ background: "#0d131c", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 32, fontWeight: 700, color: isPromo ? "#00c896" : "#6bcfae", fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
                              {bestRate.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 4 }}>
                              {isPromo ? "oprocentowanie promo" : "oprocentowanie"}
                            </div>
                          </div>
                          {isPromo && (
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 20, fontWeight: 600, color: "#4a5a6e", fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
                                {o.rateStandard}%
                              </div>
                              <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 4 }}>po promocji</div>
                            </div>
                          )}
                          {o.promoDays != null && (
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 20, fontWeight: 600, color: "#e8edf3", fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
                                {o.promoDays}
                              </div>
                              <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 4 }}>dni promocji</div>
                            </div>
                          )}
                          {o.promoLimit != null && (
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: "#e8edf3", fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
                                {fmt(o.promoLimit)}
                              </div>
                              <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 4 }}>limit środków</div>
                            </div>
                          )}
                        </div>

                        {/* Warunki */}
                        {o.promoConditionsList && o.promoConditionsList.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#8a9bb0", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>
                              Warunki oferty
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {o.promoConditionsList.map((cond, ci) => (
                                <div key={ci} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                  <div style={{ minWidth: 16, height: 16, borderRadius: "50%", background: "#0d3a28", border: "1px solid #00c896", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00c896" }} />
                                  </div>
                                  <div style={{ fontSize: 13, color: "#c8d8e8", lineHeight: 1.5 }}>{cond}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Badges */}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                          {o.requiresROR && (
                            <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "#1e2a38", color: "#8a9bb0", border: "1px solid #2a3a50" }}>
                              Wymaga konta osobistego (ROR)
                            </div>
                          )}
                          {!o.requiresROR && (
                            <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "#0d3a28", color: "#00c896", border: "1px solid #1a5a40" }}>
                              Bez konta osobistego
                            </div>
                          )}
                          {isPromo && (
                            <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "#1e2a38", color: "#f0a030", border: "1px solid #3a3010" }}>
                              Oferta promocyjna
                            </div>
                          )}
                        </div>

                        {/* Link do oferty */}
                        {o.url && (
                          <a href={o.url} target="_blank" rel="noopener noreferrer"
                            style={{ display: "block", textAlign: "center", padding: "12px", borderRadius: 10, background: "#00c896", color: "#000", fontWeight: 700, fontSize: 13, textDecoration: "none", fontFamily: "'Sora',sans-serif" }}>
                            Przejdź do oferty →
                          </a>
                        )}

                        <div style={{ fontSize: 10, color: "#3a4a5e", textAlign: "center", marginTop: 12 }}>
                          Dane orientacyjne · aktualizacja {SAVINGS_RATES_DB.lastUpdated} · zawsze weryfikuj na stronie banku
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Pagination */}
                <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 14 }}>
                  {hasMore && (
                    <button onClick={() => setOffersPage(p => p + 1)}
                      style={{ padding: "8px 20px", borderRadius: 8, background: "#1e2a38", color: "#8a9bb0", fontSize: 12, border: "1px solid #2a3a50", cursor: "pointer", fontFamily: "'Sora',sans-serif" }}>
                      Pokaż więcej ({sortedOffers.length - visibleOffers.length} kolejnych)
                    </button>
                  )}
                  {offersPage > 1 && (
                    <button onClick={() => setOffersPage(1)}
                      style={{ padding: "8px 20px", borderRadius: 8, background: "none", color: "#4a5a6e", fontSize: 12, border: "1px solid #1e2a38", cursor: "pointer", fontFamily: "'Sora',sans-serif" }}>
                      Zwiń listę
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Widok historii ── */}
        {currentView === "history" && <HistoryView history={history} />}

        {/* ── Widok rynku ── */}
        {currentView === "market" && <MarketView />}

        {/* ── Widok obligacji ── */}
        {currentView === "bonds" && <ErrorBoundary key="bonds-view"><BondRatesView /></ErrorBoundary>}

        {/* ── Widok portfolio ── */}
        {currentView === "portfolio" && (
          <>
            {/* Zakładki portfeli */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, paddingLeft: 0, marginBottom: -1 }}>
              {portfolios.map(p => {
                const isActive = p.id === activePortfolioId;
                return (
                  <button key={p.id}
                    onClick={() => {
                      if (isActive) {
                        setEditingPortfolio(!editingPortfolio);
                        setNewPortfolioName(p.name);
                      } else {
                        setActivePortfolioId(p.id);
                        setEditingPortfolio(false);
                        setActiveFilter(null);
                        setHovered(null);
                      }
                    }}
                    style={{
                      height: 40, padding: "0 16px", 
                      background: isActive ? "#161d28" : "#0d131c",
                      border: "1px solid #1e2a38", 
                      borderBottom: isActive ? "1px solid #161d28" : "1px solid #1e2a38",
                      borderRadius: "12px 12px 0 0", color: isActive ? "#e8f0f8" : "#5a6a7e",
                      fontWeight: isActive ? 600 : 500, fontSize: 13, cursor: "pointer",
                      fontFamily: "'Sora', sans-serif", zIndex: isActive ? 2 : 1,
                      position: "relative", transition: "background .15s",
                      minWidth: 100, display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                    {p.name}
                  </button>
                );
              })}
              <button 
                onClick={handleAddPortfolio}
                style={{
                  height: 40, padding: "0 16px", background: "#0d131c", 
                  border: "1px solid #1e2a38", borderBottom: "1px solid #1e2a38",
                  borderRadius: "12px 12px 0 0", color: "#8a9bb0", fontSize: 18,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "color .15s", position: "relative", zIndex: 1
                }}
                onMouseEnter={e => e.currentTarget.style.color = "#00c896"}
                onMouseLeave={e => e.currentTarget.style.color = "#8a9bb0"}
              >
                +
              </button>
            </div>

            {/* Wykres */}
            <div id="pie-card" style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: "0 16px 16px 16px", padding: "24px 20px", marginBottom: 16, position: "relative", zIndex: 1 }}>
              
              {editingPortfolio && (
                <div style={{ position: "absolute", top: -1, left: -1, right: -1, background: "#1a2535", border: "1px solid #00c89650", borderRadius: "0 16px 16px 0", padding: 16, zIndex: 10, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.5)", flexWrap: "wrap" }}>
                  <input autoFocus style={{ display: "block", flex: 1, minWidth: 160, padding: "9px 12px", fontSize: 13, borderRadius: 8, background: "#161d28", border: "1px solid #243040", color: "#e8f0f8", fontFamily: "'Sora', sans-serif", outline: "none", boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s" }} value={newPortfolioName} onChange={e => setNewPortfolioName(e.target.value)} onKeyDown={e => { if(e.key==="Enter") handleRenamePortfolio(); if(e.key==="Escape") setEditingPortfolio(false); }} onFocus={e => { e.target.style.borderColor = "#00c896"; e.target.style.boxShadow = "0 0 0 3px #00c89618"; }} onBlur={e => { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; }} />
                  <button onClick={handleRenamePortfolio} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#00c896", color: "#000", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Zmień</button>
                  <button onClick={() => handleDeletePortfolio(activePortfolioId)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #f0506060", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer" }}>Usuń portfel</button>
                  <button onClick={() => setEditingPortfolio(false)} style={{ padding: "8px", background: "transparent", border: "none", color: "#5a6a7e", cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              )}
              {assetsWithLivePrices.length > 0 ? (
                <>
                  <PieChart
                    assets={assetsWithLivePrices}
                    categories={categories}
                    activeFilter={activeFilter}
                    onFilterChange={handleFilterChange}
                    hovered={hovered}
                    setHovered={setHovered}
                  />
                  <PortfolioSummaryPanel
                    assets={assetsWithLivePrices}
                    activeFilter={activeFilter}
                    categories={categories}
                    history={history}
                  />
                </>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" }}>
                  <div style={{ width: 120, height: 120, borderRadius: "50%", border: "2px dashed #2a3a50", display: "flex", alignItems: "center", justifyContent: "center", color: "#4a5a6e", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>BRAK DANYCH</div>
                  <div style={{ fontSize: 13, color: "#4a5a6e" }}>Dodaj pierwsze aktywo żeby zobaczyć wykres</div>
                </div>
              )}
            </div>

            {/* Przycisk dodawania */}
            <div id="add-btns" style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <button id="add-btn"
                onMouseEnter={() => setHovAdd(true)} onMouseLeave={() => setHovAdd(false)}
                onClick={() => setShowTypeSelector(true)}
                style={{
                  padding: "11px 32px", borderRadius: 12, border: "2px solid #00c896",
                  background: hovAdd ? "#00c89612" : "transparent",
                  color: "#00c896", fontWeight: 700, fontSize: 13, cursor: "pointer",
                  letterSpacing: ".03em", fontFamily: "'Sora', sans-serif",
                  textShadow: "0 0 8px #00c896, 0 0 18px #00c89680",
                  boxShadow: hovAdd
                    ? "0 0 16px #00c896, 0 0 40px #00c89660, inset 0 0 16px #00c89620"
                    : "0 0 10px #00c89640, 0 0 28px #00c89620, inset 0 0 8px #00c89610",
                  transition: "all .2s", WebkitTapHighlightColor: "transparent",
                }}>
                + Dodaj aktywo
              </button>
            </div>

            {/* Filtry */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {["Wszystkie", ...usedCats.map(c => c.name)].map(name => {
                const ia = name === "Wszystkie" ? !activeFilter : activeFilter === name;
                const color = name === "Wszystkie" ? "#00c896" : catColor(categories, name);
                return (
                  <button key={name} className="chip-btn"
                    onClick={() => handleFilterChange(name === "Wszystkie" ? null : (activeFilter === name ? null : name))}
                    style={{
                      padding: "6px 14px", borderRadius: 20,
                      border: `1px solid ${ia ? color : "#1e2a38"}`,
                      background: ia ? color + "22" : "transparent",
                      color: ia ? color : "#8a9bb0", fontSize: 12, cursor: "pointer",
                      fontFamily: "'Sora', sans-serif", fontWeight: ia ? 600 : 400,
                      boxShadow: ia ? `0 0 10px ${color}30` : "none",
                      transition: "all .15s", WebkitAppearance: "none", appearance: "none",
                      WebkitTapHighlightColor: "transparent",
                    }}>
                    {name}
                  </button>
                );
              })}
            </div>

            {/* Lista aktywów */}
            <ErrorBoundary key="asset-list">
            {visible.length === 0 ? (
              <div style={{ background: "#161d28", border: "1px dashed #1e2a38", borderRadius: 12, padding: 32, textAlign: "center", color: "#4a5a6e", fontSize: 13, lineHeight: 1.7 }}>
                {assets.length === 0
                  ? <><span>Nie masz jeszcze żadnych aktywów.</span><br /><span>Kliknij jeden z przycisków powyżej żeby zacząć.</span></>
                  : "Brak aktywów w tej kategorii."}
              </div>
            ) : (
              visible.map(a => (
                <div key={a.id} className="asset-row-wrap">
                  {a.isBond ? (
                    <BondRow bond={a} color={catColor(categories, a.category || "Obligacje")} onClick={() => setBondDetail(a)} />
                  ) : a.isStock ? (
                    <StockRow stock={a} stockPrices={stockPrices} color={catColor(categories, a.category || "Akcje / ETF")} onClick={() => setStockDetail(a)} />
                  ) : a.isCommodity ? (
                    <CommodityRow asset={a} commodityPrices={commodityPrices} color={catColor(categories, a.category || "Surowce")} onClick={() => setCommodityDetail(a)} />
                  ) : a.isSavings ? (
                    <SavingsRow account={a} color={catColor(categories, a.category || "Konto oszczędnościowe")} onClick={() => setSelectedSavings(a)} />
                  ) : a.isCurrency ? (
                    <CurrencyRow asset={a} color={catColor(categories, a.category || "Waluty")} onClick={() => setCurrencyModal(a)} />
                  ) : (
                    <AssetRow asset={a} total={total} categories={categories} prices={prices}
                      onClick={() => setModal(a)} />
                  )}
                </div>
              ))
            )}
            </ErrorBoundary>

            {/* Stopka */}
            <div style={{ textAlign: "center", fontSize: 11, color: "#4a5a6e", marginTop: 28, paddingBottom: 16 }}>
              Kliknij aktywo aby edytować · dane zapisane lokalnie w przeglądarce
              {anyLastUpdated && (
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span>Kursy live: {anyLastUpdated.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span style={{ color: "#2a3a4e" }}>·</span>
                  <span style={{ color: isMarketHours() ? "#00c89680" : "#3a4a5e" }}>
                    {isMarketHours() ? "giełda otwarta" : "giełda zamknięta"}
                  </span>
                  <button onClick={refetchStocks}
                    title="Odśwież kursy akcji"
                    style={{ background: "transparent", border: "1px solid #2a3a50", borderRadius: 6, color: "#5a6a7e", cursor: "pointer", fontSize: 12, padding: "1px 7px", lineHeight: 1.6, transition: "all .15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#00c896"; e.currentTarget.style.color = "#00c896"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a3a50"; e.currentTarget.style.color = "#5a6a7e"; }}
                  >↻ odśwież</button>
                </div>
              )}
              {(() => {
                const keys = Object.keys(INFLATION_HISTORY).sort();
                const latestKey = keys[keys.length - 1];
                const latestVal = INFLATION_HISTORY[latestKey];
                return latestKey ? (
                  <div style={{ marginTop: 4, color: "#3a4a5e" }}>
                    Inflacja GUS: <span style={{ color: "#3b9eff" }}>{(latestVal * 100).toFixed(1)}%</span>
                    <span style={{ marginLeft: 4, color: "#2a3a4e" }}>({latestKey})</span>
                  </div>
                ) : null;
              })()}
            </div>
          </>
        )}
      </div>

      {/* ── Modale ── */}
      {showTypeSelector && (
        <AssetTypeSelectorModal
          onClose={() => setShowTypeSelector(false)}
          onSelect={type => {
            setShowTypeSelector(false);
            if (type === "Waluty / Gotówka") setCurrencyModal("add");
            else if (type === "Konto oszczędnościowe") { setEditingSavings(null); setShowSavingsForm(true); }
            else if (type === "Obligacje") setBondModal("add");
            else if (type === "Akcje / ETF") setStockModal("add");
            else if (type === "Surowce") setCommodityModal("add");
            else setModal({ isNew: true, category: type });
          }}
        />
      )}

      {modal && (
        <AssetModal
          asset={modal === "add" ? { isNew: true } : modal}
          categories={categories}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
          onMove={a => { setMovingAsset(a); setModal(null); }}
        />
      )}

      {bondDetail && (
        <BondDetailPanel
          bond={bondDetail}
          onEdit={bond => { setBondDetail(null); setBondModal(bond); }}
          onDelete={handleDelete}
          onClose={() => setBondDetail(null)}
          onMove={a => setMovingAsset(a)}
        />
      )}

      {bondModal && (
        <BondModal
          bond={bondModal === "add" ? null : bondModal}
          onSave={asset => {
            if (asset.isBond) {
              const calc = calcBondCurrentValue(asset);
              asset.value = calc.currentValue;
            }
            handleSave(asset);
          }}
          onDelete={handleDelete}
          onClose={() => setBondModal(null)}
        />
      )}

      {stockDetail && (
        <StockDetailPanel
          stock={stockDetail}
          stockPrices={stockPrices}
          onEdit={stock => { setStockDetail(null); setStockModal(stock); }}
          onDelete={id => { handleDelete(id); setStockDetail(null); }}
          onClose={() => setStockDetail(null)}
          onMove={a => setMovingAsset(a)}
        />
      )}

      {stockModal && (
        <StockModal
          stock={stockModal === "add" ? null : stockModal}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setStockModal(null)}
        />
      )}

      {commodityDetail && (
        <CommodityDetailPanel
          asset={commodityDetail}
          commodityPrices={commodityPrices}
          onEdit={a => { setCommodityDetail(null); setCommodityModal(a); }}
          onDelete={id => { handleDelete(id); setCommodityDetail(null); }}
          onClose={() => setCommodityDetail(null)}
          onMove={a => setMovingAsset(a)}
        />
      )}

      {commodityModal && (
        <CommodityModal
          asset={commodityModal === "add" ? null : commodityModal}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setCommodityModal(null)}
        />
      )}

      {/* ── Modale kont oszczędnościowych ── */}
      {selectedSavings && (
        <SavingsModal
          account={selectedSavings}
          onClose={() => setSelectedSavings(null)}
          onSave={updated => handleSaveSavings(updated)}
          onDelete={handleDeleteSavings}
          onMove={a => { setMovingAsset(a); setSelectedSavings(null); }}
          onOpenEditForm={(acc) => {
            setSelectedSavings(null);
            setEditingSavings(acc);
            setShowSavingsForm(true);
          }}
        />
      )}
      {showSavingsForm && (
        <SavingsFormModal
          existing={editingSavings}
          onClose={() => { setShowSavingsForm(false); setEditingSavings(null); }}
          onSave={handleSaveSavings}
        />
      )}
      
      {currencyModal && (
        <CurrencyModal
          asset={currencyModal === "add" ? null : currencyModal}
          onSave={a => { handleSave(a); setCurrencyModal(null); }}
          onDelete={id => { handleDelete(id); setCurrencyModal(null); }}
          onClose={() => setCurrencyModal(null)}
          onMove={a => { setMovingAsset(a); setCurrencyModal(null); }}
        />
      )}

      {movingAsset && (
        <MoveAssetModal 
          asset={movingAsset} 
          portfolios={portfolios}
          onClose={() => setMovingAsset(null)} 
          onConfirm={handleMoveAsset} 
        />
      )}
    </>
  );
}
