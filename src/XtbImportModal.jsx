// src/XtbImportModal.jsx — Import / synchronizacja portfela z XTB
// Źródła:
//   - plik z xStation 5 (.xlsx albo .zip z kilkoma kontami) — dokładny, czytany lokalnie
//   - zrzuty ekranu z aplikacji XTB (telefon) — odczyt przez api/xtb-screenshot (Groq, darmowy plan)
// Oba trafiają do tego samego podglądu: przypisanie do portfela + nowe / zmienione / zamknięte.
import { useState, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { KIND_LABEL } from "./realizedLog";

const NEW_PORTFOLIO = "__new__";
const MAX_SHOTS = 3; // limit obrazów na zapytanie w modelu Groq

const fmtPLN = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n || 0);
const fmtQty = n => (n || 0).toLocaleString("pl-PL", { maximumFractionDigits: 4 });
const fmtDate = iso => iso ? new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

const KIND_STYLE = {
  new:    { label: "Nowa",       color: "#00c896" },
  update: { label: "Zmiana",     color: "#e8e040" },
  remove: { label: "Zamknięta",  color: "#f05060" },
  same:   { label: "Bez zmian",  color: "#5a6a7e" },
};

const accountLabel = acc => acc.fromScreenshot
  ? "Zrzut ekranu"
  : `${acc.product === "My Trades" ? "Konto" : acc.product || "Konto"} · ${acc.accountNumber}`;
const changeKey = (accKey, ch) => `${accKey}|${ch.kind}|${ch.pos?.xtbTicker ?? ch.before?.id}`;

// Domyślny portfel dla konta: ten, w którym są już pozycje z tego konta → nazwa zawiera typ konta (IKE) → aktywny
function guessPortfolio(acc, portfolios, allAssets, activePortfolioId) {
  const byAccount = allAssets.find(a => a.xtbAccount && a.xtbAccount === acc.accountNumber)?.portfolioId;
  if (byAccount && portfolios.some(p => p.id === byAccount)) return byAccount;
  const prod = (acc.product || "").toLowerCase();
  if (prod && !acc.fromScreenshot && prod !== "my trades") {
    const byName = portfolios.find(p => p.name.toLowerCase().includes(prod));
    if (byName) return byName.id;
  }
  return activePortfolioId;
}

// Zrzut nie zawiera numeru konta — przyjmij konto XTB, z którego pochodzi większość pozycji portfela
function inferAccountNumber(allAssets, portfolioId) {
  const counts = {};
  for (const a of allAssets) if (a.portfolioId === portfolioId && a.xtbAccount) counts[a.xtbAccount] = (counts[a.xtbAccount] || 0) + 1;
  return Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
}

