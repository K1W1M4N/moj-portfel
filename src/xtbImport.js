// src/xtbImport.js — Import portfela z eksportu XTB (xStation 5 → Historia konta → Eksport)
//
// Obsługuje:
//   - pojedynczy plik .xlsx (jedno konto, np. IKE_51369022_....xlsx)
//   - archiwum .zip z kilkoma kontami (tak XTB pakuje eksport z wielu rachunków)
//
// Z każdego konta czytamy:
//   - "Open Positions"  → stan portfela: wiersz zbiorczy per instrument + wiersze pojedynczych zakupów (transze)
//   - "Cash Operations" → realnie wydane PLN per Position ID (z kursem walut i opłatą za przewalutowanie)
//
// Import działa jako "snapshot": plik mówi, jaki jest stan TERAZ, a my liczymy różnicę
// względem aplikacji (nowe / zmienione / zamknięte pozycje). Nie trzeba pamiętać,
// co się sprzedało czy dokupiło od ostatniego razu.
import * as XLSX from "xlsx";

// ─── Mapowanie końcówek tickerów XTB → giełdy używane przez api/stock-price.js ─
const XTB_SUFFIX_MAP = {
  PL: { exchange: "XWAR", currency: "PLN" },
  US: { exchange: "XNAS", currency: "USD" },
  DE: { exchange: "XETR", currency: "EUR" },
  UK: { exchange: "XLON", currency: "GBP" },
  NL: { exchange: "XAMS", currency: "EUR" },
  FR: { exchange: "XPAR", currency: "EUR" },
};

// Grupy giełd traktowane jako "ten sam rynek" przy dopasowywaniu do istniejących pozycji
const EXCHANGE_GROUP = {
  GPW: "PL", WSE: "PL", XWAR: "PL",
  XNAS: "US", XNYS: "US", NASDAQ: "US", NYSE: "US",
  XETR: "DE", XLON: "UK", LSE: "UK", XAMS: "NL", XPAR: "FR",
};

export function mapXtbTicker(xtbTicker) {
  const m = String(xtbTicker || "").trim().toUpperCase().match(/^(.+)\.([A-Z]{2})$/);
  if (!m) return { symbol: String(xtbTicker || "").toUpperCase(), exchange: null, currency: null, market: null };
  const [, symbol, suffix] = m;
  const map = XTB_SUFFIX_MAP[suffix];
  return { symbol, exchange: map?.exchange ?? null, currency: map?.currency ?? null, market: suffix };
}

// ─── Pomocnicze ───────────────────────────────────────────────────────────────
const num = v => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};

// Excel trzyma daty jako liczbę dni od 1899-12-30. XTB zapisuje czas w UTC,
// więc przeliczamy ręcznie (cellDates w SheetJS interpretuje je jako czas lokalny).
function xtbDate(v) {
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString();
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
  return isNaN(d) ? null : d.toISOString();
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) : null;
}

// Znajdź wiersz nagłówka zaczynający się od podanych kolumn i zwróć mapę nazwa → indeks
function findHeader(rows, firstCols) {
  const idx = rows.findIndex(r => firstCols.every((c, i) => String(r[i]).trim() === c));
  if (idx < 0) return null;
  const cols = {};
  rows[idx].forEach((c, i) => { if (c !== "") cols[String(c).trim()] = i; });
  return { idx, cols };
}

