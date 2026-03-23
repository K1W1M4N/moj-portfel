// SavingsModal.jsx
// Moduł konta oszczędnościowego dla moj-portfel
// Kapitalizacja miesięczna, naliczanie dzienne ACT/365, historia wpłat/wypłat

import { useState, useMemo } from "react";

// ─── Stałe kolorów (spójne z App.jsx) ────────────────────────────────────────
const C = {
  bg: "#0a0e14",
  card: "#161d28",
  cardHover: "#1c2637",
  border: "#1e2d3d",
  green: "#00c896",
  orange: "#f0a030",
  red: "#e05555",
  text: "#e8edf3",
  muted: "#6b7f96",
  accent2: "#3d8ef0",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt2 = (n) =>
  Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " zł";
const fmt0 = (n) =>
  Number(n).toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " zł";
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};
const today = () => new Date().toISOString().slice(0, 10);

// ─── Silnik obliczeń ──────────────────────────────────────────────────────────
// Kapitalizacja miesięczna, naliczanie dzienne ACT/365
// Zwraca:
//   currentBalance   — saldo po wszystkich kapitalizacjach
//   accruedToday     — narosłe odsetki od ostatniej kapitalizacji (dzisiaj)
//   dailyGain        — dzienny przyrost (ostatni dzień)
//   totalInterest    — suma odsetek od otwarcia
//   lastCapDate      — data ostatniej kapitalizacji
//   nextCapDate      — data następnej kapitalizacji
//   months           — tablica { label, date, balance, interest } wszystkich dotychczasowych kapitalizacji

function computeSavings(account) {
  const { openDate, rate, transactions = [] } = account;
  if (!openDate || rate == null) return null;

  const annualRate = rate / 100;
  const todayStr = today();
  const todayDate = new Date(todayStr);

  // Sortuj transakcje rosnąco
  const sorted = [...transactions].sort((a, b) => (a.date > b.date ? 1 : -1));

  // Buduj listę miesięcy od openDate do dziś
  const open = new Date(openDate);
  let balance = 0;
  let totalInterest = 0;
  const months = []; // { label, date (ISO), openBalance, interest, closeBalance }

  // Wylicz wszystkie pełne miesiące
  let periodStart = new Date(open);
  let monthIndex = 0;

  while (true) {
    // Następna kapitalizacja = periodStart + 1 miesiąc
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Jeśli następna kapitalizacja jest w przyszłości — stop
    if (periodEnd > todayDate) break;

    // Saldo na początku okresu (po wszystkich transakcjach <= periodStart)
    let bal = balance;
    for (const tx of sorted) {
      if (tx.date > periodStart.toISOString().slice(0, 10) && tx.date <= periodEnd.toISOString().slice(0, 10)) {
        // Wpłaty w środku okresu — dla uproszczenia: wpłaty dodajemy od daty wpłaty
        // ale odsetki liczymy od salda na początku okresu (standard KO w Polsce)
      }
    }

    // Saldo na początku okresu (transakcje <= periodStart)
    let openBal = balance;
    for (const tx of sorted) {
      if (tx.date <= periodStart.toISOString().slice(0, 10)) {
        // już uwzględnione w balance
      }
    }
    openBal = balance;

    // Dni w tym okresie
    const days = Math.round((periodEnd - periodStart) / 86400000);
    const interest = Math.round(openBal * annualRate * (days / 365) * 100) / 100;

    // Transakcje w tym okresie (między periodStart a periodEnd, exclusive start)
    const txInPeriod = sorted.filter(
      (tx) =>
        tx.date > periodStart.toISOString().slice(0, 10) &&
        tx.date <= periodEnd.toISOString().slice(0, 10)
    );
    const txSum = txInPeriod.reduce((s, tx) => s + tx.amount, 0);

    const closeBal = Math.round((openBal + interest + txSum) * 100) / 100;

    months.push({
      label: periodEnd.toLocaleDateString("pl-PL", { month: "long", year: "numeric" }),
      date: periodEnd.toISOString().slice(0, 10),
      openBalance: openBal,
      interest,
      txSum,
      closeBalance: closeBal,
      days,
    });

    totalInterest += interest;
    balance = closeBal;

    // Transakcje dokładnie w dniu periodStart już były, teraz dodaj tx w periodEnd jeśli nie dodane
    periodStart = new Date(periodEnd);
    monthIndex++;

    // Zabezpieczenie przed nieskończoną pętlą
    if (monthIndex > 600) break;
  }

  // Transakcje po ostatniej kapitalizacji (lub od openDate jeśli żadnej nie było)
  const lastCapDate = periodStart.toISOString().slice(0, 10);
  const txAfterCap = sorted.filter((tx) => tx.date > lastCapDate && tx.date <= todayStr);
  const txAfterCapSum = txAfterCap.reduce((s, tx) => s + tx.amount, 0);

  // Transakcje przed openDate — ignoruj
  // Transakcje od początku do lastCapDate już uwzględnione w balance przez pętlę
  // Ale musimy też uwzględnić transakcje z dokładnie openDate
  const txOnOpen = sorted.filter((tx) => tx.date === openDate);
  // Transakcje <= lastCapDate ale > openDate — uwzględnione w pętli

  // Aktualne saldo (po ostatniej kapitalizacji + tx po niej)
  const currentBalance = Math.round((balance + txAfterCapSum) * 100) / 100;

  // Narosłe odsetki od ostatniej kapitalizacji do dziś
  const daysAccrued = Math.round((todayDate - periodStart) / 86400000);
  const accruedToday =
    Math.round(currentBalance * annualRate * (daysAccrued / 365) * 100) / 100;

  // Dzienny przyrost (na podstawie aktualnego salda)
  const dailyGain = Math.round(currentBalance * annualRate * (1 / 365) * 100) / 100;

  // Następna kapitalizacja
  const nextCapDate = new Date(periodStart);
  nextCapDate.setMonth(nextCapDate.getMonth() + 1);

  return {
    currentBalance,
    accruedToday,
    dailyGain,
    totalInterest,
    lastCapDate,
    nextCapDate: nextCapDate.toISOString().slice(0, 10),
    months,
    daysAccrued,
  };
}

