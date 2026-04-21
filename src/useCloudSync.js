import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthProvider";

const DEBOUNCE_MS = 1500;

const LOCAL_KEYS = {
  portfolios: "pt-portfolios",
  activePortfolioId: "pt-active-portfolio",
  allAssets: "pt-assets",
  categories: "pt-categories",
  history: "pt-history",
};

function readLocalSnapshot() {
  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    portfolios: read(LOCAL_KEYS.portfolios, null),
    activePortfolioId: (() => {
      try { return localStorage.getItem(LOCAL_KEYS.activePortfolioId) || null; } catch { return null; }
    })(),
    allAssets: read(LOCAL_KEYS.allAssets, null),
    categories: read(LOCAL_KEYS.categories, null),
    history: read(LOCAL_KEYS.history, null),
  };
}

function hasLocalData(snapshot) {
  return (
    (Array.isArray(snapshot.allAssets) && snapshot.allAssets.length > 0) ||
    (Array.isArray(snapshot.portfolios) && snapshot.portfolios.length > 0) ||
    (Array.isArray(snapshot.history) && snapshot.history.length > 0)
  );
}

/**
 * Synchronizacja portfela z chmurą.
 *
 * Po zalogowaniu:
 *  - pobiera rekord z tabeli `portfolios`;
 *  - jeśli rekord istnieje → stan aplikacji jest nadpisywany danymi z chmury;
 *  - jeśli rekordu nie ma → dane z localStorage są migrowane do chmury (pierwsze logowanie).
 *
 * Po każdej zmianie stanu (debounce 1500ms) zapisuje cały snapshot do chmury.
 */
export function useCloudSync({
  portfolios, setPortfolios,
  activePortfolioId, setActivePortfolioId,
  allAssets, setAllAssets,
  categories, setCategories,
  history, setHistory,
}) {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState(null);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const lastSavedJsonRef = useRef(null);

  // Pobierz dane z chmury po zalogowaniu
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      hydratedRef.current = false;
      lastSavedJsonRef.current = null;
      setStatus("idle");
      return;
    }

    let cancelled = false;
    async function hydrate() {
      setStatus("loading");
      setError(null);
      try {
        const { data, error } = await supabase
          .from("portfolios")
          .select("data, updated_at")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        if (data && data.data) {
          const cloud = data.data;
          if (Array.isArray(cloud.portfolios)) setPortfolios(cloud.portfolios);
          if (typeof cloud.activePortfolioId === "string") setActivePortfolioId(cloud.activePortfolioId);
          if (Array.isArray(cloud.allAssets)) setAllAssets(cloud.allAssets);
          if (Array.isArray(cloud.categories)) setCategories(cloud.categories);
          if (Array.isArray(cloud.history)) setHistory(cloud.history);
          lastSavedJsonRef.current = JSON.stringify(cloud);
        } else {
          const local = readLocalSnapshot();
          if (hasLocalData(local)) {
            const payload = {
              portfolios: local.portfolios ?? [],
              activePortfolioId: local.activePortfolioId ?? "default",
              allAssets: local.allAssets ?? [],
              categories: local.categories ?? [],
              history: local.history ?? [],
            };
            const { error: insertError } = await supabase
              .from("portfolios")
              .insert({ user_id: user.id, data: payload });
            if (cancelled) return;
            if (insertError) throw insertError;
            lastSavedJsonRef.current = JSON.stringify(payload);
          } else {
            lastSavedJsonRef.current = null;
          }
        }

        hydratedRef.current = true;
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[useCloudSync] hydrate error", err);
        setError(err.message || "Nie udało się pobrać danych.");
        setStatus("error");
      }
    }

    hydrate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  // Debounced save after state changes
  useEffect(() => {
    if (!user || !hydratedRef.current) return;
    const payload = { portfolios, activePortfolioId, allAssets, categories, history };
    const json = JSON.stringify(payload);
    if (json === lastSavedJsonRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const { error } = await supabase
          .from("portfolios")
          .upsert({ user_id: user.id, data: payload }, { onConflict: "user_id" });
        if (error) throw error;
        lastSavedJsonRef.current = json;
      } catch (err) {
        console.error("[useCloudSync] save error", err);
        setError(err.message || "Zapis do chmury nie powiódł się.");
      }
    }, DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [user, portfolios, activePortfolioId, allAssets, categories, history]);

  return { status, error };
}