// ─── Parsowanie jednego skoroszytu (jednego konta) ───────────────────────────
function parseAccountWorkbook(wb, fileName) {
  const open = sheetRows(wb, "Open Positions");
  if (!open) return null;

  // Arkusz "Open Positions" podaje numer konta głównego także dla IKE/IKZE,
  // więc właściwy numer bierzemy z nazwy pliku (IKE_51369022_...) lub z Cash Operations.
  const accountNumber =
    fileName.match(/^[A-Z]+_(\d+)_/)?.[1] ||
    String(sheetRows(wb, "Cash Operations")?.[0]?.[1] ?? "").trim() ||
    String(open[0]?.[1] ?? "").trim();
  const generatedAt = xtbDate(open.find(r => String(r[0]).startsWith("Data as of"))?.[1]);

  // 1) Ile PLN faktycznie wydano na jednostkę dla każdego Position ID (z Cash Operations)
  const plnPerUnitByPosition = {};
  const cash = sheetRows(wb, "Cash Operations");
  if (cash) {
    const h = findHeader(cash, ["Type", "Instrument", "Ticker"]);
    if (h) {
      const acc = {};
      for (const r of cash.slice(h.idx + 1)) {
        if (String(r[h.cols["Type"]]).trim() !== "Stock purchase") continue;
        const pid = String(r[h.cols["Position ID"]] ?? "").trim();
        const m = String(r[h.cols["Comment"]] ?? "").match(/OPEN BUY ([\d.]+)(?:\/[\d.]+)? @/);
        if (!pid || !m) continue;
        acc[pid] ??= { pln: 0, qty: 0 };
        acc[pid].pln += -num(r[h.cols["Amount"]]);
        acc[pid].qty += num(m[1]);
      }
      for (const [pid, a] of Object.entries(acc)) {
        if (a.qty > 0 && a.pln > 0) plnPerUnitByPosition[pid] = a.pln / a.qty;
      }
    }
  }

  // 2) Otwarte pozycje: wiersz zbiorczy (Type pusty, jest Category) + wiersze BUY pod nim
  const h = findHeader(open, ["Product", "Instrument/Position", "Ticker"]);
  const positions = [];
  let product = null;
  if (h) {
    const c = h.cols;
    let cur = null;
    for (const r of open.slice(h.idx + 1)) {
      const ticker = String(r[c["Ticker"]] ?? "").trim();
      if (!ticker) continue;
      product ??= String(r[c["Product"]] ?? "").trim() || null;
      const type = String(r[c["Type"]] ?? "").trim();

      if (!type) {
        const mapped = mapXtbTicker(ticker);
        cur = {
          xtbTicker: ticker,
          ...mapped,
          name: String(r[c["Instrument/Position"]] ?? "").trim().replace(/_/g, " ") || mapped.symbol,
          category: String(r[c["Category"]] ?? "").trim(),
          qty: num(r[c["Volume"]]),
          avgPrice: num(r[c["Open price"]]),
          valuePLN: num(r[c["Value"]]),
          tranches: [],
        };
        positions.push(cur);
        continue;
      }

      if (type !== "BUY" || !cur || cur.xtbTicker !== ticker) continue;
      const positionId = String(r[c["Instrument/Position"]] ?? "").trim();
      const qty = num(r[c["Volume"]]);
      const openPrice = num(r[c["Open price"]]);
      const valuePLN = num(r[c["Value"]]);
      const currentPrice = num(r[c["Current price"]]);
      let totalPLN, estimated = false;
      if (plnPerUnitByPosition[positionId]) {
        totalPLN = qty * plnPerUnitByPosition[positionId];
      } else {
        // Brak wpisu w Cash Operations (np. eksport z krótszego zakresu dat) —
        // szacujemy po bieżącym kursie waluty: Value / (qty × current price)
        const fxNow = qty > 0 && currentPrice > 0 ? valuePLN / (qty * currentPrice) : 1;
        totalPLN = qty * openPrice * fxNow;
        estimated = true;
      }
      cur.tranches.push({
        qty,
        totalPLN: round(totalPLN),
        openPrice,
        openTime: xtbDate(r[c["Open time (UTC)"]]),
        positionId,
        ...(estimated ? { estimated: true } : {}),
      });
    }
  }

  for (const p of positions) {
    p.paidPLN = round(p.tranches.reduce((s, t) => s + t.totalPLN, 0));
    p.hasEstimates = p.tranches.some(t => t.estimated);
    // Nieobsługiwana giełda (brak w XTB_SUFFIX_MAP) — cena live nie zadziała, pokażemy ostrzeżenie
    p.unsupported = !p.exchange;
    p.currency ??= "PLN";
  }

  return {
    fileName,
    accountNumber,
    product: product || (fileName.match(/^([A-Z]+)_/)?.[1] ?? ""),
    generatedAt,
    positions: positions.filter(p => p.qty > 0),
  };
}

