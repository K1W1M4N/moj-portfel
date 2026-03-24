import { useState, useRef, useEffect, useCallback } from "react";
import { BondModal, BondDetailPanel, BondRow, calcBondCurrentValue } from "./BondModal";
import { StockModal, StockRow, useStockPrices } from "./StockModal";
import { SavingsModal, SavingsFormModal, SavingsRow, getSavingsValue } from "./SavingsModal";
import { BOND_RATES_HISTORY } from "./bondRates";
import { INFLATION_HISTORY } from "./inflationData";

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

function useCryptoPrices(assets) {
  const [prices, setPrices] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const cryptoAssets = assets.filter(a => a.cryptoId);
    if (cryptoAssets.length === 0) return;
    const ids = [...new Set(cryptoAssets.map(a => a.cryptoId))].join(",");

    async function fetchPrices() {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=pln&include_24hr_change=true`
        );
        if (!res.ok) return;
        const data = await res.json();
        setPrices(data);
        setLastUpdated(new Date());
      } catch (e) {
        console.warn("CoinGecko error:", e);
      }
    }

    fetchPrices();
    const interval = setInterval(fetchPrices, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [assets.map(a => a.cryptoId).join(",")]);

  return { prices, lastUpdated };
}

// ─── Widok Obligacji ──────────────────────────────────────────────────────────
const BOND_DESCRIPTIONS = {
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
                    <span style={{ fontSize: 11, color: "#4a5a6e" }}>{info.years} {info.years === 1 ? "rok" : info.years < 5 ? "lata" : "lat"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5a6a7e", marginLeft: 16 }}>{info.full}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {latest ? (
                    <>
                      <div style={{ fontSize: 20, fontWeight: 700, color: info.color, fontFamily: "'DM Mono', monospace" }}>
                        {(latest.rate * 100).toFixed(2)}%
                      </div>
                      <div style={{ fontSize: 10, color: "#4a5a6e" }}>rok 1 · {latest.month}</div>
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
    { id: "bonds",   label: "Obligacje",            icon: "📋", desc: "Aktualne stawki" },
    { id: "savings", label: "Konta oszczędnościowe", icon: "🏦", desc: "Zarządzaj kontami" },
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
              <span style={{ fontSize: 16 }}>{item.icon}</span>
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
      ctx.fillStyle = "#e8f0f8"; ctx.font = "bold 15px 'DM Mono', monospace";
      ctx.fillText(fmt(dispG.value), cx, cy + 8);
      ctx.fillStyle = dispG.color; ctx.font = "500 13px 'DM Mono', monospace";
      ctx.fillText((dispG.pct * 100).toFixed(1) + "%", cx, cy + 27);
    } else {
      ctx.fillStyle = "#8a9bb0"; ctx.font = "500 10px 'Sora', sans-serif";
      ctx.fillText("ŁĄCZNIE", cx, cy - 6);
      ctx.fillStyle = "#00c896"; ctx.font = "bold 18px 'DM Mono', monospace";
      ctx.fillText(fmt(total), cx, cy + 16);
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

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
      <canvas ref={canvasRef}
        style={{ flexShrink: 0, width: "220px", height: "220px", cursor: "pointer" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        onClick={handleClick}
        onTouchEnd={handleTouch}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {grouped.map(g => (
          <div key={g.name}
            onClick={() => { setHovered(null); onFilterChange(g.name === activeFilter ? null : g.name); }}
            onTouchEnd={e => { e.preventDefault(); setHovered(null); onFilterChange(g.name === activeFilter ? null : g.name); }}
            onMouseEnter={() => setHovered(g.name)}
            onMouseLeave={() => setHovered(null)}
            style={{
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              opacity: activeFilter && activeFilter !== g.name ? 0.35 : 1,
              transition: "opacity .15s"
            }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#8a9bb0", minWidth: 160 }}>{g.name}</span>
            <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "#e8f0f8" }}>{fmt(g.value)}</span>
            <span style={{ fontSize: 11, color: g.color, minWidth: 42, textAlign: "right", fontFamily: "'DM Mono', monospace" }}>
              {(g.pct * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
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

function AssetModal({ asset, categories, onSave, onDelete, onClose }) {
  const isEdit = !!asset;
  const [form, setForm] = useState(
    asset ? { ...asset } : { name: "", category: categories[0]?.name || "", value: "", note: "", cryptoId: "", cryptoAmount: "", cryptoPaid: "" }
  );
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
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>{isEdit ? "Edytuj aktywo" : "Dodaj aktywo"}</div>
          <button onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            onClick={onClose} style={closeBtnStyle(hovClose)}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Nazwa aktywa</label>
          <input style={baseInp} placeholder="np. Mój Bitcoin, Konto PKO..."
            value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onFocus={focusInp} onBlur={blurInp} />
        </div>

        <div style={{ marginBottom: 14 }}>
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

  if (asset.cryptoId && asset.cryptoId !== "other" && prices[asset.cryptoId]) {
    const priceData = prices[asset.cryptoId];
    cryptoPrice = priceData.pln;
    displayValue = asset.cryptoAmount * cryptoPrice;
    change24h = priceData.pln_24h_change;
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
            {fmt(displayValue)}
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

// ─── Widok Kont Oszczędnościowych ─────────────────────────────────────────────
function SavingsView({ assets, onAdd, onSelect }) {
  const savingsAccounts = assets.filter(a => a.isSavings);
  const totalSavings = savingsAccounts.reduce((s, a) => s + getSavingsValue(a), 0);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: "#5a6a7e" }}>Konta oszczędnościowe</div>
          {savingsAccounts.length > 0 && (
            <div style={{ fontSize: 11, color: "#3a4a5e", marginTop: 2 }}>
              Łącznie:{" "}
              <span style={{ color: "#00c896", fontFamily: "'DM Mono', monospace" }}>
                {new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(totalSavings)}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onAdd}
          style={{
            padding: "9px 18px", borderRadius: 10, border: "2px solid #00c896",
            background: "transparent", color: "#00c896", fontWeight: 700, fontSize: 13,
            cursor: "pointer", fontFamily: "'Sora', sans-serif",
            boxShadow: "0 0 8px #00c89630", transition: "all .2s",
          }}>
          + Dodaj konto
        </button>
      </div>

      {savingsAccounts.length === 0 ? (
        <div style={{
          background: "#161d28", border: "1px dashed #1e2a38", borderRadius: 14,
          padding: "48px 24px", textAlign: "center",
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏦</div>
          <div style={{ fontSize: 15, color: "#5a6a7e", marginBottom: 6 }}>Brak kont oszczędnościowych</div>
          <div style={{ fontSize: 13, color: "#3a4a5e" }}>Kliknij „+ Dodaj konto" aby śledzić swoje oszczędności</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {savingsAccounts.map(a => (
            <SavingsRow key={a.id} account={a} onClick={() => onSelect(a)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Główna aplikacja ─────────────────────────────────────────────────────────
export default function App() {
  const [welcomed, setWelcomed] = useState(() => {
    try { return localStorage.getItem("pt-welcomed") === "1"; } catch { return false; }
  });
  const [assets, setAssets] = useState(() => {
    try { const s = localStorage.getItem("pt-assets"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [categories, setCategories] = useState(() => {
    try { const s = localStorage.getItem("pt-categories"); return s ? JSON.parse(s) : DEFAULT_CATEGORIES; } catch { return DEFAULT_CATEGORIES; }
  });
  const [activeFilter, setActiveFilter] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [modal, setModal] = useState(null);
  const [bondModal, setBondModal] = useState(null);
  const [bondDetail, setBondDetail] = useState(null);
  const [stockModal, setStockModal] = useState(null);
  const [hovAdd, setHovAdd] = useState(false);
  const [currentView, setCurrentView] = useState("portfolio");

  // ── Stany kont oszczędnościowych ──
  const [selectedSavings, setSelectedSavings] = useState(null);
  const [showSavingsForm, setShowSavingsForm] = useState(false);
  const [editingSavings, setEditingSavings] = useState(null);

  const { prices, lastUpdated } = useCryptoPrices(assets);
  const { stockPrices, stockLastUpdated } = useStockPrices(assets);

  // Aktualizuj wartości live (krypto, akcje, konta oszczędnościowe)
  const assetsWithLivePrices = assets.map(a => {
    if (a.isSavings) {
      return { ...a, value: getSavingsValue(a) };
    }
    if (a.isStock && a.stockSymbol && stockPrices[a.stockSymbol]) {
      return { ...a, value: a.stockQuantity * stockPrices[a.stockSymbol].pricePLN };
    }
    if (a.cryptoId && a.cryptoId !== "other" && prices[a.cryptoId]) {
      return { ...a, value: a.cryptoAmount * prices[a.cryptoId].pln };
    }
    return a;
  });

  useEffect(() => { try { localStorage.setItem("pt-assets", JSON.stringify(assets)); } catch {} }, [assets]);
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
    setAssets(all => {
      const exists = all.find(a => a.id === asset.id);
      return exists ? all.map(a => a.id === asset.id ? asset : a) : [...all, asset];
    });
  }

  function handleDelete(id) {
    setAssets(all => all.filter(a => a.id !== id));
  }

  // ── Zapis konta oszczędnościowego ──
  function handleSaveSavings(account) {
    // Upewnij się że kategoria istnieje
    if (!categories.find(c => c.name === "Konto oszczędnościowe")) {
      setCategories(cs => [...cs, { name: "Konto oszczędnościowe", color: "#00c896" }]);
    }
    const withValue = { ...account, value: getSavingsValue(account) };
    setAssets(all => {
      const exists = all.find(a => a.id === withValue.id);
      return exists ? all.map(a => a.id === withValue.id ? withValue : a) : [...all, withValue];
    });
    // Odśwież selectedSavings jeśli edytujemy otwarty panel
    if (selectedSavings && selectedSavings.id === withValue.id) {
      setSelectedSavings(withValue);
    }
  }

  function handleDeleteSavings(id) {
    setAssets(all => all.filter(a => a.id !== id));
    setSelectedSavings(null);
  }

  const total = assetsWithLivePrices.reduce((s, a) => s + a.value, 0);
  const visible = activeFilter ? assetsWithLivePrices.filter(a => a.category === activeFilter) : assetsWithLivePrices;
  const usedCats = categories.filter(c => assetsWithLivePrices.some(a => a.category === c.name));

  const anyLastUpdated = stockLastUpdated && lastUpdated
    ? (stockLastUpdated > lastUpdated ? stockLastUpdated : lastUpdated)
    : stockLastUpdated || lastUpdated;

  // Nagłówek tytułu — zależny od widoku
  const viewTitles = {
    portfolio: "PORTFOLIO TRACKER",
    bonds: "← PORTFOLIO TRACKER",
    savings: "← PORTFOLIO TRACKER",
  };

  const globalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@400;500;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body { background: #0a0e14; font-family: 'Sora', sans-serif; min-height: 100vh; color: #e8f0f8; }
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
      .pie-legend { display: none !important; }
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
            <MenuDropdown onNavigate={id => setCurrentView(id)} />
          </div>
        </div>

        {/* ── Widok obligacji ── */}
        {currentView === "bonds" && <BondRatesView />}

        {/* ── Widok kont oszczędnościowych ── */}
        {currentView === "savings" && (
          <SavingsView
            assets={assetsWithLivePrices}
            onAdd={() => { setEditingSavings(null); setShowSavingsForm(true); }}
            onSelect={a => setSelectedSavings(a)}
          />
        )}

        {/* ── Widok portfolio ── */}
        {currentView === "portfolio" && (
          <>
            {/* Wykres */}
            <div id="pie-card" style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 16, padding: "24px 20px", marginBottom: 16 }}>
              {assetsWithLivePrices.length > 0 ? (
                <PieChart
                  assets={assetsWithLivePrices}
                  categories={categories}
                  activeFilter={activeFilter}
                  onFilterChange={handleFilterChange}
                  hovered={hovered}
                  setHovered={setHovered}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" }}>
                  <div style={{ width: 120, height: 120, borderRadius: "50%", border: "2px dashed #2a3a50", display: "flex", alignItems: "center", justifyContent: "center", color: "#4a5a6e", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>BRAK DANYCH</div>
                  <div style={{ fontSize: 13, color: "#4a5a6e" }}>Dodaj pierwsze aktywo żeby zobaczyć wykres</div>
                </div>
              )}
            </div>

            {/* Przyciski dodawania */}
            <div id="add-btns" style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <button
                onClick={() => setBondModal("add")}
                style={{
                  padding: "11px 20px", borderRadius: 12, border: "2px solid #f0a030",
                  background: "transparent", color: "#f0a030", fontWeight: 700, fontSize: 13,
                  cursor: "pointer", letterSpacing: ".03em", fontFamily: "'Sora', sans-serif",
                  boxShadow: "0 0 8px #f0a03030", transition: "all .2s",
                  WebkitTapHighlightColor: "transparent",
                }}>
                + Obligacje
              </button>
              <button
                onClick={() => setStockModal("add")}
                style={{
                  padding: "11px 20px", borderRadius: 12, border: "2px solid #e8e040",
                  background: "transparent", color: "#e8e040", fontWeight: 700, fontSize: 13,
                  cursor: "pointer", letterSpacing: ".03em", fontFamily: "'Sora', sans-serif",
                  boxShadow: "0 0 8px #e8e04030", transition: "all .2s",
                  WebkitTapHighlightColor: "transparent",
                }}>
                + Akcje / ETF
              </button>
              <button
                onClick={() => { setEditingSavings(null); setShowSavingsForm(true); }}
                style={{
                  padding: "11px 20px", borderRadius: 12, border: "2px solid #00c896",
                  background: "transparent", color: "#00c896", fontWeight: 700, fontSize: 13,
                  cursor: "pointer", letterSpacing: ".03em", fontFamily: "'Sora', sans-serif",
                  boxShadow: "0 0 8px #00c89630", transition: "all .2s",
                  WebkitTapHighlightColor: "transparent",
                }}>
                + Konto oszcz.
              </button>
              <button id="add-btn"
                onMouseEnter={() => setHovAdd(true)} onMouseLeave={() => setHovAdd(false)}
                onClick={() => setModal("add")}
                style={{
                  padding: "11px 28px", borderRadius: 12, border: "2px solid #00c896",
                  background: hovAdd ? "#00c89612" : "transparent",
                  color: "#00c896", fontWeight: 700, fontSize: 13, cursor: "pointer",
                  letterSpacing: ".03em", fontFamily: "'Sora', sans-serif",
                  textShadow: "0 0 8px #00c896, 0 0 18px #00c89680",
                  boxShadow: hovAdd
                    ? "0 0 16px #00c896, 0 0 40px #00c89660, inset 0 0 16px #00c89620"
                    : "0 0 10px #00c89640, 0 0 28px #00c89620, inset 0 0 8px #00c89610",
                  transition: "all .2s", WebkitTapHighlightColor: "transparent",
                }}>
                + Inne aktywo
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
                    <BondRow bond={a} onClick={() => setBondDetail(a)} />
                  ) : a.isStock ? (
                    <StockRow stock={a} stockPrices={stockPrices} onClick={() => setStockModal(a)} />
                  ) : a.isSavings ? (
                    <SavingsRow account={a} onClick={() => setSelectedSavings(a)} />
                  ) : (
                    <AssetRow asset={a} total={total} categories={categories} prices={prices}
                      onClick={() => setModal(a)} />
                  )}
                </div>
              ))
            )}

            {/* Stopka */}
            <div style={{ textAlign: "center", fontSize: 11, color: "#4a5a6e", marginTop: 28, paddingBottom: 16 }}>
              Kliknij aktywo aby edytować · dane zapisane lokalnie w przeglądarce
              {anyLastUpdated && (
                <div style={{ marginTop: 4 }}>
                  Kursy live: {anyLastUpdated.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
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
      {modal && (
        <AssetModal
          asset={modal === "add" ? null : modal}
          categories={categories}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}

      {bondDetail && (
        <BondDetailPanel
          bond={bondDetail}
          onEdit={bond => { setBondDetail(null); setBondModal(bond); }}
          onDelete={handleDelete}
          onClose={() => setBondDetail(null)}
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

      {stockModal && (
        <StockModal
          stock={stockModal === "add" ? null : stockModal}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setStockModal(null)}
        />
      )}

      {/* ── Modale kont oszczędnościowych ── */}
     {selectedSavings && (
  <SavingsModal
    account={selectedSavings}
    onClose={() => setSelectedSavings(null)}
    onSave={updated => handleSaveSavings(updated)}
    onDelete={handleDeleteSavings}
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
    </>
  );
}
