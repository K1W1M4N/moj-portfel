// src/StockModal.jsx
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Klucz Twelve Data — używany TYLKO do wyszukiwarki symboli ────────────────
const TWELVE_DATA_KEY = "a681abc9ebc045a39c938d8b058567d9";

// ─── Style (bez zmian) ────────────────────────────────────────────────────────
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
const focusInp = e => { e.target.style.borderColor = "#e8e040"; e.target.style.boxShadow = "0 0 0 3px #e8e04018"; };
const blurInp  = e => { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; };
const fmtPLN  = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
const fmtPLN2 = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n);
const fmtCur  = (n, cur) => n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " " + (cur || "");

// ─── Cache kursów NBP ─────────────────────────────────────────────────────────
const fxCache = {};

async function fetchFxRate(currency) {
  if (!currency || currency === "PLN") return 1;
  if (fxCache[currency]) return fxCache[currency];
  const fallback = { USD: 3.95, EUR: 4.27, GBP: 5.0, CHF: 4.4, GBX: 0.049 };
  try {
    const res = await fetch(
      `https://api.nbp.pl/api/exchangerates/rates/a/${currency}/last/1/?format=json`
    );
    if (!res.ok) throw new Error("NBP error");
    const data = await res.json();
    const rate = data.rates?.[0]?.mid;
    if (rate) { fxCache[currency] = rate; return rate; }
  } catch (e) {
    try {
      const res2 = await fetch(
        `https://api.nbp.pl/api/exchangerates/rates/b/${currency}/last/1/?format=json`
      );
      if (res2.ok) {
        const data2 = await res2.json();
        const rate2 = data2.rates?.[0]?.mid;
        if (rate2) { fxCache[currency] = rate2; return rate2; }
      }
    } catch (e2) {}
  }
  return fallback[currency] || 4.0;
}

// ─── Cache cen w localStorage ─────────────────────────────────────────────────
const STOCK_CACHE_KEY = "pt-stock-cache";