// ─── Wejście: File (xlsx albo zip) → lista kont ──────────────────────────────
export async function parseXtbFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = /\.zip$/i.test(file.name);
  const accounts = [];

  if (isZip) {
    const zip = XLSX.CFB.read(buf, { type: "array" });
    zip.FullPaths.forEach((path, i) => {
      if (!/\.xlsx$/i.test(path)) return;
      const entry = zip.FileIndex[i];
      if (!entry?.content) return;
      const wb = XLSX.read(entry.content, { type: "array" });
      const acc = parseAccountWorkbook(wb, path.split("/").pop());
      if (acc) accounts.push(acc);
    });
  } else {
    const wb = XLSX.read(buf, { type: "array" });
    const acc = parseAccountWorkbook(wb, file.name);
    if (acc) accounts.push(acc);
  }

  if (!accounts.length) {
    throw new Error("Nie znaleziono arkusza „Open Positions”. Upewnij się, że to eksport z xStation 5 (Historia konta → Eksport).");
  }
  return accounts;
}

// ─── Zrzut ekranu (odczyt przez api/xtb-screenshot) → format "konta" jak z pliku ─
// Zrzut nie mówi, z którego konta pochodzi, więc numer konta dopasowujemy do portfela
// docelowego (pozycje zaimportowane wcześniej z pliku mają xtbAccount).
export function accountFromScreenshot(result, accountNumber) {
  const positions = (result.positions || []).map(p => {
    const fromTicker = p.ticker ? mapXtbTicker(p.ticker) : null;
    const market = fromTicker?.market || (p.market !== "UNKNOWN" ? p.market : null);
    const map = market ? XTB_SUFFIX_MAP[market] : null;
    const symbol = fromTicker?.symbol || String(p.name || "").toUpperCase();
    const qty = num(p.quantity);
    const currency = map?.currency ?? "PLN";
    // Koszt w PLN: wartość − zysk (oba z konta w PLN) to najdokładniejsze, co widać na zrzucie.
    // Bez nich — ilość × cena otwarcia, poprawne tylko dla instrumentów w PLN.
    const paidFromPnl = p.value_pln > 0 ? p.value_pln - p.profit_pln : 0;
    // (przy nieznanej giełdzie nie zakładamy PLN — cena może być w USD/EUR)
    const paidPLN = round(paidFromPnl > 0 ? paidFromPnl : map?.currency === "PLN" ? qty * num(p.avg_open_price) : 0);
    return {
      xtbTicker: p.ticker || (market ? `${symbol}.${market}` : symbol),
      symbol,
      exchange: map?.exchange ?? null,
      currency,
      market,
      name: p.name || symbol,
      category: "",
      qty,
      avgPrice: num(p.avg_open_price),
      valuePLN: num(p.value_pln) || paidPLN,
      paidPLN,
      tranches: paidPLN > 0 ? [{ qty, totalPLN: paidPLN, estimated: true }] : [],
      hasEstimates: false,
      unsupported: !map,
      fromScreenshot: true,
      missingCost: paidPLN <= 0,
    };
  });
  return { accountNumber, product: "Zrzut ekranu", positions, fromScreenshot: true };
}

