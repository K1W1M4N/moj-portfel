// src/fxUtils.js — Kursy walut przez /api/fx-rate (Yahoo primary, NBP fallback).
// Cache in-memory z TTL 10 min. Wpisy starsze => refetch.

const TTL_MS = 10 * 60 * 1000; // 10 min
const fxCache = {}; // { [currency]: { rate, ts, source } }

const FALLBACK = { USD: 4.0, EUR: 4.3, GBP: 5.0, CHF: 4.5 };

function isFresh(entry) {
  return entry && (Date.now() - entry.ts) < TTL_MS;
}

/**
 * Pobiera kurs waluty względem PLN. Yahoo (intraday) → NBP (fixing) → hardcoded.
 * @param {string} currency - "USD", "EUR", ...
 * @returns {Promise<number>}
 */
export async function fetchFxRate(currency) {
  if (!currency || currency === "PLN") return 1;
  const cur = currency.toUpperCase();

  if (isFresh(fxCache[cur])) return fxCache[cur].rate;

  try {
    const res = await fetch(`/api/fx-rate?currency=${encodeURIComponent(cur)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.rate && !isNaN(parseFloat(data.rate))) {
        const rate = parseFloat(data.rate);
        fxCache[cur] = { rate, ts: Date.now(), source: data.source || "api" };
        return rate;
      }
    }
  } catch {}

  // Ostatnia deska ratunku — fallback hardcoded
  const rate = FALLBACK[cur] || 4.0;
  fxCache[cur] = { rate, ts: Date.now(), source: "fallback" };
  return rate;
}

/**
 * Batch fetch wielu walut jednym requestem. Zwraca { USD: 3.63, EUR: 4.25, ... }
 */
export async function fetchFxRates(currencies) {
  const unique = [...new Set(currencies.filter(c => c && c !== "PLN").map(c => c.toUpperCase()))];
  if (unique.length === 0) return { PLN: 1 };

  // Użyj cache dla swieżych, fetch dla nieświeżych
  const stale = unique.filter(c => !isFresh(fxCache[c]));

  if (stale.length > 0) {
    try {
      const res = await fetch(`/api/fx-rate?currencies=${encodeURIComponent(stale.join(","))}`);
      if (res.ok) {
        const data = await res.json();
        const now = Date.now();
        for (const [cur, rate] of Object.entries(data.rates || {})) {
          if (rate && !isNaN(parseFloat(rate))) {
            fxCache[cur] = { rate: parseFloat(rate), ts: now, source: data.sources?.[cur] || "api" };
          }
        }
      }
    } catch {}
  }

  const result = { PLN: 1 };
  for (const cur of unique) {
    result[cur] = fxCache[cur]?.rate || FALLBACK[cur] || 4.0;
  }
  return result;
}

export function getFxCacheEntry(currency) {
  return fxCache[currency?.toUpperCase()];
}
