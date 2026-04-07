// SavingsModal.jsx
// Moduł konta oszczędnościowego dla moj-portfel
// Kapitalizacja miesięczna, naliczanie dzienne ACT/365, historia wpłat/wypłat

import { useState, useMemo, useEffect } from "react";
import { SAVINGS_RATES_DB } from "./savingsRates";

// ─── Stałe kolorów ───────────────────────────────────────────────────────────
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

// Oblicz ile dni minęło od daty
const daysSince = (dateStr) => {
  if (!dateStr) return 0;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
};

// ─── Silnik obliczeń ──────────────────────────────────────────────────────────
const BELKA = 0.19; // podatek od zysków kapitałowych

function computeSavings(account) {
  const { openDate, rate, transactions = [] } = account;
  if (!openDate || rate == null) return null;

  const annualRate = rate / 100;
  const todayStr = today();
  const todayDate = new Date(todayStr);
  const openDateObj = new Date(openDate);

  const sorted = [...transactions].sort((a, b) => (a.date > b.date ? 1 : -1));

  let balance = 0;
  for (const tx of sorted) {
    if (tx.date <= openDate) {
      balance += tx.amount;
    }
  }

  let totalInterestGross = 0;
  let totalInterestNet = 0;
  const months = [];

  let periodStart = new Date(openDateObj);
  let monthIndex = 0;

  while (true) {
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    if (periodEnd > todayDate) break;

    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const periodEndStr = periodEnd.toISOString().slice(0, 10);

    const openBal = balance;

    const txInPeriod = sorted.filter(
      (tx) => tx.date > periodStartStr && tx.date <= periodEndStr
    );
    const txSum = txInPeriod.reduce((s, tx) => s + tx.amount, 0);

    const days = Math.round((periodEnd - periodStart) / 86400000);
    const interestGross = Math.round(openBal * annualRate * (days / 365) * 100) / 100;
    const interestNet = Math.round(interestGross * (1 - BELKA) * 100) / 100;

    // Saldo po kapitalizacji uwzględnia podatek Belki (bank wypłaca netto)
    const closeBal = Math.round((openBal + interestNet + txSum) * 100) / 100;

    months.push({
      label: periodEnd.toLocaleDateString("pl-PL", { month: "long", year: "numeric" }),
      date: periodEndStr,
      openBalance: openBal,
      interestGross,
      interestNet,
      txSum,
      closeBalance: closeBal,
      days,
    });

    totalInterestGross += interestGross;
    totalInterestNet += interestNet;
    balance = closeBal;

    periodStart = new Date(periodEnd);
    monthIndex++;

    if (monthIndex > 600) break;
  }

  const lastCapDate = periodStart.toISOString().slice(0, 10);
  const txAfterCap = sorted.filter((tx) => tx.date > lastCapDate && tx.date <= todayStr);
  const txAfterCapSum = txAfterCap.reduce((s, tx) => s + tx.amount, 0);
  const currentBalance = Math.round((balance + txAfterCapSum) * 100) / 100;
  const daysAccrued = Math.max(0, Math.round((todayDate - periodStart) / 86400000));
  const accruedGross = Math.round(currentBalance * annualRate * (daysAccrued / 365) * 100) / 100;
  const accruedToday = Math.round(accruedGross * (1 - BELKA) * 100) / 100;
  const dailyGainGross = Math.round(currentBalance * annualRate * (1 / 365) * 100) / 100;
  const dailyGain = Math.round(dailyGainGross * (1 - BELKA) * 100) / 100;

  const nextCapDate = new Date(periodStart);
  nextCapDate.setMonth(nextCapDate.getMonth() + 1);

  return {
    currentBalance,
    accruedToday,
    accruedGross,
    dailyGain,
    dailyGainGross,
    totalInterestNet,
    totalInterestGross,
    lastCapDate,
    nextCapDate: nextCapDate.toISOString().slice(0, 10),
    months,
    daysAccrued,
  };
}

