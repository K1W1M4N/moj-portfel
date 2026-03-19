// src/useWibor.js
import { useState, useEffect } from "react";

const CACHE_KEY = "wibor_cache";
const CACHE_TTL = 24 * 60 * 60 * 1000;

const WIBOR_FALLBACK = {
  "2020-01":0.0172,"2020-02":0.0171,"2020-03":0.0113,"2020-04":0.0083,"2020-05":0.0054,"2020-06":0.0031,
  "2020-07":0.0024,"2020-08":0.0023,"2020-09":0.0022,"2020-10":0.0022,"2020-11":0.0022,"2020-12":0.0022,
  "2021-01":0.0022,"2021-02":0.0022,"2021-03":0.0023,"2021-04":0.0023,"2021-05":0.0023,"2021-06":0.0023,
  "2021-07":0.0024,"2021-08":0.0024,"2021-09":0.0024,"2021-10":0.0074,"2021-11":0.0146,"2021-12":0.0239,
  "2022-01":0.0302,"2022-02":0.0362,"2022-03":0.0446,"2022-04":0.0505,"2022-05":0.0591,"2022-06":0.0659,
  "2022-07":0.0706,"2022-08":0.0718,"2022-09":0.0730,"2022-10":0.0741,"2022-11":0.0751,"2022-12":0.0757,
  "2023-01":0.0757,"2023-02":0.0754,"2023-03":0.0749,"2023-04":0.0741,"2023-05":0.0733,"2023-06":0.0726,
  "2023-07":0.0711,"2023-08":0.0677,"2023-09":0.0609,"2023-10":0.0580,"2023-11":0.0573,"2023-12":0.0571,
  "2024-01":0.0569,"2024-02":0.0569,"2024-03":0.0572,"2024-04":0.0574,"2024-05":0.0574,"2024-06":0.0573,
  "2024-07":0.0573,"2024-08":0.0572,"2024-09":0.0572,"2024-10":0.0572,"2024-11":0.0572,"2024-12":0.0573,
  "2025-01":0.0572,"2025-02":0.0571,"2025-03":0.0545,"2025-04":0.0530,"2025-05":0.0520,"2025-06":0.0510,
  "2025-07":0.0505,"2025-08":0.0505,"2025-09":0.0505,"2025-10":0.0505,"2025-11":0.0505,"2025-12":0.0505,
  "2026-01":0.0505,"2026-02":0.0505,"2026-03":0.0505,
};

export function getWiborForMonth(history, yearMonth) {
  const data = { ...WIBOR_FALLBACK, ...(history || {}) };
  if (!yearMonth) {
    const keys = Object.keys(data).sort();
    return data[keys[keys.length - 1]] || 0.0505;
  }
  if (data[yearMonth]) return data[yearMonth];
  const [year, month] = yearMonth.split("-").map(Number);
  for (let i = 1; i <= 6; i++) {
    let m = month - i, y = year;
    if (m <= 0) { m += 12; y -= 1; }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (data[key]) return data[key];
  }
  return 0.0505;
}

export function useWibor() {
  const [wiborHistory, setWiborHistory] = useState(WIBOR_FALLBACK);
  const [currentWibor, setCurrentWibor] = useState(0.0505);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWibor() {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed.ts < CACHE_TTL) {
            setWiborHistory({ ...WIBOR_FALLBACK, ...parsed.history });
            setCurrentWibor(parsed.current);
            setLoading(false);
            return;
          }
        }
      } catch (e) {}
      try {
        const res = await fetch("/api/wibor");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.success) {
          const merged = { ...WIBOR_FALLBACK, ...data.history };
          setWiborHistory(merged);
          setCurrentWibor(data.current);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ history: data.history, current: data.current, ts: Date.now() }));
          } catch (e) {}
        }
      } catch (err) {
        console.warn("WIBOR API niedostępne, używam danych lokalnych");
      } finally {
        setLoading(false);
      }
    }
    fetchWibor();
  }, []);

  return { wiborHistory, currentWibor, loading };
}
