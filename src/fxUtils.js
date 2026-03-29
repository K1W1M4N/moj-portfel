// src/fxUtils.js
const fxCache = {};

/**
 * Pobiera kurs średni waluty z NBP (tabela A lub B)
 * @param {string} currency - Symbol waluty (np. "USD", "EUR")
 * @returns {Promise<number>} - Kurs w PLN
 */
export async function fetchFxRate(currency) {
  if (!currency || currency === "PLN") return 1;
  if (fxCache[currency]) return fxCache[currency];
  
  const fallback = { USD: 4.00, EUR: 4.30, GBP: 5.00, CHF: 4.50 };
  
  try {
    // Tabela A (większość walut)
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency}/last/1/?format=json`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const rate = data.rates?.[0]?.mid;
    if (rate) { fxCache[currency] = rate; return rate; }
  } catch {
    try {
      // Tabela B (rzadsze waluty)
      const res2 = await fetch(`https://api.nbp.pl/api/exchangerates/rates/b/${currency}/last/1/?format=json`);
      if (res2.ok) {
        const d = await res2.json();
        const r = d.rates?.[0]?.mid;
        if (r) { fxCache[currency] = r; return r; }
      }
    } catch {}
  }
  
  return fallback[currency] || 4.0;
}
