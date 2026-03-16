import { useState, useRef, useEffect, useCallback } from "react";

// ─── Kolory kategorii ────────────────────────────────────────────────────────
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

// ─── Wykres kołowy (Canvas) ──────────────────────────────────────────────────
function PieChart({ assets, categories, activeFilter, onFilterChange }) {
  const canvasRef = useRef(null);
  const sliceMapRef = useRef([]);
  const [hovered, setHovered] = useState(null);

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
    const ctx = canvas.getContext("2d");
    const grouped = getGrouped();
    const total = assets.reduce((s, a) => s + a.value, 0);
    const cx = 110, cy = 110, r = 96, inner = 62;
    ctx.clearRect(0, 0, 220, 220);
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
      const isActive = activeFilter === g.name, isHov = hovered === g.name;
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
      ctx.globalAlpha = (activeFilter && activeFilter !== g.name) ? 0.28 : 1;
      ctx.fillStyle = g.color; ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();
    });

    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = "#161d28"; ctx.fill();
    ctx.textAlign = "center";

    const disp = hovered || activeFilter;
    const dispG = disp ? sliceMapRef.current.find(s => s.name === disp) : null;

    if (dispG) {
      ctx.fillStyle = dispG.color; ctx.font = "11px 'Sora', sans-serif";
      ctx.fillText(dispG.name.split(" ")[0], cx, cy - 14);
      ctx.fillStyle = "#e8f0f8"; ctx.font = "bold 15px 'DM Mono', monospace";
      ctx.fillText(fmt(dispG.value), cx, cy + 8);
      ctx.fillStyle = dispG.color; ctx.font = "13px 'DM Mono', monospace";
      ctx.fillText((dispG.pct * 100).toFixed(1) + "%", cx, cy + 27);
    } else {
      ctx.fillStyle = "#8a9bb0"; ctx.font = "10px 'Sora', sans-serif";
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

  function getScaledCoords(clientX, clientY) {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = 220 / rect.width;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleX };
  }

  function handleMouseMove(e) {
    const { x, y } = getScaledCoords(e.clientX, e.clientY);
    const cat = getCatFromPoint(x, y);
    const cx = 110, cy = 110, inner = 62, dx = x - cx, dy = y - cy;
    canvasRef.current.style.cursor =
      (cat || Math.sqrt(dx * dx + dy * dy) < inner) ? "pointer" : "default";
    if (cat !== hovered) setHovered(cat);
  }

  function handleClick(e) {
    const { x, y } = getScaledCoords(e.clientX, e.clientY);
    const cat = getCatFromPoint(x, y);
    onFilterChange(cat ? (cat === activeFilter ? null : cat) : null);
  }

  function handleTouch(e) {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const { x, y } = getScaledCoords(touch.clientX, touch.clientY);
    const cat = getCatFromPoint(x, y);
    onFilterChange(cat ? (cat === activeFilter ? null : cat) : null);
  }

  const grouped = getGrouped();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
      <canvas ref={canvasRef} width={220} height={220}
        style={{ flexShrink: 0, width: "min(220px, 90vw)", height: "auto", cursor: "pointer" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        onClick={handleClick}
        onTouchEnd={handleTouch}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {grouped.map(g => (
          <div key={g.name}
            onClick={() => onFilterChange(g.name === activeFilter ? null : g.name)}
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

// ─── Shared styles ───────────────────────────────────────────────────────────
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
    boxShadow: hov
      ? "0 0 14px #00c896, inset 0 0 10px #00c89620"
      : "0 0 8px #00c89630, inset 0 0 6px #00c89610",
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

// ─── Modal dodawania / edycji ────────────────────────────────────────────────
function AssetModal({ asset, categories, onSave, onDelete, onClose }) {
  const isEdit = !!asset;
  const [form, setForm] = useState(
    asset ? { ...asset } : { name: "", category: categories[0]?.name || "", value: "", note: "" }
  );
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [hovSave, setHovSave] = useState(false);
  const [hovDel, setHovDel] = useState(false);
  const [hovCancel, setHovCancel] = useState(false);
  const [hovClose, setHovClose] = useState(false);

  function focusInp(e) { e.target.style.borderColor = "#00c896"; e.target.style.boxShadow = "0 0 0 3px #00c89618"; }
  function blurInp(e) { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; }

  function submit() {
    const val = parseFloat(String(form.value).replace(",", "."));
    if (!form.name.trim() || isNaN(val) || val <= 0) return;
    onSave({ ...form, value: val, id: asset?.id || Date.now() });
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
          <input style={baseInp} placeholder="np. Konto PKO, ETF IUSQ, Bitcoin..."
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
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
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

// ─── Wiersz aktywa ───────────────────────────────────────────────────────────
function AssetRow({ asset, total, categories, onClick }) {
  const color = catColor(categories, asset.category);
  const pct = total > 0 ? (asset.value / total * 100) : 0;
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "13px 18px",
        background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8,
        border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s"
      }}>
      <div style={{ width: 4, height: 36, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#e8f0f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</div>
        <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 2 }}>{asset.note || asset.category}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8" }}>{fmt(asset.value)}</div>
        <div style={{ fontSize: 11, color, fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{pct.toFixed(1)}%</div>
      </div>
      <div style={{ width: 50, height: 4, background: "#1e2a38", borderRadius: 2, flexShrink: 0, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ─── Ekran powitalny ─────────────────────────────────────────────────────────
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

// ─── Główna aplikacja ────────────────────────────────────────────────────────
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
  const [modal, setModal] = useState(null);
  const [hovAdd, setHovAdd] = useState(false);

  useEffect(() => { try { localStorage.setItem("pt-assets", JSON.stringify(assets)); } catch {} }, [assets]);
  useEffect(() => { try { localStorage.setItem("pt-categories", JSON.stringify(categories)); } catch {} }, [categories]);

  function handleStart() {
    try { localStorage.setItem("pt-welcomed", "1"); } catch {}
    setWelcomed(true);
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

  const total = assets.reduce((s, a) => s + a.value, 0);
  const visible = activeFilter ? assets.filter(a => a.category === activeFilter) : assets;
  const usedCats = categories.filter(c => assets.some(a => a.category === c.name));

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
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}
        onClick={e => {
          if (!e.target.closest("#pie-card") && !e.target.closest(".chip-btn") &&
            !e.target.closest(".asset-row-wrap") && !e.target.closest("#add-btn") && activeFilter) {
            setActiveFilter(null);
          }
        }}>

        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: "#4a5a6e", fontFamily: "'DM Mono', monospace" }}>
            PORTFOLIO TRACKER
          </div>
        </div>

        {/* Wykres */}
        <div id="pie-card" style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 16, padding: "24px 20px", marginBottom: 16 }}>
          {assets.length > 0 ? (
            <PieChart assets={assets} categories={categories} activeFilter={activeFilter} onFilterChange={setActiveFilter} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" }}>
              <div style={{ width: 120, height: 120, borderRadius: "50%", border: "2px dashed #2a3a50", display: "flex", alignItems: "center", justifyContent: "center", color: "#4a5a6e", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>BRAK DANYCH</div>
              <div style={{ fontSize: 13, color: "#4a5a6e" }}>Dodaj pierwsze aktywo żeby zobaczyć wykres</div>
            </div>
          )}
        </div>

        {/* Przycisk dodaj */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <button id="add-btn"
            onMouseEnter={() => setHovAdd(true)} onMouseLeave={() => setHovAdd(false)}
            onClick={e => { e.stopPropagation(); setModal("add"); }}
            style={{
              padding: "12px 36px", borderRadius: 12, border: "2px solid #00c896",
              background: hovAdd ? "#00c89612" : "transparent",
              color: "#00c896", fontWeight: 700, fontSize: 14, cursor: "pointer",
              letterSpacing: ".04em", fontFamily: "'Sora', sans-serif",
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
                onClick={e => { e.stopPropagation(); setActiveFilter(name === "Wszystkie" ? null : (activeFilter === name ? null : name)); }}
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
              ? <><span>Nie masz jeszcze żadnych aktywów.</span><br /><span>Kliknij <span style={{ color: "#00c896" }}>+ Dodaj aktywo</span> żeby zacząć.</span></>
              : "Brak aktywów w tej kategorii."}
          </div>
        ) : (
          visible.map(a => (
            <div key={a.id} className="asset-row-wrap">
              <AssetRow asset={a} total={total} categories={categories}
                onClick={e => { e.stopPropagation(); setModal(a); }} />
            </div>
          ))
        )}

        <div style={{ textAlign: "center", fontSize: 11, color: "#4a5a6e", marginTop: 28, paddingBottom: 16 }}>
          Kliknij aktywo aby edytować · dane zapisane lokalnie w przeglądarce
        </div>
      </div>

      {modal && (
        <AssetModal
          asset={modal === "add" ? null : modal}
          categories={categories}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
