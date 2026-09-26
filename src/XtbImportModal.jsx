// src/XtbImportModal.jsx — Import / synchronizacja portfela z eksportu XTB
// Krok 1: wybór pliku (.xlsx albo .zip z xStation 5)
// Krok 2: przypisanie kont XTB do portfeli + podgląd zmian (nowe / zmienione / zamknięte)
import { useState, useMemo, useRef } from "react";

const NEW_PORTFOLIO = "__new__";

const fmtPLN = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n || 0);
const fmtQty = n => (n || 0).toLocaleString("pl-PL", { maximumFractionDigits: 4 });
const fmtDate = iso => iso ? new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

const KIND_STYLE = {
  new:    { label: "Nowa",       color: "#00c896" },
  update: { label: "Zmiana",     color: "#e8e040" },
  remove: { label: "Zamknięta",  color: "#f05060" },
  same:   { label: "Bez zmian",  color: "#5a6a7e" },
};

const accountLabel = acc => `${acc.product === "My Trades" ? "Konto" : acc.product || "Konto"} · ${acc.accountNumber}`;
const changeKey = (accNo, ch) => `${accNo}|${ch.kind}|${ch.pos?.xtbTicker ?? ch.before?.id}`;

// Domyślny portfel dla konta: ten, w którym są już pozycje z tego konta → nazwa zawiera typ konta (IKE) → aktywny
function guessPortfolio(acc, portfolios, allAssets, activePortfolioId) {
  const byAccount = allAssets.find(a => a.xtbAccount === acc.accountNumber)?.portfolioId;
  if (byAccount && portfolios.some(p => p.id === byAccount)) return byAccount;
  const prod = (acc.product || "").toLowerCase();
  if (prod && prod !== "my trades") {
    const byName = portfolios.find(p => p.name.toLowerCase().includes(prod));
    if (byName) return byName.id;
  }
  return activePortfolioId;
}