function loadCachedPrices() {
  try {
    const raw = localStorage.getItem(STOCK_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCachedPrices(prices) {
  try {
    localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(prices));
  } catch {}
}

// ─── Hook: live ceny — teraz przez /api/stock-price proxy ─────────────────────
export function useStockPrices(assets) {
  const [stockPrices, setStockPrices] = useState(() => {
    // Załaduj cached ceny na start (żeby nie było "odświeżanie..." od razu)
    const cached = loadCachedPrices();
    const initial = {};
    for (const [sym, data] of Object.entries(cached)) {
      if (data.priceOrig && data.pricePLN) {
        initial[sym] = { ...data, fromCache: true };
      }
    }
    return initial;
  });
  const [stockLastUpdated, setStockLastUpdated] = useState(null);

  const stockAssets = assets.filter(a => a.isStock && a.stockSymbol);
  const symbolKey = stockAssets.map(a => `${a.stockSymbol}:${a.stockExchange}`).join(",");

  const fetchAll = useCallback(async () => {
    if (stockAssets.length === 0) return;

    const symbols = [...new Set(stockAssets.map(a => a.stockSymbol))];
    const exchanges = symbols.map(sym => {
      const asset = stockAssets.find(a => a.stockSymbol === sym);
      return asset?.stockExchange || "XNAS";
    });

    // Kursy walut z NBP
    const currencies = [...new Set(stockAssets.map(a => a.stockCurrency).filter(c => c && c !== "PLN"))];
    const fxRates = { PLN: 1 };
    await Promise.all(currencies.map(async cur => {
      fxRates[cur] = await fetchFxRate(cur);
    }));

    try {
      const url = `/api/stock-price?symbols=${symbols.join(",")}&exchanges=${exchanges.join(",")}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
      const data = await res.json();

      const newPrices = {};

      for (const sym of symbols) {
        const priceData = data.prices?.[sym];
        if (priceData?.price) {
          const asset = stockAssets.find(a => a.stockSymbol === sym);
          const currency = priceData.currency || asset?.stockCurrency || "PLN";
          const priceOrig = priceData.price;
          const fx = fxRates[currency] || 1;
          newPrices[sym] = {
            priceOrig,
            pricePLN: priceOrig * fx,
            currency,
            fx,
            provider: priceData.provider,
            fromCache: false,
          };
        }
      }

      if (Object.keys(newPrices).length > 0) {
        setStockPrices(prev => {
          const merged = { ...prev, ...newPrices };
          // Zapisz do localStorage
          saveCachedPrices(merged);
          return merged;
        });
        setStockLastUpdated(new Date());
      }
    } catch (e) {
      console.warn("Stock proxy error:", e);
      // Fallback: spróbuj bezpośrednio Twelve Data (dla kompatybilności wstecznej)
      try {
        const symbolStr = symbols.join(",");
        const res = await fetch(
          `https://api.twelvedata.com/price?symbol=${symbolStr}&apikey=${TWELVE_DATA_KEY}`
        );
        const data = await res.json();
        const newPrices = {};

        if (symbols.length === 1) {
          const priceVal = data?.price;
          if (priceVal && !isNaN(parseFloat(priceVal))) {
            const asset = stockAssets.find(a => a.stockSymbol === symbols[0]);
            const currency = asset?.stockCurrency || "PLN";
            const priceOrig = parseFloat(priceVal);
            const fx = fxRates[currency] || 1;
            newPrices[symbols[0]] = { priceOrig, pricePLN: priceOrig * fx, currency, fx, provider: "twelvedata", fromCache: false };
          }
        } else {
          for (const sym of symbols) {
            const priceVal = data?.[sym]?.price;
            if (priceVal && !isNaN(parseFloat(priceVal))) {
              const asset = stockAssets.find(a => a.stockSymbol === sym);
              const currency = asset?.stockCurrency || "PLN";
              const priceOrig = parseFloat(priceVal);
              const fx = fxRates[currency] || 1;
              newPrices[sym] = { priceOrig, pricePLN: priceOrig * fx, currency, fx, provider: "twelvedata", fromCache: false };
            }
          }
        }

        if (Object.keys(newPrices).length > 0) {
          setStockPrices(prev => {
            const merged = { ...prev, ...newPrices };
            saveCachedPrices(merged);
            return merged;
          });
          setStockLastUpdated(new Date());
        }
      } catch (e2) {
        console.warn("Twelve Data fallback also failed:", e2);
      }
    }
  }, [symbolKey]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return { stockPrices, stockLastUpdated };
}

// ─── Wyszukiwarka symboli (bez zmian — Twelve Data symbol_search działa OK) ──
const EXCHANGE_PRIORITY = ["WSE", "XETR", "XWAR", "XAMS", "XPAR", "XLON", "XNAS", "XNYS"];

function sortByExchange(results) {
  return [...results].sort((a, b) => {
    const ai = EXCHANGE_PRIORITY.indexOf(a.exchange);
    const bi = EXCHANGE_PRIORITY.indexOf(b.exchange);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function SymbolSearch({ initialValue, onSelect }) {
  const [query, setQuery] = useState(initialValue || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    setOpen(true);
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=30&apikey=${TWELVE_DATA_KEY}`
        );
        const data = await res.json();
        const filtered = (data.data || [])
          .filter(r => ["Common Stock", "ETF"].includes(r.instrument_type));
        const sorted = sortByExchange(filtered).slice(0, 6);
        setResults(sorted);
      } catch (e) {
        setResults([]);
      }
      setLoading(false);
    }, 450);
  }

  function handleSelect(item) {
    setQuery(`${item.symbol} — ${item.instrument_name}`);
    setOpen(false);
    setResults([]);
    onSelect({
      symbol: item.symbol,
      name: item.instrument_name,
      exchange: item.exchange,
      currency: item.currency,
      type: item.instrument_type,
    });
  }

  function exchangeLabel(exchange) {
    const map = {
      XETR: "Frankfurt (XETRA)", WSE: "GPW Warszawa", XWAR: "GPW Warszawa",
      XAMS: "Amsterdam", XPAR: "Paryż", XLON: "Londyn", XNAS: "NASDAQ", XNYS: "NYSE",
    };
    return map[exchange] || exchange;
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        style={{ ...baseInp }}
        placeholder="Wpisz nazwę lub ticker, np. IUSQ, Apple, PKN..."
        value={query}
        onChange={handleInput}
        onFocus={e => { setOpen(true); focusInp(e); }}
        onBlur={blurInp}
        autoComplete="off"
      />
      {open && (loading || results.length > 0) && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10,
          zIndex: 300, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          {loading && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>Szukam...</div>
          )}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>Brak wyników. Spróbuj wpisać samą nazwę bez końcówki (np. "IUSQ" zamiast "IUSQ.DE")</div>
          )}
          {results.map((item, i) => (
            <div key={i}
              onClick={() => handleSelect(item)}
              onTouchEnd={e => { e.preventDefault(); handleSelect(item); }}
              style={{
                padding: "10px 14px", cursor: "pointer",
                borderBottom: i < results.length - 1 ? "1px solid #1e2a38" : "none",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
                    {item.symbol}
                  </span>
                  <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 8 }}>{item.instrument_name}</span>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: "#5a6a7e", background: "#1e2a38", padding: "2px 6px", borderRadius: 4 }}>
                    {exchangeLabel(item.exchange)}
                  </span>
                  <span style={{ fontSize: 10, color: "#4a8a6e", background: "#0a2018", padding: "2px 6px", borderRadius: 4 }}>
                    {item.currency}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 2 }}>{item.instrument_type}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal dodawania/edycji akcji/ETF (bez zmian, poza pobieraniem ceny) ──────
export function StockModal({ stock, onSave, onDelete, onClose }) {
  const isEdit = !!stock;
  const [selected, setSelected] = useState(stock ? {
    symbol: stock.stockSymbol,
    name: stock.stockName,
    exchange: stock.stockExchange,
    currency: stock.stockCurrency,
    type: stock.stockType,
  } : null);
  const [quantity, setQuantity] = useState(stock?.stockQuantity?.toString() || "");
  const [avgPrice, setAvgPrice] = useState(stock?.stockAvgPrice?.toString() || "");
  const [note, setNote]         = useState(stock?.note || "");
  const [currentPrice, setCurrentPrice] = useState(null);
  const [fxRate, setFxRate]     = useState(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const [hovSave, setHovSave]   = useState(false);
  const [hovDel, setHovDel]     = useState(false);
  const [hovClose, setHovClose] = useState(false);

  // Pobierz aktualną cenę — teraz przez proxy
  useEffect(() => {
    if (!selected?.symbol) return;
    setLoadingPrice(true);
    setCurrentPrice(null);
    setPriceError(false);

    async function load() {
      try {
        const exchange = selected.exchange || "XNAS";
        const [proxyRes, fx] = await Promise.all([
          fetch(`/api/stock-price?symbols=${encodeURIComponent(selected.symbol)}&exchanges=${encodeURIComponent(exchange)}`),
          fetchFxRate(selected.currency),
        ]);

        if (proxyRes.ok) {
          const data = await proxyRes.json();
          const priceData = data.prices?.[selected.symbol];
          if (priceData?.price) {
            setCurrentPrice(priceData.price);
            setFxRate(fx);
            setLoadingPrice(false);
            return;
          }
        }

        // Fallback: bezpośrednio Twelve Data
        const tdRes = await fetch(
          `https://api.twelvedata.com/price?symbol=${encodeURIComponent(selected.symbol)}&apikey=${TWELVE_DATA_KEY}`
        );
        const tdData = await tdRes.json();
        if (tdData?.price && !isNaN(parseFloat(tdData.price))) {
          setCurrentPrice(parseFloat(tdData.price));
        } else {
          setPriceError(true);
        }
        setFxRate(fx);
      } catch (e) {
        setPriceError(true);
      }
      setLoadingPrice(false);
    }
    load();
  }, [selected?.symbol, selected?.currency, selected?.exchange]);

  const qty = parseFloat(String(quantity).replace(",", ".")) || 0;
  const avg = parseFloat(String(avgPrice).replace(",", ".")) || 0;
  const currency = selected?.currency || "PLN";
  const fx = fxRate || 1;

  const paidPLN = qty > 0 && avg > 0 ? qty * avg * fx : 0;
  const currentValuePLN = currentPrice && qty > 0 ? qty * currentPrice * fx : null;
  const pnlPLN = currentValuePLN !== null && paidPLN > 0 ? currentValuePLN - paidPLN : null;
  const pnlPct = pnlPLN !== null && paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : null;

  const canSave = selected && qty > 0 && avg > 0;

  function submit() {
    if (!canSave) return;
    const value = currentValuePLN ?? paidPLN;
    onSave({
      id: stock?.id || Date.now(),
      name: selected.name || selected.symbol,
      category: "Akcje / ETF",
      value,
      note,
      isStock: true,
      stockSymbol: selected.symbol,
      stockName: selected.name,
      stockExchange: selected.exchange,
      stockCurrency: currency,
      stockType: selected.type,
      stockQuantity: qty,
      stockAvgPrice: avg,
      stockPaidPLN: paidPLN,
    });
    onClose();
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>
            {isEdit ? "Edytuj akcje / ETF" : "Dodaj akcje / ETF"}
          </div>
          <button onClick={onClose}
            onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Wyszukaj akcję lub ETF</label>
          <SymbolSearch
            initialValue={stock ? `${stock.stockSymbol} — ${stock.stockName}` : ""}
            onSelect={sel => { setSelected(sel); setCurrentPrice(null); setFxRate(null); setPriceError(false); }}
          />
          <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>
            Wpisz ticker bez końcówki giełdy, np. "IUSQ" zamiast "IUSQ.DE"
          </div>
        </div>

        {selected && (
          <div style={{ background: "#0f1a27", border: "1px solid #1e3040", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{selected.symbol}</span>
                <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 8 }}>{selected.name}</span>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <span style={{ fontSize: 11, color: "#5a6a7e", background: "#1e2a38", padding: "2px 8px", borderRadius: 4 }}>{selected.exchange}</span>
                <span style={{ fontSize: 11, color: "#4a8a6e", background: "#0a2018", padding: "2px 8px", borderRadius: 4 }}>{currency}</span>
              </div>
            </div>
            {loadingPrice && (
              <div style={{ fontSize: 11, color: "#5a6a7e", marginTop: 6 }}>Pobieram aktualną cenę...</div>
            )}
            {currentPrice && !loadingPrice && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#8a9bb0" }}>
                Aktualna cena:{" "}
                <span style={{ color: "#e8e040", fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                  {fmtCur(currentPrice, currency)}
                </span>
                {currency !== "PLN" && fxRate && (
                  <span style={{ marginLeft: 8, color: "#5a6a7e" }}>
                    ≈ {fmtPLN2(currentPrice * fxRate)}
                  </span>
                )}
              </div>
            )}
            {priceError && !loadingPrice && (
              <div style={{ fontSize: 11, color: "#f05060", marginTop: 6 }}>
                Nie udało się pobrać ceny. Możesz dodać aktywo — cena zaktualizuje się później.
              </div>
            )}
          </div>
        )}

        {selected && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelSt}>Ilość jednostek</label>
              <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                placeholder="np. 10 lub 5.234"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                onFocus={focusInp} onBlur={blurInp} />
            </div>
            <div>
              <label style={labelSt}>Średnia cena zakupu ({currency})</label>
              <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                placeholder="z XTB / brokera"
                value={avgPrice}
                onChange={e => setAvgPrice(e.target.value)}
                onFocus={focusInp} onBlur={blurInp}
                onKeyDown={e => e.key === "Enter" && submit()} />
              <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>
                XTB → pozycja → "Średnia cena"
              </div>
            </div>
          </div>
        )}

        {selected && qty > 0 && avg > 0 && (
          <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Podsumowanie</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zapłacono łącznie</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(paidPLN)}</div>
                <div style={{ fontSize: 11, color: "#4a5a6e" }}>{qty} × {fmtCur(avg, currency)}</div>
              </div>
              {currentValuePLN !== null && (
                <div>
                  <div style={{ fontSize: 11, color: "#5a7a9e" }}>Aktualna wartość</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(currentValuePLN)}</div>
                  {pnlPLN !== null && (
                    <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
                      {pnlPLN >= 0 ? "+" : ""}{fmtPLN(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct?.toFixed(1)}%)
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {selected && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Notatka (opcjonalnie)</label>
            <input style={baseInp} placeholder="np. XTB, zakup marzec 2024..."
              value={note}
              onChange={e => setNote(e.target.value)}
              onFocus={focusInp} onBlur={blurInp} />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={submit}
            onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
            disabled={!canSave}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 8,
              border: "2px solid #e8e040",
              background: hovSave && canSave ? "#e8e04012" : "transparent",
              color: "#e8e040", fontWeight: 700, fontSize: 13,
              cursor: canSave ? "pointer" : "not-allowed",
              fontFamily: "'Sora', sans-serif", transition: "all .2s",
              opacity: canSave ? 1 : 0.4,
            }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj do portfela"}
          </button>
          {isEdit && (
            <button onClick={() => { onDelete(stock.id); onClose(); }}
              onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${hovDel ? "#f05060" : "#f0506040"}`, background: hovDel ? "#f0506018" : "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", transition: "all .15s" }}>
              Usuń
            </button>
          )}
          <button onClick={onClose}
            style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #f0506040", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer" }}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Wiersz akcji/ETF — z badge providera i stanu offline ─────────────────────
export function StockRow({ stock, stockPrices, onClick }) {
  const [hov, setHov] = useState(false);
  const color = "#e8e040";

  const priceData = stockPrices[stock.stockSymbol];
  const currentValuePLN = priceData
    ? stock.stockQuantity * priceData.pricePLN
    : stock.value;
  const paidPLN = stock.stockPaidPLN || stock.value;
  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  const hasLivePrice = !!priceData;
  const isFromCache = priceData?.fromCache;

  // Badge providera
  const providerBadge = priceData?.provider
    ? { yahoo: "Y", stooq: "S", twelvedata: "T" }[priceData.provider] || ""
    : "";

  const fmtPLN0 = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8,
        border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s"
      }}>
      <div style={{ width: 4, borderRadius: 2, background: color, flexShrink: 0, alignSelf: "stretch" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
              {stock.stockSymbol}
            </span>
            <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {stock.stockName || stock.name}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8", flexShrink: 0 }}>
            {fmtPLN0(currentValuePLN)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", whiteSpace: "nowrap" }}>
            {stock.stockQuantity} szt.
            {priceData && (
              <span style={{ marginLeft: 4, color: "#5a6a7e" }}>
                @ {priceData.priceOrig.toFixed(2)} {stock.stockCurrency}
              </span>
            )}
            {!hasLivePrice && (
              <span style={{ color: "#3a4a5e", marginLeft: 4 }}>• odświeżanie...</span>
            )}
            {isFromCache && (
              <span style={{ color: "#5a4a3e", marginLeft: 4 }}>• cache</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {hasLivePrice && (
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: "nowrap", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
                {pnlPLN >= 0 ? "+" : ""}{fmtPLN0(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
              </div>
            )}
            {providerBadge && !isFromCache && (
              <span style={{
                fontSize: 9, color: "#3a4a5e", background: "#0f1520",
                padding: "1px 4px", borderRadius: 3, fontFamily: "'DM Mono', monospace",
              }}>{providerBadge}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
