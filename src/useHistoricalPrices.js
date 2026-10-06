// src/useHistoricalPrices.js — kursy zamknięcia i kursy walut na dni graniczne okresów (przez /api/price-at).
// Notowania historyczne się nie zmieniają, więc trafienia trzymamy w localStorage bezterminowo.
// Braki (null) nie są zapisywane — ponawiamy je przy następnym uruchomieniu aplikacji.
import { useEffect, useMemo, useRef, useState } from "react";
import { neededHistory } from "./periodBalance";

const CACHE_KEY = "pt-hist-prices";
const MAX_ENTRIES = 600;

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch { return {}; }
}
function saveCache(cache) {
  try {
    const keys = Object.keys(cache);
    // Proste przycinanie: przy przepełnieniu wyrzucamy najstarsze daty (klucz kończy się datą)
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => (a.slice(-10) > b.slice(-10) ? 1 : -1)).slice(0, keys.length - MAX_ENTRIES).forEach(k => delete cache[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* pełny localStorage — cache jest opcjonalny */ }
}

const pKey = (sym, exch, date) => `p|${sym}|${exch}|${date}`;
const fKey = (cur, date) => `f|${cur}|${date}`;

/**
 * @param {object[]} assets aktywa aktywnego portfela
 * @param {string[]} boundaries dni graniczne "YYYY-MM-DD"
 * @returns {{ prices: {SYM: {date: {close}|null}}, fx: {CUR: {date: {rate}|null}} }}
 *   Brak klucza = jeszcze się ładuje; null = źródła nie mają danych na ten dzień.
 */
export function useHistoricalPrices(assets, boundaries) {
  const [cache, setCache] = useState(loadCache);
  const [failed, setFailed] = useState({}); // klucze, dla których API odpowiedziało brakiem danych (w tej sesji)
  const inFlight = useRef(new Set());

  const needs = useMemo(() => neededHistory(assets, boundaries), [assets, boundaries]);
  const needsKey = JSON.stringify(needs);

  useEffect(() => {
    const todo = needs
      .map(n => ({
        ...n,
        dates: n.dates.filter(d => {
          const keys = [pKey(n.symbol, n.exchange, d), ...(n.currency !== "PLN" ? [fKey(n.currency, d)] : [])];
          return keys.some(k => !cache[k] && !failed[k] && !inFlight.current.has(k));
        }),
      }))
      .filter(n => n.dates.length > 0);
    if (todo.length === 0) return;

    const dates = [...new Set(todo.flatMap(n => n.dates))].sort();
    const currencies = [...new Set(todo.map(n => n.currency).filter(c => c !== "PLN"))];
    const allKeys = [
      ...todo.flatMap(n => dates.map(d => pKey(n.symbol, n.exchange, d))),
      ...currencies.flatMap(c => dates.map(d => fKey(c, d))),
    ];
    allKeys.forEach(k => inFlight.current.add(k));

    const qs = new URLSearchParams({
      symbols: todo.map(n => n.symbol).join(","),
      exchanges: todo.map(n => n.exchange).join(","),
      dates: dates.join(","),
      ...(currencies.length ? { currencies: currencies.join(",") } : {}),
    });

    // Bez anulowania przy zmianie potrzeb: odpowiedź nadal jest poprawna i ma trafić do cache
    (async () => {
      const found = {}, missing = {};
      try {
        const res = await fetch(`/api/price-at?${qs}`, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        for (const n of todo) for (const d of dates) {
          const p = data.prices?.[n.symbol]?.[d];
          if (p?.close > 0) found[pKey(n.symbol, n.exchange, d)] = { close: p.close, date: p.date };
          else missing[pKey(n.symbol, n.exchange, d)] = true;
        }
        for (const c of currencies) for (const d of dates) {
          const f = data.fx?.[c]?.[d];
          if (f?.rate > 0) found[fKey(c, d)] = { rate: f.rate, date: f.date };
          else missing[fKey(c, d)] = true;
        }
      } catch (e) {
        console.warn("price-at error:", e);
        allKeys.forEach(k => { missing[k] = true; });
      } finally {
        allKeys.forEach(k => inFlight.current.delete(k));
      }
      if (Object.keys(found).length > 0) {
        setCache(prev => { const next = { ...prev, ...found }; saveCache(next); return next; });
      }
      if (Object.keys(missing).length > 0) setFailed(prev => ({ ...prev, ...missing }));
    })();
  }, [needsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const prices = {}, fx = {};
    for (const n of needs) {
      for (const d of n.dates) {
        const pk = pKey(n.symbol, n.exchange, d);
        if (cache[pk]) (prices[n.symbol] ??= {})[d] = cache[pk];
        else if (failed[pk]) (prices[n.symbol] ??= {})[d] = null;
        if (n.currency !== "PLN") {
          const fk = fKey(n.currency, d);
          if (cache[fk]) (fx[n.currency] ??= {})[d] = cache[fk];
          else if (failed[fk]) (fx[n.currency] ??= {})[d] = null;
        }
      }
    }
    return { prices, fx };
  }, [needsKey, cache, failed]); // eslint-disable-line react-hooks/exhaustive-deps
}
