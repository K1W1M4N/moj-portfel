// ─── Nawigacja: dolny pasek zakładek, menu, ekran „Aktywa” ────────────────────

const SVG = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

const TABS = [
  { id: "portfolio", label: "Portfel", icon: <svg {...SVG}><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" /><circle cx="16" cy="14.5" r="1.2" fill="currentColor" /></svg> },
  { id: "assets",    label: "Aktywa",  icon: <svg {...SVG}><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></svg> },
  { id: "kb",        label: "Baza wiedzy", icon: <svg {...SVG}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></svg> },
  { id: "menu",      label: "Menu",    icon: <svg {...SVG}><path d="M4 6h16M4 12h16M4 18h16" /></svg> },
];

const MENU_VIEWS = ["settings", "history", "market"];

const MENU_ITEMS = [
  { id: "settings", label: "Ustawienia", desc: "Tryb wyceny, preferencje", icon: "⚙" },
  { id: "history",  label: "Historia",   desc: "Wartość portfela w czasie", icon: "◷" },
  { id: "market",   label: "Rynek",      desc: "Liderzy wzrostów i newsy", icon: "↗" },
];

export function BottomNav({ currentView, menuOpen, onSelect }) {
  const activeId = menuOpen || MENU_VIEWS.includes(currentView) ? "menu" : currentView;
  return (
    <nav style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90,
      background: "#0d131cf2", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      borderTop: "1px solid #1e2a38", paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: 6 }}>
        {TABS.map(t => {
          const on = t.id === activeId;
          return (
            <button key={t.id} onClick={() => onSelect(t.id)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                padding: "8px 0", borderRadius: 14, border: "none", cursor: "pointer",
                background: on ? "#00c896" : "transparent", color: on ? "#04120d" : "#5a6a7e",
                fontSize: 11, fontWeight: on ? 700 : 500, fontFamily: "'Sora', sans-serif",
                transition: "background .2s, color .2s", WebkitTapHighlightColor: "transparent",
              }}>
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function MenuSheet({ open, currentView, onNavigate, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "#0008", zIndex: 80,
        opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity .2s",
      }} />
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 85,
        transform: open ? "translateY(0)" : "translateY(100%)", transition: "transform .25s ease",
      }}>
        <div style={{ maxWidth: 860, margin: "0 auto", background: "#161d28", border: "1px solid #2a3a50", borderBottom: "none", borderRadius: "20px 20px 0 0", padding: "10px 12px 86px" }}>
          <div style={{ width: 38, height: 4, borderRadius: 4, background: "#2a3a50", margin: "0 auto 12px" }} />
          {MENU_ITEMS.map(item => {
            const on = item.id === currentView;
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 14, width: "100%", padding: 12,
                  borderRadius: 12, border: "none", cursor: "pointer", textAlign: "left",
                  background: on ? "#0f1621" : "transparent", fontFamily: "'Sora', sans-serif",
                  WebkitTapHighlightColor: "transparent",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#0f1621"}
                onMouseLeave={e => e.currentTarget.style.background = on ? "#0f1621" : "transparent"}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "#0f1621", border: `1px solid ${on ? "#00c89660" : "#2a3a50"}`, display: "flex", alignItems: "center", justifyContent: "center", color: on ? "#00c896" : "#8a9bb0", fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
                <span>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>{item.label}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#8a9bb0" }}>{item.desc}</span>
                </span>
                <span style={{ marginLeft: "auto", color: "#4a5a6e", fontSize: 18 }}>›</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Aktywa ───────────────────────────────────────────────────────────────────

const CAT_ICONS = {
  "Akcje / ETF": "📈", "Obligacje": "🏛", "Konto oszczędnościowe": "🏦", "Konto osobiste": "💳",
  "Lokata": "🔒", "PPK": "🧓", "Krypto": "₿", "Surowce": "◆", "Waluty": "$", "Nieruchomości": "🏠",
};

function catIcon(name) {
  return CAT_ICONS[name] || (name || "?").charAt(0).toUpperCase();
}

const fmtPLN = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);

function positionsLabel(n) {
  if (n === 1) return "1 pozycja";
  const mod10 = n % 10, mod100 = n % 100;
  return `${n} ${mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "pozycje" : "pozycji"}`;
}

export function AssetsOverview({ categories, assets, portfolioName, onOpen }) {
  const total = assets.reduce((s, a) => s + a.value, 0);
  const rows = categories.map(c => {
    const items = assets.filter(a => a.category === c.name);
    return { ...c, count: items.length, sum: items.reduce((s, a) => s + a.value, 0) };
  });
  // Najpierw kategorie z aktywami (malejąco po wartości), potem puste
  rows.sort((a, b) => (b.count > 0) - (a.count > 0) || b.sum - a.sum);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#e8f0f8" }}>Aktywa</div>
        <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 4 }}>
          {portfolioName} · {fmtPLN(total)}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        {rows.map(c => {
          const empty = c.count === 0;
          return (
            <button key={c.name} onClick={() => onOpen(c.name)}
              style={{
                background: "#161d28", border: `1px ${empty ? "dashed" : "solid"} #1e2a38`, borderRadius: 16,
                padding: 16, minHeight: 108, display: "flex", flexDirection: "column", justifyContent: "space-between",
                textAlign: "left", cursor: "pointer", fontFamily: "'Sora', sans-serif", opacity: empty ? 0.6 : 1,
                transition: "border-color .15s", WebkitTapHighlightColor: "transparent",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#2a3a50"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#1e2a38"}>
              <div>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: c.color + "22", color: c.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginBottom: 12 }}>{catIcon(c.name)}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>{c.name}</div>
              </div>
              <div style={{ fontSize: 11, color: "#8a9bb0", fontFamily: "'DM Mono', monospace", marginTop: 6 }}>
                {empty ? "brak pozycji" : `${fmtPLN(c.sum)} · ${positionsLabel(c.count)}`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// actions: [{ label, onClick, primary? }]
export function CategoryHeader({ name, color, sum, count, actions, onBack }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#8a9bb0", marginBottom: 14 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#8a9bb0", cursor: "pointer", fontSize: 13, fontFamily: "'Sora', sans-serif", padding: 0 }}>‹ Aktywa</button>
        <span style={{ color: "#4a5a6e" }}>/</span>
        <span style={{ color: "#e8f0f8" }}>{name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: color + "22", color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{catIcon(name)}</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#e8f0f8" }}>{name}</div>
          <div style={{ fontSize: 12, color: "#8a9bb0", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(sum)} · {positionsLabel(count)}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {actions.map(a => (
          <button key={a.label} onClick={a.onClick}
            style={{
              padding: "10px 16px", borderRadius: 12, fontSize: 13, fontWeight: a.primary ? 700 : 600, cursor: "pointer",
              fontFamily: "'Sora', sans-serif", transition: "all .15s", WebkitTapHighlightColor: "transparent",
              background: a.primary ? "#00c896" : "transparent", color: a.primary ? "#000" : "#8a9bb0",
              border: `1px solid ${a.primary ? "#00c896" : "#2a3a50"}`,
            }}
            onMouseEnter={e => { if (!a.primary) { e.currentTarget.style.color = "#e8f0f8"; e.currentTarget.style.borderColor = "#4a5a6e"; } }}
            onMouseLeave={e => { if (!a.primary) { e.currentTarget.style.color = "#8a9bb0"; e.currentTarget.style.borderColor = "#2a3a50"; } }}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", background: "#0f1621", border: "1px solid #1e2a38", borderRadius: 12, padding: 3, marginBottom: 18 }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)}
            style={{
              flex: 1, padding: 8, borderRadius: 9, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
              fontFamily: "'Sora', sans-serif", background: on ? "#161d28" : "transparent",
              color: on ? "#e8f0f8" : "#8a9bb0", boxShadow: on ? "0 0 0 1px #2a3a50" : "none",
              WebkitTapHighlightColor: "transparent",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