export function XtbImportModal({ portfolios, allAssets, activePortfolioId, onApply, onClose }) {
  const [lib, setLib] = useState(null);           // moduł xtbImport (ładowany leniwie — SheetJS jest duży)
  const [accounts, setAccounts] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [target, setTarget] = useState({});       // accountNumber → portfolioId | NEW_PORTFOLIO | "" (pomiń)
  const [checked, setChecked] = useState({});     // changeKey → bool
  const [showSame, setShowSame] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const mod = await import("./xtbImport");
      const accs = await mod.parseXtbFile(file);
      const t = {};
      for (const a of accs) t[a.accountNumber] = a.positions.length ? guessPortfolio(a, portfolios, allAssets, activePortfolioId) : "";
      setLib(mod);
      setFileName(file.name);
      setAccounts(accs);
      setTarget(t);
      setChecked({});
    } catch (e) {
      console.error("[XtbImport]", e);
      setError(e.message || "Nie udało się odczytać pliku.");
    }
    setLoading(false);
  }

  // Zmiany per konto (liczone względem aktywów w wybranym portfelu docelowym)
  const diffs = useMemo(() => {
    if (!lib || !accounts) return {};
    const importedNos = new Set(accounts.filter(a => target[a.accountNumber]).map(a => a.accountNumber));
    const out = {};
    for (const acc of accounts) {
      const pid = target[acc.accountNumber];
      if (!pid) continue;
      const inPortfolio = pid === NEW_PORTFOLIO ? [] : allAssets.filter(a =>
        a.portfolioId === pid &&
        // pozycje innego importowanego konta w tym samym portfelu nie są "zamknięte" dla tego konta
        !(a.xtbAccount && a.xtbAccount !== acc.accountNumber && importedNos.has(a.xtbAccount))
      );
      out[acc.accountNumber] = lib.diffXtbAccount(acc, inPortfolio);
    }
    return out;
  }, [lib, accounts, target, allAssets]);

  const isOn = (accNo, ch) => checked[changeKey(accNo, ch)] ?? ch.defaultOn;
  const toggle = (accNo, ch) => setChecked(c => ({ ...c, [changeKey(accNo, ch)]: !isOn(accNo, ch) }));

  const selectedCount = Object.entries(diffs).reduce(
    (s, [accNo, chs]) => s + chs.filter(ch => ch.kind !== "same" && isOn(accNo, ch)).length, 0);

  function apply() {
    const syncedAt = new Date().toISOString();
    const newPortfolios = [];
    const upserts = [];
    const removeIds = new Set();
    let firstTarget = null;

    for (const acc of accounts) {
      let pid = target[acc.accountNumber];
      if (!pid) continue;
      if (pid === NEW_PORTFOLIO) {
        pid = `portfel_${Date.now()}_${acc.accountNumber}`;
        newPortfolios.push({ id: pid, name: `XTB ${acc.product === "My Trades" ? acc.accountNumber : acc.product}` });
      }
      firstTarget ??= pid;
      for (const ch of diffs[acc.accountNumber] || []) {
        if (ch.kind === "same" && ch.before && !ch.before.xtbAccount) {
          // bez zmian liczbowych, ale oznacz pozycję jako powiązaną z kontem XTB (lepsze dopasowanie następnym razem)
          upserts.push({ ...lib.buildStockAsset(ch.pos, ch.before, acc.accountNumber, syncedAt), portfolioId: pid });
          continue;
        }
        if (ch.kind === "same" || !isOn(acc.accountNumber, ch)) continue;
        if (ch.kind === "remove") removeIds.add(ch.before.id);
        else upserts.push({ ...lib.buildStockAsset(ch.pos, ch.before, acc.accountNumber, syncedAt), portfolioId: pid });
      }
    }
    onApply({ newPortfolios, upserts, removeIds, focusPortfolioId: firstTarget });
    onClose();
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: "22px 18px", width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>Import z XTB</div>
          <button onClick={onClose}
            style={{ background: "#161d28", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30 }}>×</button>
        </div>

        {/* ── Krok 1: plik ── */}
        {!accounts && (
          <>
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              style={{
                border: `2px dashed ${dragOver ? "#00c896" : "#2a3a50"}`, borderRadius: 12, padding: "28px 16px",
                textAlign: "center", cursor: "pointer", background: dragOver ? "#00c89610" : "#111720", transition: "all .15s",
              }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>
                {loading ? "Czytam plik…" : "Wybierz lub upuść plik z XTB"}
              </div>
              <div style={{ fontSize: 12, color: "#5a6a7e", marginTop: 4 }}>.xlsx albo .zip — plik nie opuszcza Twojego urządzenia</div>
              <input ref={inputRef} type="file" accept=".xlsx,.zip" style={{ display: "none" }}
                onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
            </div>

            {error && <div style={{ marginTop: 12, fontSize: 13, color: "#f05060" }}>{error}</div>}

            <div style={{ marginTop: 18, fontSize: 12.5, color: "#8a9bb0", lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: "#c8d4e0", marginBottom: 4 }}>Jak pobrać plik?</div>
              <div>1. Zaloguj się do <b>xStation 5</b> (na PC albo w przeglądarce telefonu).</div>
              <div>2. Wejdź w <b>Historia konta</b> → ustaw zakres „od początku” → <b>Eksport</b> (XLSX).</div>
              <div>3. Wybierz tutaj pobrany plik — możesz wrzucić cały .zip z kilkoma kontami (np. zwykłe + IKE).</div>
              <div style={{ marginTop: 6, color: "#5a6a7e" }}>Pełny zakres dat pozwala policzyć dokładny koszt w PLN z dnia zakupu (z opłatą za przewalutowanie).</div>
            </div>
          </>
        )}

        {/* ── Krok 2: podgląd ── */}
        {accounts && (
          <>
            <div style={{ fontSize: 12, color: "#5a6a7e", marginBottom: 12, wordBreak: "break-all" }}>
              {fileName} ·{" "}
              <button onClick={() => { setAccounts(null); setLib(null); }}
                style={{ background: "none", border: "none", color: "#00c896", cursor: "pointer", fontSize: 12, padding: 0 }}>zmień plik</button>
            </div>

            {accounts.map(acc => {
              const chs = diffs[acc.accountNumber] || [];
              const visible = chs.filter(ch => showSame || ch.kind !== "same");
              const sameCount = chs.filter(ch => ch.kind === "same").length;
              return (
                <div key={acc.accountNumber} style={{ background: "#111720", border: "1px solid #1e2a38", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>{accountLabel(acc)}</div>
                      <div style={{ fontSize: 11.5, color: "#5a6a7e" }}>
                        {acc.positions.length} otwartych pozycji{acc.generatedAt ? ` · stan z ${fmtDate(acc.generatedAt)}` : ""}
                      </div>
                    </div>
                    <select value={target[acc.accountNumber] ?? ""}
                      onChange={e => { const v = e.target.value; setTarget(t => ({ ...t, [acc.accountNumber]: v })); setChecked({}); }}
                      style={{ background: "#161d28", color: "#e8f0f8", border: "1px solid #243040", borderRadius: 8, padding: "7px 10px", fontSize: 13, maxWidth: "100%" }}>
                      <option value="">— pomiń to konto —</option>
                      {portfolios.map(p => <option key={p.id} value={p.id}>→ {p.name}</option>)}
                      <option value={NEW_PORTFOLIO}>+ nowy portfel</option>
                    </select>
                  </div>

                  {target[acc.accountNumber] && (
                    <div style={{ marginTop: 10 }}>
                      {visible.length === 0 && (
                        <div style={{ fontSize: 12.5, color: "#5a6a7e", padding: "6px 0" }}>
                          {acc.positions.length ? "Wszystko aktualne — brak zmian." : "Brak otwartych pozycji na tym koncie."}
                        </div>
                      )}
                      {visible.map(ch => <ChangeRow key={changeKey(acc.accountNumber, ch)} ch={ch}
                        on={isOn(acc.accountNumber, ch)} onToggle={() => toggle(acc.accountNumber, ch)} />)}
                      {sameCount > 0 && (
                        <button onClick={() => setShowSame(s => !s)}
                          style={{ background: "none", border: "none", color: "#5a6a7e", cursor: "pointer", fontSize: 12, padding: "6px 0 0" }}>
                          {showSame ? "Ukryj" : "Pokaż"} bez zmian ({sameCount})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button onClick={onClose}
                style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid #2a3a50", background: "transparent", color: "#8a9bb0", fontSize: 13, cursor: "pointer" }}>
                Anuluj
              </button>
              <button onClick={apply} disabled={selectedCount === 0}
                style={{
                  flex: 2, padding: "11px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 700,
                  background: selectedCount ? "#00c896" : "#1e2a38", color: selectedCount ? "#000" : "#5a6a7e",
                  cursor: selectedCount ? "pointer" : "default",
                }}>
                {selectedCount ? `Zastosuj ${selectedCount} ${selectedCount === 1 ? "zmianę" : selectedCount < 5 ? "zmiany" : "zmian"}` : "Brak zmian do zastosowania"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChangeRow({ ch, on, onToggle }) {
  const k = KIND_STYLE[ch.kind];
  const pos = ch.pos;
  const before = ch.before;
  const symbol = pos?.symbol ?? before?.stockSymbol;
  const name = pos?.name ?? before?.name;
  const clickable = ch.kind !== "same";

  let detail;
  if (ch.kind === "new") {
    detail = `${fmtQty(pos.qty)} szt. · koszt ${fmtPLN(pos.paidPLN)}`;
  } else if (ch.kind === "update") {
    const q = Math.abs((before.stockQuantity || 0) - pos.qty) > 1e-6
      ? `${fmtQty(before.stockQuantity)} → ${fmtQty(pos.qty)} szt.` : `${fmtQty(pos.qty)} szt.`;
    detail = `${q} · koszt ${fmtPLN(before.stockPaidPLN)} → ${fmtPLN(pos.paidPLN)}`;
  } else if (ch.kind === "remove") {
    detail = ch.fromThisAccount
      ? `${fmtQty(before.stockQuantity)} szt. — nie ma już w XTB (sprzedane)`
      : `${fmtQty(before.stockQuantity)} szt. — nie ma w pliku (inny broker?)`;
  } else {
    detail = `${fmtQty(pos.qty)} szt. · koszt ${fmtPLN(pos.paidPLN)}`;
  }

  return (
    <div onClick={clickable ? onToggle : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderTop: "1px solid #1a2433",
        cursor: clickable ? "pointer" : "default", opacity: clickable && !on ? 0.45 : 1,
      }}>
      {clickable
        ? <input type="checkbox" checked={on} readOnly style={{ accentColor: k.color, width: 16, height: 16, flexShrink: 0, pointerEvents: "none" }} />
        : <span style={{ width: 16, flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{symbol}</span>
          <span style={{ fontSize: 12, color: "#8a9bb0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: k.color, border: `1px solid ${k.color}50`, borderRadius: 5, padding: "1px 6px" }}>{k.label}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "#5a6a7e", marginTop: 2 }}>{detail}</div>
        {pos?.unsupported && (
          <div style={{ fontSize: 11, color: "#e8a040", marginTop: 2 }}>Giełda {pos.market} nieobsługiwana — cena live może nie działać</div>
        )}
        {pos?.hasEstimates && (
          <div style={{ fontSize: 11, color: "#e8a040", marginTop: 2 }}>Koszt części transz oszacowany (brak operacji w eksporcie — pobierz pełny zakres dat)</div>
        )}
      </div>
    </div>
  );
}
