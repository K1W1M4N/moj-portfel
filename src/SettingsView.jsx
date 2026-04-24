// src/SettingsView.jsx — Ekran ustawień. Na razie: wybór trybu wyceny P&L.
import { usePnlMode, setPnlMode, PNL_MODES } from "./preferences";

export function SettingsView() {
  const mode = usePnlMode();

  return (
    <div style={{ padding: "0 14px", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ fontSize: 11, letterSpacing: ".18em", color: "#4a5a6e", fontFamily: "'DM Mono', monospace", textAlign: "center", margin: "0 0 18px" }}>
        USTAWIENIA
      </div>

      <div style={{ fontSize: 11, color: "#5a6a7e", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, paddingLeft: 4 }}>
        Wyliczanie zysku / straty
      </div>

      <div style={{ background: "#161d28", border: "1px solid #1e2a38", borderRadius: 12, overflow: "hidden" }}>
        <ModeOption
          active={mode === PNL_MODES.SNAPSHOT}
          onClick={() => setPnlMode(PNL_MODES.SNAPSHOT)}
          title="Snapshot zakupu"
          subtitle="Zysk = obecna wartość minus PLN faktycznie wydane"
          detail="Domyślny tryb. Zapisujemy kurs walut z dnia zakupu. Zmiany kursu EUR/USD nie wpływają na 'cenę wejścia' - widzisz realny zysk tego ile PLN wrzuciłeś vs ile byś dostał dziś."
        />
        <div style={{ height: 1, background: "#1e2a38" }} />
        <ModeOption
          active={mode === PNL_MODES.XTB}
          onClick={() => setPnlMode(PNL_MODES.XTB)}
          title="Tryb XTB"
          subtitle="Zysk = obecna wartość minus (ilość × cena w walucie × bieżący kurs)"
          detail="Kurs walut przeliczany ciągle bieżącym. Dla ETF-ów USD/EUR wynik przypomina to co widzisz u brokera. Uwaga: dla pozycji zapisanych w trybie 'Transze' lub 'Broker' (bez średniej ceny w walucie nominalnej) wyliczenie wraca do snapshota."
        />
      </div>

      <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 12, lineHeight: 1.6, paddingLeft: 4 }}>
        Żadne dane nie są usuwane przy zmianie trybu - przełącznik zmienia tylko sposób prezentacji zysku na liście i w modalach.
      </div>
    </div>
  );
}

function ModeOption({ active, onClick, title, subtitle, detail }) {
  return (
    <button onClick={onClick} style={{
      display: "block", width: "100%", textAlign: "left",
      background: active ? "#1a2535" : "transparent",
      border: "none", cursor: "pointer", padding: "14px 16px",
      color: "#e8f0f8", fontFamily: "'Sora', sans-serif",
      transition: "background .15s",
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#111821"; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 18, height: 18, borderRadius: "50%",
          border: `2px solid ${active ? "#e8e040" : "#3a4a5e"}`,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {active && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e8e040" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: active ? "#e8e040" : "#e8f0f8" }}>{title}</div>
          <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#5a6a7e", marginTop: 10, paddingLeft: 28, lineHeight: 1.5 }}>
        {detail}
      </div>
    </button>
  );
}