function projectBalance(currentBalance, rate, months) {
  const annualRate = rate / 100;
  let bal = currentBalance;
  for (let i = 0; i < months; i++) {
    const interestGross = Math.round(bal * annualRate * (30.44 / 365) * 100) / 100;
    const interestNet = Math.round(interestGross * (1 - BELKA) * 100) / 100;
    bal = Math.round((bal + interestNet) * 100) / 100;
  }
  return bal;
}

// ─── SavingsDetailPanel ───────────────────────────────────────────────────────
function SavingsDetailPanel({ account, onEdit, onDelete, onOpenEditForm, onMove }) {
  const calc = useMemo(() => computeSavings(account), [account]);
  const [projMonths, setProjMonths] = useState(12);
  const [showHistory, setShowHistory] = useState(false);
  const [showTxForm, setShowTxForm] = useState(false);
  const [txDate, setTxDate] = useState(today());
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  // Sprawdź czy konto może mieć wygasającą promocję
  const promoInfo = useMemo(() => {
    if (!account.openDate || !account.promoEndDate) return null;
    const daysLeft = Math.ceil((new Date(account.promoEndDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return { expired: true, daysLeft: 0 };
    return { expired: false, daysLeft };
  }, [account]);

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
    accruedGross,
    dailyGain,
    dailyGainGross,
    totalInterestNet,
    totalInterestGross,
    lastCapDate,
    nextCapDate,
    months,
    daysAccrued,
  } = calc;

  const projectedBalance = projectBalance(currentBalance + accruedToday, account.rate, projMonths);
  const projectedGain = projectedBalance - (currentBalance + accruedToday);

  const projOptions = [
    { label: "1 mies.", value: 1 },
    { label: "3 mies.", value: 3 },
    { label: "6 mies.", value: 6 },
    { label: "1 rok", value: 12 },
    { label: "2 lata", value: 24 },
    { label: "5 lat", value: 60 },
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
    const sortedTxs = [...(account.transactions || [])].sort((a, b) => (a.date > b.date ? -1 : 1));
    const txToRemove = sortedTxs[idx];
    const newTxs = (account.transactions || []).filter((tx) => tx !== txToRemove);
    onEdit({ ...account, transactions: newTxs });
  };

  return (
    <div style={{ fontFamily: "'Sora', sans-serif", color: C.text }}>
      {/* Nagłówek */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
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
              <button onClick={() => { setMenuOpen(false); onOpenEditForm?.(account); }} style={menuBtnStyle}>
                Edytuj
              </button>
              {onMove && (
                <button onClick={() => { setMenuOpen(false); onMove(account); }} style={menuBtnStyle}>
                  Przenieś
                </button>
              )}
              <button onClick={() => { setMenuOpen(false); onDelete(account.id); }} style={{ ...menuBtnStyle, color: C.red }}>
                🗑 Usuń
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Alert o promocji */}
      {promoInfo && !promoInfo.expired && promoInfo.daysLeft <= 30 && (
        <div style={{
          background: C.orange + "20",
          border: `1px solid ${C.orange}`,
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 16,
          fontSize: 13,
        }}>
          ⚠️ <strong>Promocja kończy się za {promoInfo.daysLeft} dni</strong>
          {account.rateAfterPromo && (
            <span style={{ color: C.muted }}> · stawka spadnie do {account.rateAfterPromo}%</span>
          )}
        </div>
      )}

      {/* Kluczowe liczby */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <StatCard label="Aktualne saldo" value={fmt2(currentBalance)} big accent={C.green} />
        <StatCard
          label={`Narosłe odsetki netto (${daysAccrued} dni)`}
          value={"+" + fmt2(accruedToday)}
          sub={"brutto: +" + fmt2(accruedGross)}
          accent={C.green}
        />
        <StatCard
          label="Dzienny przyrost netto"
          value={"+" + fmt2(dailyGain)}
          sub={"brutto: +" + fmt2(dailyGainGross)}
          accent={C.orange}
        />
        <StatCard
          label="Odsetki netto łącznie"
          value={"+" + fmt2(totalInterestNet)}
          sub={"brutto: +" + fmt2(totalInterestGross)}
          accent={C.accent2}
        />
      </div>

      {/* Info o kapitalizacji */}
      <div style={{
        background: "#0f1823",
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 20,
        fontSize: 13,
        color: C.muted,
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
      }}>
        <span>📅 Ostatnia kap.: <span style={{ color: C.text }}>{fmtDate(lastCapDate)}</span></span>
        <span>⏭ Następna: <span style={{ color: C.green }}>{fmtDate(nextCapDate)}</span></span>
        <span>📂 Otwarto: <span style={{ color: C.text }}>{fmtDate(account.openDate)}</span></span>
      </div>

      {/* Prognoza */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
          📈 Prognoza zysku
        </div>
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
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: C.text }}>
              {fmt0(projectedBalance)}
            </div>
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>Szacowany zysk</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: C.green }}>
              +{fmt0(projectedGain)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
          * Zakłada stałe oprocentowanie {account.rate}%, odsetki po potrąceniu podatku Belki (19%)
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
            {showHistory ? "▲" : "▼"} Historia kapitalizacji ({months.length})
          </button>
          {showHistory && (
            <div style={{ marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr",
                padding: "8px 14px",
                background: "#0f1823",
                fontSize: 11,
                color: C.muted,
                textTransform: "uppercase",
                fontWeight: 600,
              }}>
                <span>Miesiąc</span>
                <span style={{ textAlign: "right" }}>Przed</span>
                <span style={{ textAlign: "right" }}>Brutto</span>
                <span style={{ textAlign: "right" }}>Netto</span>
                <span style={{ textAlign: "right" }}>Po</span>
              </div>
              {[...months].reverse().map((m, i) => (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr",
                  padding: "10px 14px",
                  borderTop: `1px solid ${C.border}`,
                  fontSize: 13,
                  background: i % 2 === 0 ? "transparent" : "#0f181f",
                }}>
                  <span style={{ color: C.muted }}>{m.label}</span>
                  <span style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{fmt0(m.openBalance)}</span>
                  <span style={{ textAlign: "right", color: "#4a5a6e", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>+{fmt2(m.interestGross)}</span>
                  <span style={{ textAlign: "right", color: C.green, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>+{fmt2(m.interestNet)}</span>
                  <span style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 600 }}>{fmt0(m.closeBalance)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Historia wpłat/wypłat */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            💳 Wpłaty / wypłaty
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

        {showTxForm && (
          <div style={{
            background: "#0f1823",
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={labelStyle}>Data</label>
                <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label style={labelStyle}>Kwota (+/-)</label>
                <input type="number" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="5000 lub -2000" style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Notatka</label>
              <input type="text" value={txNote} onChange={(e) => setTxNote(e.target.value)} placeholder="np. Premia" style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowTxForm(false)} style={{ ...btnBase, background: "transparent", color: C.muted, border: `1px solid ${C.border}` }}>
                Anuluj
              </button>
              <button onClick={handleAddTx} style={{ ...btnBase, background: C.green, color: "#000" }}>
                Zapisz
              </button>
            </div>
          </div>
        )}

        {(account.transactions || []).length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "16px 0" }}>
            Brak transakcji
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            {[...(account.transactions || [])].sort((a, b) => (a.date > b.date ? -1 : 1)).map((tx, i) => {
              const isDeposit = tx.amount > 0;
              return (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
                  background: i % 2 === 0 ? "transparent" : "#0f181f",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 16 }}>{isDeposit ? "📥" : "📤"}</span>
                    <div>
                      <div style={{ fontSize: 13, color: C.text }}>{tx.note || (isDeposit ? "Wpłata" : "Wypłata")}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono', monospace" }}>{fmtDate(tx.date)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 14, color: isDeposit ? C.green : C.red }}>
                      {isDeposit ? "+" : ""}{fmt2(tx.amount)}
                    </span>
                    <button onClick={() => handleDeleteTx(i)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 14, opacity: 0.6 }}>✕</button>
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

// ─── SavingsModal ─────────────────────────────────────────────────────────────
export function SavingsModal({ account, onClose, onSave, onDelete, onOpenEditForm, onMove }) {
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
      <div style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: "18px 18px 0 0",
        width: "100%",
        maxWidth: 640,
        maxHeight: "92vh",
        overflowY: "auto",
        padding: "24px 20px 32px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: C.muted }}>Konto oszczędnościowe</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <SavingsDetailPanel
          account={account}
          onEdit={(updated) => onSave(updated)}
          onDelete={(id) => { onDelete(id); onClose(); }}
          onOpenEditForm={(acc) => { onClose(); onOpenEditForm?.(acc); }}
          onMove={onMove}
        />
      </div>
    </div>
  );
}

// ─── SavingsFormModal ─────────────────────────────────────────────────────────
// ZASADA: Data otwarcia automatycznie determinuje stawkę. Zero dodatkowych kliknięć.
// - Konto nowe (< promoDays) → stawka promo + info kiedy się kończy
// - Konto stare (> promoDays) → stawka standard
// - Użytkownik zawsze może nadpisać stawkę ręcznie

export function SavingsFormModal({ existing, onClose, onSave }) {
  const [name, setName] = useState(existing?.name || "");
  const [bankName, setBankName] = useState(existing?.bankName || "");
  const [rate, setRate] = useState(existing?.rate ?? "");
  const [openDate, setOpenDate] = useState(existing?.openDate || today());
  const [initialDeposit, setInitialDeposit] = useState("");
  const [note, setNote] = useState(existing?.note || "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  // Wybrany bank z bazy (do automatycznego obliczania stawki)
  const [selectedBank, setSelectedBank] = useState(null);
  // Czy stawka została ręcznie nadpisana przez użytkownika
  const [rateManuallySet, setRateManuallySet] = useState(false);

  const suggestions = useMemo(() => {
    if (!bankName || bankName.length < 2) return [];
    const lower = bankName.toLowerCase();
    return SAVINGS_RATES_DB.accounts.filter(acc => 
      acc.bank.toLowerCase().includes(lower) ||
      acc.name.toLowerCase().includes(lower)
    );
  }, [bankName]);

  // Oblicz właściwą stawkę na podstawie daty i wybranego banku
  const computedRate = useMemo(() => {
    if (!selectedBank) return null;
    
    const daysOld = daysSince(openDate);
    const hasPromo = selectedBank.ratePromo && selectedBank.ratePromo > 0;
    const promoDays = selectedBank.promoDays || 90; // domyślnie 90 dni
    
    if (hasPromo && daysOld < promoDays) {
      // Konto w okresie promocji
      return {
        rate: selectedBank.ratePromo,
        isPromo: true,
        daysLeft: promoDays - daysOld,
        promoEndDate: (() => {
          const end = new Date(openDate);
          end.setDate(end.getDate() + promoDays);
          return end.toISOString().slice(0, 10);
        })(),
        rateAfterPromo: selectedBank.rateStandard,
      };
    } else {
      // Konto po promocji lub bez promocji
      return {
        rate: selectedBank.rateStandard,
        isPromo: false,
        daysLeft: 0,
        promoEndDate: null,
        rateAfterPromo: null,
      };
    }
  }, [selectedBank, openDate]);

  // Gdy wybieramy sugestię — automatycznie wypełnij wszystko
  const handleSelectSuggestion = (acc) => {
    setShowSuggestions(false);
    setBankName(acc.bank);
    setName(acc.name);
    setSelectedBank(acc);
    setRateManuallySet(false); // reset — pozwól automatyce działać
  };

  // Automatycznie aktualizuj stawkę gdy zmieni się computedRate (i nie jest ręcznie ustawiona)
  useEffect(() => {
    if (computedRate && !rateManuallySet) {
      setRate(computedRate.rate);
      
      // Automatycznie ustaw notatkę z info o promocji
      if (computedRate.isPromo && computedRate.daysLeft > 0) {
        const promoEndFormatted = fmtDate(computedRate.promoEndDate);
        setNote(`Promocja do ${promoEndFormatted}, potem ${computedRate.rateAfterPromo}%`);
      } else if (selectedBank && !computedRate.isPromo && selectedBank.ratePromo) {
        setNote("Promocja wygasła");
      }
    }
  }, [computedRate, rateManuallySet, selectedBank]);

  // Gdy użytkownik ręcznie zmienia stawkę
  const handleRateChange = (e) => {
    setRate(e.target.value);
    setRateManuallySet(true); // użytkownik nadpisał automatykę
  };

  const handleSave = () => {
    const r = parseFloat(String(rate).replace(",", "."));
    if (!name || isNaN(r) || !openDate) return;

    let transactions = existing?.transactions || [];

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
      // Zachowaj info o promocji tylko jeśli jest aktywna
      promoEndDate: computedRate?.isPromo ? computedRate.promoEndDate : null,
      rateAfterPromo: computedRate?.isPromo ? computedRate.rateAfterPromo : null,
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
        onClick={(e) => {
          e.stopPropagation();
          setShowSuggestions(false);
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'Sora', sans-serif", color: C.text }}>
            {existing ? "Edytuj konto" : "Dodaj konto oszczędnościowe"}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Nazwa banku z sugestiami */}
          <div style={{ position: "relative" }}>
            <label style={labelStyle}>Nazwa banku</label>
            <input
              value={bankName}
              onChange={(e) => {
                setBankName(e.target.value);
                setShowSuggestions(true);
                setSelectedBank(null);
                setRateManuallySet(false);
              }}
              onFocus={() => bankName.length >= 2 && setShowSuggestions(true)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Wpisz nazwę banku..."
              style={inputStyle}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  marginTop: 4,
                  zIndex: 10,
                  maxHeight: 220,
                  overflowY: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {suggestions.map((acc, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); handleSelectSuggestion(acc); }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "10px 12px",
                      background: "none",
                      border: "none",
                      borderBottom: i < suggestions.length - 1 ? `1px solid ${C.border}` : "none",
                      textAlign: "left",
                      cursor: "pointer",
                      color: C.text,
                      fontFamily: "'Sora', sans-serif",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{acc.bank}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{acc.name}</div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      {acc.ratePromo ? (
                        <>
                          <span style={{ color: C.orange }}>{acc.ratePromo}%</span>
                          <span style={{ color: C.muted }}> ({acc.promoDays || 90}d) → </span>
                          <span style={{ color: C.muted }}>{acc.rateStandard}%</span>
                        </>
                      ) : (
                        <span style={{ color: C.green }}>{acc.rateStandard}%</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Nazwa konta */}
          <div>
            <label style={labelStyle}>Nazwa konta *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Moje oszczędności" style={inputStyle} />
          </div>
          
          {/* Data otwarcia — KLUCZOWA dla obliczenia stawki */}
          <div>
            <label style={labelStyle}>Data otwarcia *</label>
            <input 
              type="date" 
              value={openDate} 
              onChange={(e) => {
                setOpenDate(e.target.value);
                setRateManuallySet(false); // pozwól przeliczyć stawkę
              }} 
              style={inputStyle} 
            />
            {/* Info o obliczonej stawce */}
            {selectedBank && computedRate && !rateManuallySet && (
              <div style={{ 
                marginTop: 6, 
                padding: "8px 10px", 
                background: computedRate.isPromo ? C.orange + "15" : "#0f1823",
                borderRadius: 6,
                fontSize: 12,
                color: computedRate.isPromo ? C.orange : C.muted,
                border: `1px solid ${computedRate.isPromo ? C.orange + "40" : C.border}`,
              }}>
                {computedRate.isPromo ? (
                  <>🔥 Promocja aktywna — jeszcze {computedRate.daysLeft} dni ({computedRate.rate}%)</>
                ) : (
                  <>📊 Stawka standardowa ({computedRate.rate}%){selectedBank.ratePromo && " — promocja wygasła"}</>
                )}
              </div>
            )}
          </div>

          {/* Oprocentowanie — automatyczne lub ręczne */}
          <div>
            <label style={labelStyle}>
              Oprocentowanie (% rocznie) *
              {rateManuallySet && <span style={{ color: C.orange, marginLeft: 8, fontWeight: 400 }}>ręczne</span>}
            </label>
            <input
              type="number"
              value={rate}
              onChange={handleRateChange}
              placeholder="np. 5.5"
              step="0.01"
              style={{ 
                ...inputStyle,
                borderColor: rate ? C.green : C.border,
              }}
            />
            {/* Szybkie przyciski do zmiany stawki jeśli bank wybrany */}
            {selectedBank && selectedBank.ratePromo && (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  onClick={() => { setRate(selectedBank.ratePromo); setRateManuallySet(true); }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: "transparent",
                    color: C.orange,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "'Sora', sans-serif",
                  }}
                >
                  {selectedBank.ratePromo}% promo
                </button>
                <button
                  onClick={() => { setRate(selectedBank.rateStandard); setRateManuallySet(true); }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: "transparent",
                    color: C.muted,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "'Sora', sans-serif",
                  }}
                >
                  {selectedBank.rateStandard}% standard
                </button>
              </div>
            )}
          </div>

          {/* Wpłata początkowa */}
          {!existing && (
            <div>
              <label style={labelStyle}>Wpłata początkowa</label>
              <input type="number" value={initialDeposit} onChange={(e) => setInitialDeposit(e.target.value)} placeholder="np. 10000" style={inputStyle} />
            </div>
          )}

          {/* Notatka */}
          <div>
            <label style={labelStyle}>Notatka</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. warunki promocji" style={inputStyle} />
          </div>
        </div>

        <div style={{ fontSize: 10, color: C.muted, marginTop: 12, textAlign: "center" }}>
          Stawki z Bankier.pl · {SAVINGS_RATES_DB.lastUpdated}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...btnBase, flex: 1, background: "transparent", color: C.muted, border: `1px solid ${C.border}` }}>
            Anuluj
          </button>
          <button onClick={handleSave} style={{ ...btnBase, flex: 2, background: C.green, color: "#000", fontWeight: 700 }}>
            {existing ? "Zapisz zmiany" : "Dodaj konto"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SavingsRow ───────────────────────────────────────────────────────────────
export function SavingsRow({ account, color, onClick }) {
  const calc = useMemo(() => computeSavings(account), [account]);
  const balance = calc?.currentBalance ?? 0;
  const accrued = calc?.accruedToday ?? 0;
  const daily = calc?.dailyGain ?? 0;

  // Sprawdź czy promocja wkrótce wygasa
  const promoWarning = useMemo(() => {
    if (!account.promoEndDate) return null;
    const daysLeft = Math.ceil((new Date(account.promoEndDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return "⚠️";
    if (daysLeft <= 14) return `⏰ ${daysLeft}d`;
    return null;
  }, [account.promoEndDate]);

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 12,
        marginBottom: 8,
        background: C.card,
        border: `1px solid ${C.border}`,
        cursor: "pointer",
        transition: "background 0.15s",
        fontFamily: "'Sora', sans-serif",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.card)}
    >
      <div style={{ width: 4, borderRadius: 2, background: color || C.green, flexShrink: 0, alignSelf: "stretch" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: C.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            {account.name}
            {promoWarning && <span style={{ fontSize: 11, color: C.orange }}>{promoWarning}</span>}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {account.bankName || "Konto"} · <span style={{ color: C.orange }}>{account.rate}%</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 15, color: C.text }}>
            {fmt2(balance + accrued)}
          </div>
          <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>
            +{fmt2(daily)}/dzień
          </div>
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

function StatCard({ label, value, sub, accent, big }) {
  return (
    <div style={{ background: "#0f1823", borderRadius: 10, padding: "12px 14px", border: `1px solid #1e2d3d` }}>
      <div style={{ fontSize: 11, color: "#6b7f96", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: big ? 20 : 16, color: accent || "#e8edf3" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#4a5a6e", marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function getSavingsValue(account) {
  const calc = computeSavings(account);
  if (!calc) return 0;
  return calc.currentBalance + calc.accruedToday;
}