// Zmniejsz zrzut do rozsądnego rozmiaru i zamień na JPEG (limit body funkcji Vercel to 4,5 MB)
async function compressImage(file, maxSide = 2000, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Nie udało się wczytać obrazu ${file.name}`));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { media_type: "image/jpeg", data: dataUrl.split(",")[1], preview: dataUrl, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function XtbImportModal({ portfolios, allAssets, activePortfolioId, realized, onApply, onClose }) {
  const [source, setSource] = useState("file");   // "file" | "screenshot"
  const [lib, setLib] = useState(null);           // moduł xtbImport (ładowany leniwie — SheetJS jest duży)
  const [accounts, setAccounts] = useState(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [shots, setShots] = useState([]);         // skompresowane zrzuty do wysłania
  const [target, setTarget] = useState({});       // acc.key → portfolioId | NEW_PORTFOLIO | "" (pomiń)
  const [checked, setChecked] = useState({});     // changeKey → bool
  const [showSame, setShowSame] = useState(false);
  const [skipRealized, setSkipRealized] = useState({}); // acc.key → true: nie dopisuj zrealizowanych do dziennika
  const fileRef = useRef(null);
  const shotRef = useRef(null);

  // Konto z poprawnym numerem dla wybranego portfela (dla zrzutu numer zależy od celu)
  const effective = (acc, pid) => acc.fromScreenshot
    ? { ...acc, accountNumber: pid && pid !== NEW_PORTFOLIO ? inferAccountNumber(allAssets, pid) : null }
    : acc;

  function showPreview(mod, accs, label) {
    const t = {};
    for (const a of accs) t[a.key] = a.positions.length ? guessPortfolio(a, portfolios, allAssets, activePortfolioId) : "";
    setLib(mod);
    setSourceLabel(label);
    setAccounts(accs);
    setTarget(t);
    setChecked({});
  }

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const mod = await import("./xtbImport");
      const accs = (await mod.parseXtbFile(file)).map(a => ({ ...a, key: a.accountNumber }));
      showPreview(mod, accs, file.name);
    } catch (e) {
      console.error("[XtbImport]", e);
      setError(e.message || "Nie udało się odczytać pliku.");
    }
    setLoading(false);
  }

  async function addShots(fileList) {
    const files = [...(fileList || [])].filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    setError(null);
    try {
      const compressed = await Promise.all(files.map(f => compressImage(f)));
      setShots(s => [...s, ...compressed].slice(0, MAX_SHOTS));
      if (shots.length + compressed.length > MAX_SHOTS) setError(`Maksymalnie ${MAX_SHOTS} zrzuty naraz.`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function readShots() {
    setError(null);
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const res = await fetch("/api/xtb-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ images: shots.map(({ media_type, data }) => ({ media_type, data })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Błąd serwera (${res.status})`);
      if (!json.positions?.length) throw new Error("Nie znaleziono żadnych pozycji na zrzutach.");
      const mod = await import("./xtbImport");
      const acc = { ...mod.accountFromScreenshot(json, null), key: "screenshot" };
      setNotes(json.notes || "");
      showPreview(mod, [acc], `${shots.length} ${shots.length === 1 ? "zrzut" : "zrzuty"} ekranu`);
    } catch (e) {
      console.error("[XtbImport]", e);
      setError(e.message || "Nie udało się odczytać zrzutów.");
    }
    setLoading(false);
  }

  // Zmiany per konto (liczone względem aktywów w wybranym portfelu docelowym)
  const diffs = useMemo(() => {
    if (!lib || !accounts) return {};
    const importedNos = new Set(accounts.filter(a => target[a.key] && !a.fromScreenshot).map(a => a.accountNumber));
    const out = {};
    for (const raw of accounts) {
      const pid = target[raw.key];
      if (!pid) continue;
      const acc = effective(raw, pid);
      const inPortfolio = pid === NEW_PORTFOLIO ? [] : allAssets.filter(a =>
        a.portfolioId === pid &&
        // pozycje innego importowanego konta w tym samym portfelu nie są "zamknięte" dla tego konta
        !(a.xtbAccount && a.xtbAccount !== acc.accountNumber && importedNos.has(a.xtbAccount))
      );
      out[raw.key] = lib.diffXtbAccount(acc, inPortfolio);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, accounts, target, allAssets]);

  const isOn = (accKey, ch) => checked[changeKey(accKey, ch)] ?? ch.defaultOn;
  const toggle = (accKey, ch) => setChecked(c => ({ ...c, [changeKey(accKey, ch)]: !isOn(accKey, ch) }));

  const selectedCount = Object.entries(diffs).reduce(
    (s, [accKey, chs]) => s + chs.filter(ch => ch.kind !== "same" && isOn(accKey, ch)).length, 0);

  // Zrealizowane wyniki (sprzedaże, dywidendy, odsetki) z pliku — tylko te, których jeszcze nie ma w dzienniku
  const knownIds = useMemo(() => new Set((realized || []).map(e => e.id)), [realized]);
  const newRealized = acc => (acc.realized || []).filter(e => !knownIds.has(e.id));
  const realizedOn = acc => !!target[acc.key] && !skipRealized[acc.key] && newRealized(acc).length > 0;
  const realizedCount = (accounts || []).reduce((s, acc) => s + (realizedOn(acc) ? newRealized(acc).length : 0), 0);

  function apply() {
    const syncedAt = new Date().toISOString();
    const newPortfolios = [];
    const realizedAdds = [];
    const upserts = [];
    const removeIds = new Set();
    let firstTarget = null;

    for (const raw of accounts) {
      let pid = target[raw.key];
      if (!pid) continue;
      const acc = effective(raw, pid);
      if (pid === NEW_PORTFOLIO) {
        pid = `portfel_${Date.now()}_${raw.key}`;
        const wrapper = String(acc.product || "").toLowerCase();
        newPortfolios.push({ id: pid, name: acc.fromScreenshot ? "XTB" : `XTB ${acc.product === "My Trades" ? acc.accountNumber : acc.product}`, ...(wrapper === "ike" || wrapper === "ikze" ? { taxWrapper: wrapper } : {}) });
      }
      firstTarget ??= pid;
      if (realizedOn(raw)) realizedAdds.push(...newRealized(raw).map(e => ({ ...e, portfolioId: pid })));
      for (const ch of diffs[raw.key] || []) {
        if (ch.kind === "same" && ch.before && !ch.before.xtbAccount && !acc.fromScreenshot) {
          // bez zmian liczbowych, ale oznacz pozycję jako powiązaną z kontem XTB (lepsze dopasowanie następnym razem)
          upserts.push({ ...lib.buildStockAsset(ch.pos, ch.before, acc.accountNumber, syncedAt), portfolioId: pid });
          continue;
        }
        if (ch.kind === "same" || !isOn(raw.key, ch)) continue;
        if (ch.kind === "remove") removeIds.add(ch.before.id);
        else upserts.push({ ...lib.buildStockAsset(ch.pos, ch.before, acc.accountNumber, syncedAt), portfolioId: pid });
      }
    }
    onApply({ newPortfolios, upserts, removeIds, realized: realizedAdds, focusPortfolioId: firstTarget });
    onClose();
  }

  function reset() {
    setAccounts(null);
    setLib(null);
    setNotes("");
    setError(null);
  }

  const tabBtn = active => ({
    flex: 1, padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
    background: active ? "#1e2a38" : "transparent", color: active ? "#e8f0f8" : "#5a6a7e", fontFamily: "inherit",
  });

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: "22px 18px", width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>Import z XTB</div>
          <button onClick={onClose}
            style={{ background: "#161d28", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30 }}>×</button>
        </div>

        {/* ── Krok 1: źródło ── */}
        {!accounts && (
          <>
            <div style={{ display: "flex", gap: 4, background: "#111720", border: "1px solid #1e2a38", borderRadius: 10, padding: 4, marginBottom: 14 }}>
              <button style={tabBtn(source === "file")} onClick={() => { setSource("file"); setError(null); }}>📄 Plik z xStation</button>
              <button style={tabBtn(source === "screenshot")} onClick={() => { setSource("screenshot"); setError(null); }}>📱 Zrzut ekranu</button>
            </div>

            {source === "file" && (
              <>
                <div
                  onClick={() => fileRef.current?.click()}
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
                  <input ref={fileRef} type="file" accept=".xlsx,.zip" style={{ display: "none" }}
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

            {source === "screenshot" && (
              <>
                {shots.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    {shots.map((s, i) => (
                      <div key={i} style={{ position: "relative", width: 76, height: 130, borderRadius: 8, overflow: "hidden", border: "1px solid #2a3a50", background: "#111720" }}>
                        <img src={s.preview} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                        <button onClick={() => setShots(ss => ss.filter((_, j) => j !== i))} aria-label="Usuń zrzut"
                          style={{ position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: 11, border: "none", background: "rgba(0,0,0,.7)", color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: "22px", padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                {shots.length < MAX_SHOTS && (
                  <div
                    onClick={() => shotRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); addShots(e.dataTransfer.files); }}
                    style={{
                      border: `2px dashed ${dragOver ? "#00c896" : "#2a3a50"}`, borderRadius: 12, padding: shots.length ? "14px 16px" : "28px 16px",
                      textAlign: "center", cursor: "pointer", background: dragOver ? "#00c89610" : "#111720", transition: "all .15s",
                    }}>
                    {!shots.length && <div style={{ fontSize: 28, marginBottom: 6 }}>📱</div>}
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>
                      {shots.length ? "+ Dodaj kolejny zrzut" : "Wybierz zrzuty ekranu z aplikacji XTB"}
                    </div>
                    {!shots.length && <div style={{ fontSize: 12, color: "#5a6a7e", marginTop: 4 }}>do {MAX_SHOTS} zrzutów, jeśli lista pozycji jest długa</div>}
                    <input ref={shotRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                      onChange={e => { addShots(e.target.files); e.target.value = ""; }} />
                  </div>
                )}

                {error && <div style={{ marginTop: 12, fontSize: 13, color: "#f05060" }}>{error}</div>}

                {shots.length > 0 && (
                  <button onClick={readShots} disabled={loading}
                    style={{
                      width: "100%", marginTop: 12, padding: "12px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 700,
                      background: loading ? "#1e2a38" : "#00c896", color: loading ? "#8a9bb0" : "#000", cursor: loading ? "default" : "pointer",
                    }}>
                    {loading ? "Odczytuję pozycje… (do ~30 s)" : `Odczytaj pozycje (${shots.length})`}
                  </button>
                )}

                <div style={{ marginTop: 18, fontSize: 12.5, color: "#8a9bb0", lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 600, color: "#c8d4e0", marginBottom: 4 }}>Jak zrobić zrzut?</div>
                  <div>1. W aplikacji XTB otwórz listę <b>otwartych pozycji</b> (portfel).</div>
                  <div>2. Zrób zrzut ekranu; jeśli lista się nie mieści — przewiń i zrób kolejny.</div>
                  <div>3. Wybierz tu zrzuty i kliknij „Odczytaj pozycje”. Przed zapisem zobaczysz listę zmian.</div>
                  <div style={{ marginTop: 6, color: "#5a6a7e" }}>Zrzuty są wysyłane do odczytu przez AI (Groq). Koszt zakupu ze zrzutu jest przybliżony — do dokładnych transz użyj pliku z xStation.</div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Krok 2: podgląd ── */}
        {accounts && (
          <>
            <div style={{ fontSize: 12, color: "#5a6a7e", marginBottom: 12, wordBreak: "break-all" }}>
              {sourceLabel} ·{" "}
              <button onClick={reset}
                style={{ background: "none", border: "none", color: "#00c896", cursor: "pointer", fontSize: 12, padding: 0 }}>
                {accounts[0]?.fromScreenshot ? "zmień zrzuty" : "zmień plik"}
              </button>
            </div>

            {notes && (
              <div style={{ fontSize: 12, color: "#e8a040", background: "#e8a04012", border: "1px solid #e8a04040", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
                Uwaga z odczytu: {notes}
              </div>
            )}

            {accounts.map(acc => {
              const chs = diffs[acc.key] || [];
              const visible = chs.filter(ch => showSame || ch.kind !== "same");
              const sameCount = chs.filter(ch => ch.kind === "same").length;
              return (
                <div key={acc.key} style={{ background: "#111720", border: "1px solid #1e2a38", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>{accountLabel(acc)}</div>
                      <div style={{ fontSize: 11.5, color: "#5a6a7e" }}>
                        {acc.positions.length} {acc.fromScreenshot ? "odczytanych" : "otwartych"} pozycji{acc.generatedAt ? ` · stan z ${fmtDate(acc.generatedAt)}` : ""}
                      </div>
                    </div>
                    <select value={target[acc.key] ?? ""}
                      onChange={e => { const v = e.target.value; setTarget(t => ({ ...t, [acc.key]: v })); setChecked({}); }}
                      style={{ background: "#161d28", color: "#e8f0f8", border: "1px solid #243040", borderRadius: 8, padding: "7px 10px", fontSize: 13, maxWidth: "100%" }}>
                      <option value="">— pomiń {acc.fromScreenshot ? "" : "to konto "}—</option>
                      {portfolios.map(p => <option key={p.id} value={p.id}>→ {p.name}</option>)}
                      <option value={NEW_PORTFOLIO}>+ nowy portfel</option>
                    </select>
                  </div>

                  {target[acc.key] && (
                    <div style={{ marginTop: 10 }}>
                      {visible.length === 0 && (
                        <div style={{ fontSize: 12.5, color: "#5a6a7e", padding: "6px 0" }}>
                          {acc.positions.length ? "Wszystko aktualne — brak zmian." : "Brak otwartych pozycji na tym koncie."}
                        </div>
                      )}
                      {visible.map(ch => <ChangeRow key={changeKey(acc.key, ch)} ch={ch}
                        on={isOn(acc.key, ch)} onToggle={() => toggle(acc.key, ch)} />)}
                      {sameCount > 0 && (
                        <button onClick={() => setShowSame(s => !s)}
                          style={{ background: "none", border: "none", color: "#5a6a7e", cursor: "pointer", fontSize: 12, padding: "6px 0 0" }}>
                          {showSame ? "Ukryj" : "Pokaż"} bez zmian ({sameCount})
                        </button>
                      )}
                      {newRealized(acc).length > 0 && (() => {
                        const items = newRealized(acc);
                        const byKind = {};
                        for (const e of items) byKind[e.kind] = (byKind[e.kind] || 0) + (e.pnlPLN || 0);
                        return (
                          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, paddingTop: 10, borderTop: "1px dashed #1e2a38", cursor: "pointer" }}>
                            <input type="checkbox" checked={realizedOn(acc)} style={{ marginTop: 3 }}
                              onChange={() => setSkipRealized(s => ({ ...s, [acc.key]: !s[acc.key] }))} />
                            <span style={{ fontSize: 12.5, color: "#c8d4e0", lineHeight: 1.5 }}>
                              Dopisz do dziennika zrealizowanych wyników ({items.length} {items.length === 1 ? "operacja" : "operacji"})
                              <span style={{ display: "block", fontSize: 11.5, color: "#5a6a7e" }}>
                                {Object.entries(byKind).map(([k, v]) => `${KIND_LABEL[k] || k} ${v >= 0 ? "+" : ""}${fmtPLN(v)}`).join(" · ")}
                              </span>
                            </span>
                          </label>
                        );
                      })()}
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
              <button onClick={apply} disabled={selectedCount === 0 && realizedCount === 0}
                style={{
                  flex: 2, padding: "11px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 700,
                  background: selectedCount || realizedCount ? "#00c896" : "#1e2a38", color: selectedCount || realizedCount ? "#000" : "#5a6a7e",
                  cursor: selectedCount || realizedCount ? "pointer" : "default",
                }}>
                {selectedCount ? `Zastosuj ${selectedCount} ${selectedCount === 1 ? "zmianę" : selectedCount < 5 ? "zmiany" : "zmian"}`
                  : realizedCount ? `Dopisz ${realizedCount} do dziennika` : "Brak zmian do zastosowania"}
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
  const cost = p => p.missingCost ? "koszt nieznany" : `koszt ${fmtPLN(p.paidPLN)}`;

  let detail;
  if (ch.kind === "new") {
    detail = `${fmtQty(pos.qty)} szt. · ${cost(pos)}`;
  } else if (ch.kind === "update") {
    const qtyChanged = Math.abs((before.stockQuantity || 0) - pos.qty) > 1e-6;
    const q = qtyChanged ? `${fmtQty(before.stockQuantity)} → ${fmtQty(pos.qty)} szt.` : `${fmtQty(pos.qty)} szt.`;
    detail = pos.missingCost ? q : `${q} · koszt ${fmtPLN(before.stockPaidPLN)} → ${fmtPLN(pos.paidPLN)}`;
  } else if (ch.kind === "remove") {
    detail = ch.screenshot
      ? `${fmtQty(before.stockQuantity)} szt. — nie ma na zrzutach (zaznacz, jeśli sprzedane)`
      : ch.fromThisAccount
        ? `${fmtQty(before.stockQuantity)} szt. — nie ma już w XTB (sprzedane)`
        : `${fmtQty(before.stockQuantity)} szt. — nie ma w pliku (inny broker?)`;
  } else {
    detail = `${fmtQty(pos.qty)} szt.${pos.fromScreenshot ? "" : ` · ${cost(pos)}`}`;
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
          <div style={{ fontSize: 11, color: "#e8a040", marginTop: 2 }}>
            {pos.market ? `Giełda ${pos.market} nieobsługiwana` : "Nie rozpoznano giełdy"} — cena live może nie działać
          </div>
        )}
        {pos?.hasEstimates && (
          <div style={{ fontSize: 11, color: "#e8a040", marginTop: 2 }}>Koszt części transz oszacowany (brak operacji w eksporcie — pobierz pełny zakres dat)</div>
        )}
        {ch.kind === "new" && pos?.missingCost && (
          <div style={{ fontSize: 11, color: "#e8a040", marginTop: 2 }}>Kosztu nie widać na zrzucie — uzupełnij go później w edycji pozycji</div>
        )}
      </div>
    </div>
  );
}