// ─── Budowa aktywa w formacie aplikacji ──────────────────────────────────────
export function buildStockAsset(pos, existing, accountNumber, syncedAt) {
  // Zrzut bez widocznego kosztu: przy zmianie liczby sztuk skaluj dotychczasowy koszt proporcjonalnie
  if (pos.missingCost && existing?.stockPaidPLN > 0 && existing?.stockQuantity > 0) {
    const paidPLN = round(existing.stockPaidPLN * (pos.qty / existing.stockQuantity));
    pos = { ...pos, paidPLN, tranches: [{ qty: pos.qty, totalPLN: paidPLN, estimated: true }] };
  }
  return {
    ...(existing || {}),
    id: existing?.id ?? `xtb-${accountNumber}-${pos.xtbTicker}-${Date.now()}`,
    name: existing?.name || pos.name,
    category: existing?.category || "Akcje / ETF",
    note: existing?.note ?? "",
    isStock: true,
    stockSymbol: existing?.stockSymbol || pos.symbol,
    stockName: existing?.stockName || pos.name,
    stockExchange: existing?.stockExchange || pos.exchange,
    stockCurrency: pos.currency,
    stockType: existing?.stockType || (pos.category === "ETF" ? "ETF" : "Common Stock"),
    value: pos.valuePLN,
    stockQuantity: pos.qty,
    stockAvgPrice: pos.avgPrice,
    stockPaidPLN: pos.paidPLN,
    stockTranches: pos.tranches,
    // Import nadpisuje ręczny tryb "Z brokera"
    stockBrokerValue: undefined,
    stockBrokerPnl: undefined,
    xtbAccount: accountNumber ?? existing?.xtbAccount,
    xtbTicker: pos.xtbTicker,
    xtbSyncedAt: syncedAt,
  };
}

function sameMarket(asset, pos) {
  if (String(asset.stockSymbol || "").toUpperCase() !== pos.symbol) return false;
  const a = EXCHANGE_GROUP[asset.stockExchange];
  return !a || !pos.market || a === pos.market;
}

const normName = s => String(s || "").toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, "");
function sameName(asset, pos) {
  const n = normName(pos.name);
  return !!n && (normName(asset.stockName) === n || normName(asset.name) === n);
}

// ─── Różnica: plik XTB vs aktywa w portfelu docelowym ────────────────────────
// Zwraca listę zmian { kind: "new" | "update" | "same" | "remove", pos?, before?, defaultOn, ... }
//
// Dla zrzutów ekranu (account.fromScreenshot):
//   - porównujemy tylko liczbę sztuk — koszt ze zrzutu jest przybliżony i nie powinien
//     nadpisywać dokładnych transz z importu pliku,
//   - usunięcia są domyślnie odznaczone, bo zrzuty mogą nie obejmować całej listy.
export function diffXtbAccount(account, portfolioAssets) {
  const screenshot = !!account.fromScreenshot;
  const stocks = portfolioAssets.filter(a => a.isStock);
  const used = new Set();
  const changes = [];

  for (const pos of account.positions) {
    const before =
      stocks.find(a => !used.has(a.id) && a.xtbAccount === account.accountNumber && a.xtbTicker === pos.xtbTicker) ||
      stocks.find(a => !used.has(a.id) && sameMarket(a, pos)) ||
      // Zrzut bez widocznego tickera — dopasuj po nazwie
      (screenshot ? stocks.find(a => !used.has(a.id) && sameName(a, pos)) : null);
    if (before) used.add(before.id);

    if (!before) {
      changes.push({ kind: "new", pos, defaultOn: true });
      continue;
    }
    const qtySame = Math.abs((before.stockQuantity || 0) - pos.qty) < 1e-6;
    const paidSame = screenshot || Math.abs((before.stockPaidPLN || 0) - pos.paidPLN) < 0.5;
    changes.push({ kind: qtySame && paidSame ? "same" : "update", pos, before, defaultOn: !(qtySame && paidSame) });
  }

  // Pozycje w aplikacji, których nie ma w pliku → sprzedane (albo z innego brokera)
  for (const a of stocks) {
    if (used.has(a.id)) continue;
    const fromThisAccount = !!account.accountNumber && a.xtbAccount === account.accountNumber;
    changes.push({ kind: "remove", before: a, defaultOn: fromThisAccount && !screenshot, fromThisAccount, screenshot });
  }

  const order = { new: 0, update: 1, remove: 2, same: 3 };
  return changes.sort((x, y) => order[x.kind] - order[y.kind]);
}