// Prognoza ─ saldo za N miesięcy przy stałym oprocentowaniu
function projectBalance(currentBalance, rate, months) {
  const annualRate = rate / 100;
  let bal = currentBalance;
  for (let i = 0; i < months; i++) {
    // ~30.44 dni na miesiąc dla prognozy
    const interest = Math.round(bal * annualRate * (30.44 / 365) * 100) / 100;
    bal = Math.round((bal + interest) * 100) / 100;
  }
  return bal;
}

// ─── SavingsDetailPanel ───────────────────────────────────────────────────────
function SavingsDetailPanel({ account, onEdit, onDelete }) {
  const calc = useMemo(() => computeSavings(account), [account]);
  const [projMonths, setProjMonths] = useState(12);
  const [showHistory, setShowHistory] = useState(false);
  const [showTxForm, setShowTxForm] = useState(false);
  const [txDate, setTxDate] = useState(today());
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  if (!calc) {
    return (
      <div style={{ color: C.muted, padding: "24px", textAlign: "center" }}>
        Brak danych do obliczeń.
      </div>
    );
  }

  const {
    currentBalance,
    accruedToday,
    dailyGain,
    totalInterest,
    lastCapDate,
    nextCapDate,
    months,
    daysAccrued,
  } = calc;

  const projectedBalance = projectBalance(currentBalance, account.rate, projMonths);
  const projectedGain = projectedBalance - currentBalance;

  const projOptions = [
    { label: "1 mies.", value: 1 },
    { label: "3 mies.", value: 3 },
    { label: "6 mies.", value: 6 },
    { label: "1 rok", value: 12 },
    { label: "2 lata", value: 24 },
    { label: "3 lata", value: 36 },
    { label: "5 lat", value: 60 },
    { label: "10 lat", value: 120 },
  ];

  const handleAddTx = () => {
    const amount = parseFloat(txAmount.replace(",", "."));
    if (!txDate || isNaN(amount) || amount === 0) return;
    const newTx = { date: txDate, amount, note: txNote };
    const updated = {
      ...account,
      transactions: [...(account.transactions || []), newTx].sort((a, b) =>
        a.date > b.date ? 1 : -1
      ),
    };
    onEdit(updated);
    setTxDate(today());
    setTxAmount("");
    setTxNote("");
    setShowTxForm(false);
  };

  const handleDeleteTx = (idx) => {
    const newTxs = (account.transactions || []).filter((_, i) => i !== idx);
    onEdit({ ...account, transactions: newTxs });
  };

  return (
    <div style={{ fontFamily: "'Sora', sans-serif", color: C.text }}>
      {/* Nagłówek */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{account.name}</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            {account.bankName || "Konto oszczędnościowe"} ·{" "}
            <span style={{ color: C.orange, fontFamily: "'DM Mono', monospace" }}>
              {account.rate}% rocznie
            </span>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.muted,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 18,
              letterSpacing: 2,
            }}
          >
            ···
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 40,
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                zIndex: 100,
                minWidth: 140,
                boxShadow: "0 8px 32px #0008",
              }}
            >
              <button
                onClick={() => { setMenuOpen(false); onEdit(account, true); }}
                style={menuBtnStyle}
              >
                ✏️ Edytuj
              </button>
              <button
                onClick={() => { setMenuOpen(false); onDelete(account.id); }}
                style={{ ...menuBtnStyle, color: C.red }}
              >
                🗑 Usuń
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Kluczowe liczby */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <StatCard label="Aktualne saldo" value={fmt2(currentBalance)} big accent={C.green} />
        <StatCard
          label={`Narosłe odsetki (${daysAccrued} dni)`}
          value={"+" + fmt2(accruedToday)}
          accent={C.green}
        />
        <StatCard label="Dzienny przyrost" value={"+" + fmt2(dailyGain)} accent={C.orange} />
        <StatCard label="Odsetki łącznie (skap.)" value={"+" + fmt2(totalInterest)} accent={C.accent2} />
      </div>

      {/* Info o kapitalizacji */}
      <div
        style={{
          background: "#0f1823",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 20,
          fontSize: 13,
          color: C.muted,
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <span>
          📅 Ostatnia kapitalizacja:{" "}
          <span style={{ color: C.text }}>{fmtDate(lastCapDate)}</span>
        </span>
        <span>
          ⏭ Następna kapitalizacja:{" "}
          <span style={{ color: C.green }}>{fmtDate(nextCapDate)}</span>
        </span>
        <span>
          📂 Otwarto:{" "}
          <span style={{ color: C.text }}>{fmtDate(account.openDate)}</span>
        </span>
      </div>

      {/* Prognoza */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "16px 18px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: C.muted,
            marginBottom: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          📈 Prognoza zysku
        </div>
        {/* Selektor okresu */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {projOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => setProjMonths(o.value)}
              style={{
                padding: "5px 12px",
                borderRadius: 20,
                border: `1px solid ${projMonths === o.value ? C.green : C.border}`,
                background: projMonths === o.value ? C.green + "22" : "transparent",
                color: projMonths === o.value ? C.green : C.muted,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "'Sora', sans-serif",
                fontWeight: projMonths === o.value ? 700 : 400,
                transition: "all 0.15s",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>
              Saldo za {projOptions.find((o) => o.value === projMonths)?.label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "'DM Mono', monospace",
                color: C.text,
              }}
            >
              {fmt0(projectedBalance)}
            </div>
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>
              Szacowany zysk
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "'DM Mono', monospace",
                color: C.green,
              }}
            >
              +{fmt0(projectedGain)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
          * Zakłada stałe oprocentowanie {account.rate}% i brak nowych wpłat/wypłat
        </div>
      </div>

      {/* Historia kapitalizacji */}
      {months.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setShowHistory((v) => !v)}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.muted,
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 13,
              width: "100%",
              textAlign: "left",
              fontFamily: "'Sora', sans-serif",
            }}
          >
            {showHistory ? "▲" : "▼"} Historia kapitalizacji ({months.length} mies.)
          </button>
          {showHistory && (
            <div
              style={{
                marginTop: 8,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {/* Nagłówek tabeli */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
                  padding: "8px 14px",
                  background: "#0f1823",
                  fontSize: 11,
                  color: C.muted,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontWeight: 600,
                }}
              >
                <span>Miesiąc</span>
                <span style={{ textAlign: "right" }}>Saldo przed</span>
                <span style={{ textAlign: "right" }}>Odsetki</span>
                <span style={{ textAlign: "right" }}>Saldo po</span>
              </div>
              {[...months].reverse().map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
                    padding: "10px 14px",
                    borderTop: `1px solid ${C.border}`,
                    fontSize: 13,
                    background: i % 2 === 0 ? "transparent" : "#0f181f",
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: C.muted }}>{m.label}</span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 12,
                    }}
                  >
                    {fmt0(m.openBalance)}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      color: C.green,
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 12,
                    }}
                  >
                    +{fmt2(m.interest)}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {fmt0(m.closeBalance)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Historia wpłat/wypłat */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: C.muted,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            💳 Historia wpłat / wypłat
          </div>
          <button
            onClick={() => setShowTxForm((v) => !v)}
            style={{
              background: C.green + "22",
              border: `1px solid ${C.green}`,
              borderRadius: 8,
              color: C.green,
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "'Sora', sans-serif",
              fontWeight: 600,
            }}
          >
            + Dodaj
          </button>
        </div>

        {/* Formularz dodawania transakcji */}
        {showTxForm && (
          <div
            style={{
              background: "#0f1823",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: 14,
              marginBottom: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={labelStyle}>Data</label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={labelStyle}>Kwota (+ wpłata / − wypłata)</label>
                <input
                  type="number"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  placeholder="np. 5000 lub -2000"
                  style={inputStyle}
                />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Notatka (opcjonalnie)</label>
              <input
                type="text"
                value={txNote}
                onChange={(e) => setTxNote(e.target.value)}
                placeholder="np. Miesięczna wpłata"
                style={inputStyle}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowTxForm(false)}
                style={{ ...btnBase, background: "transparent", color: C.muted, border: `1px solid ${C.border}` }}
              >
                Anuluj
              </button>
              <button onClick={handleAddTx} style={{ ...btnBase, background: C.green, color: "#000" }}>
                Zapisz
              </button>
            </div>
          </div>
        )}

        {/* Lista transakcji */}
        {(account.transactions || []).length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "16px 0" }}>
            Brak transakcji. Dodaj pierwszą wpłatę.
          </div>
        ) : (
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {[...(account.transactions || [])]
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((tx, i) => {
                const isDeposit = tx.amount > 0;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
                      background: i % 2 === 0 ? "transparent" : "#0f181f",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 16 }}>{isDeposit ? "📥" : "📤"}</span>
                      <div>
                        <div style={{ fontSize: 13, color: C.text }}>{tx.note || (isDeposit ? "Wpłata" : "Wypłata")}</div>
                        <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono', monospace" }}>
                          {fmtDate(tx.date)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontWeight: 700,
                          fontSize: 14,
                          color: isDeposit ? C.green : C.red,
                        }}
                      >
                        {isDeposit ? "+" : ""}{fmt2(tx.amount)}
                      </span>
                      <button
                        onClick={() => handleDeleteTx(i)}
                        style={{
                          background: "none",
                          border: "none",
                          color: C.muted,
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 6px",
                          borderRadius: 4,
                          opacity: 0.6,
                        }}
                        title="Usuń transakcję"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SavingsModal (okno modalne) ──────────────────────────────────────────────
export function SavingsModal({ account, onClose, onSave, onDelete }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000a",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: "18px 18px 0 0",
          width: "100%",
          maxWidth: 640,
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "24px 20px 32px",
        }}
      >
        {/* Handle + zamknij */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 40,
              height: 4,
              background: C.border,
              borderRadius: 2,
              margin: "0 auto",
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              top: 10,
            }}
          />
          <div style={{ fontSize: 13, color: C.muted }}>Konto oszczędnościowe</div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.muted,
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <SavingsDetailPanel
          account={account}
          onEdit={(updated, openForm) => {
            onSave(updated);
            if (openForm) onClose(); // edycja przez główny formularz
          }}
          onDelete={(id) => { onDelete(id); onClose(); }}
        />
      </div>
    </div>
  );
}

