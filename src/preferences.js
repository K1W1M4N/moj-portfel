// src/preferences.js — user preferences w localStorage + hook do reactive updates
import { useState, useEffect } from "react";

const PNL_MODE_KEY = "pt-pnl-mode";
const PNL_MODE_EVENT = "pt-pnl-mode-change";

export const PNL_MODES = {
  SNAPSHOT: "snapshot", // (domyślny) koszt = stockPaidPLN zapisany przy transakcji
  XTB:      "xtb",      // koszt = qty × avg_price_orig × aktualny kurs walutowy (jak w XTB)
};

export function getPnlMode() {
  try {
    const v = localStorage.getItem(PNL_MODE_KEY);
    return v === PNL_MODES.XTB ? PNL_MODES.XTB : PNL_MODES.SNAPSHOT;
  } catch {
    return PNL_MODES.SNAPSHOT;
  }
}

export function setPnlMode(mode) {
  try {
    localStorage.setItem(PNL_MODE_KEY, mode === PNL_MODES.XTB ? PNL_MODES.XTB : PNL_MODES.SNAPSHOT);
    window.dispatchEvent(new CustomEvent(PNL_MODE_EVENT, { detail: mode }));
  } catch {}
}

// ─── Podatek Belki w podsumowaniu zysków ───────────────────────────────────────
const TAX_MODE_KEY = "pt-tax-mode";
const TAX_MODE_EVENT = "pt-tax-mode-change";

export const TAX_MODES = {
  GROSS: "gross", // (domyślny) zyski przed podatkiem — jak u brokera i na liście aktywów
  NET:   "net",   // zyski po 19% podatku Belki — tyle faktycznie zostanie w kieszeni
};

export function getTaxMode() {
  try {
    return localStorage.getItem(TAX_MODE_KEY) === TAX_MODES.NET ? TAX_MODES.NET : TAX_MODES.GROSS;
  } catch {
    return TAX_MODES.GROSS;
  }
}

export function setTaxMode(mode) {
  try {
    localStorage.setItem(TAX_MODE_KEY, mode === TAX_MODES.NET ? TAX_MODES.NET : TAX_MODES.GROSS);
    window.dispatchEvent(new CustomEvent(TAX_MODE_EVENT, { detail: mode }));
  } catch { /* brak localStorage — zostaje tryb domyślny */ }
}

export function useTaxMode() {
  const [mode, setMode] = useState(getTaxMode);
  useEffect(() => {
    const handler = () => setMode(getTaxMode());
    const storageHandler = e => { if (e.key === TAX_MODE_KEY) setMode(getTaxMode()); };
    window.addEventListener(TAX_MODE_EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(TAX_MODE_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
  return mode;
}

// Hook reaktywny — komponenty re-renderują się po zmianie trybu
export function usePnlMode() {
  const [mode, setMode] = useState(getPnlMode);
  useEffect(() => {
    const handler = () => setMode(getPnlMode());
    window.addEventListener(PNL_MODE_EVENT, handler);
    // Sync między zakładkami przez event storage
    const storageHandler = e => { if (e.key === PNL_MODE_KEY) setMode(getPnlMode()); };
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(PNL_MODE_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
  return mode;
}
