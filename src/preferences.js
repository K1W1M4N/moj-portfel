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