// ─── SavingsFormModal (formularz dodawania/edycji konta) ──────────────────────
export function SavingsFormModal({ existing, onClose, onSave }) {
  const [name, setName] = useState(existing?.name || "");
  const [bankName, setBankName] = useState(existing?.bankName || "");
  const [rate, setRate] = useState(existing?.rate ?? "");
  const [openDate, setOpenDate] = useState(existing?.openDate || today());
  const [initialDeposit, setInitialDeposit] = useState(
    existing
      ? ""
      : ""
  );
  const [note, setNote] = useState(existing?.note || "");

  const handleSave = () => {
    const r = parseFloat(String(rate).replace(",", "."));
    if (!name || isNaN(r) || !openDate) return;

    let transactions = existing?.transactions || [];

    // Jeśli nowe konto i podano wpłatę początkową
    if (!existing && initialDeposit) {
      const dep = parseFloat(String(initialDeposit).replace(",", "."));
      if (!isNaN(dep) && dep > 0) {
        transactions = [{ date: openDate, amount: dep, note: "Wpłata początkowa" }];
      }
    }

    const account = {
      id: existing?.id || Date.now(),
      isSavings: true,
      name,
      bankName,
      rate: r,
      openDate,
      note,
      transactions,
      category: "Konto oszczędnościowe",
      // wartość do portfela (aktualne saldo) obliczana dynamicznie
    };

    onSave(account);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000a",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: "18px 18px 0 0",
          width: "100%",
          maxWidth: 480,
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "28px 20px 36px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'Sora', sans-serif", color: C.text }}>
            {existing ? "Edytuj konto" : "Dodaj konto oszczędnościowe"}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Nazwa konta *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Konto oszcz. PKO"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Nazwa banku</label>
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="np. PKO BP, Santander..."
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Oprocentowanie (% rocznie) *</label>
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="np. 5.5"
                step="0.01"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Data otwarcia *</label>
              <input
                type="date"
                value={openDate}
                onChange={(e) => setOpenDate(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          {!existing && (
            <div>
              <label style={labelStyle}>Wpłata początkowa (opcjonalnie)</label>
              <input
                type="number"
                value={initialDeposit}
                onChange={(e) => setInitialDeposit(e.target.value)}
                placeholder="np. 10000"
                style={inputStyle}
              />
            </div>
          )}
          <div>
            <label style={labelStyle}>Notatka</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="np. Konto z promocją do czerwca"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button
            onClick={onClose}
            style={{
              ...btnBase,
              flex: 1,
              background: "transparent",
              color: C.muted,
              border: `1px solid ${C.border}`,
            }}
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            style={{ ...btnBase, flex: 2, background: C.green, color: "#000", fontWeight: 700 }}
          >
            {existing ? "Zapisz zmiany" : "Dodaj konto"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SavingsRow — wiersz na liście aktywów ────────────────────────────────────
export function SavingsRow({ account, onClick }) {
  const calc = useMemo(() => computeSavings(account), [account]);

  const balance = calc?.currentBalance ?? 0;
  const accrued = calc?.accruedToday ?? 0;
  const daily = calc?.dailyGain ?? 0;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        borderRadius: 12,
        background: C.card,
        border: `1px solid ${C.border}`,
        cursor: "pointer",
        transition: "background 0.15s",
        gap: 12,
        fontFamily: "'Sora', sans-serif",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.card)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: "#00c89622",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          🏦
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: C.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {account.name}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {account.bankName || "Konto oszczędnościowe"} ·{" "}
            <span style={{ color: C.orange }}>{account.rate}%</span>
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontWeight: 700,
            fontSize: 15,
            color: C.text,
          }}
        >
          {fmt2(balance)}
        </div>
        <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>
          +{fmt2(daily)}/dzień
        </div>
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const labelStyle = {
  display: "block",
  fontSize: 11,
  color: "#6b7f96",
  marginBottom: 5,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontFamily: "'Sora', sans-serif",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0f1823",
  border: "1px solid #1e2d3d",
  borderRadius: 8,
  color: "#e8edf3",
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "'Sora', sans-serif",
  outline: "none",
};

const btnBase = {
  padding: "11px 20px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  fontFamily: "'Sora', sans-serif",
  transition: "opacity 0.15s",
};

const menuBtnStyle = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "none",
  border: "none",
  padding: "10px 16px",
  cursor: "pointer",
  color: "#e8edf3",
  fontSize: 14,
  fontFamily: "'Sora', sans-serif",
};

// ─── StatCard helper ──────────────────────────────────────────────────────────
function StatCard({ label, value, accent, big }) {
  return (
    <div
      style={{
        background: "#0f1823",
        borderRadius: 10,
        padding: "12px 14px",
        border: `1px solid #1e2d3d`,
      }}
    >
      <div style={{ fontSize: 11, color: "#6b7f96", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontWeight: 700,
          fontSize: big ? 20 : 16,
          color: accent || "#e8edf3",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Hook do obliczania wartości konta (do użycia w App.jsx) ─────────────────
// Wywołaj: getSavingsValue(account) → number (aktualne saldo)
export function getSavingsValue(account) {
  const calc = computeSavings(account);
  if (!calc) return 0;
  return calc.currentBalance + calc.accruedToday;
}
