// src/devMode.js — Tryb testowy (sandbox) do podglądu zmian przed deployem.
//
// Uruchamiany przez `npm run dev:sandbox` (ładuje .env.sandbox z VITE_AUTH_BYPASS=1).
// - pomija ekran logowania (sztuczny użytkownik),
// - NIE łączy się z Supabase — dane żyją tylko w localStorage przeglądarki testowej,
//   więc prawdziwy portfel w chmurze jest nietknięty.
//
// Warunek import.meta.env.DEV gwarantuje, że build produkcyjny nigdy nie ominie logowania,
// nawet gdyby ktoś ustawił tę zmienną na Vercelu.
export const AUTH_BYPASS = import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === "1";

export const SANDBOX_USER = { id: "sandbox-local", email: "tryb-testowy@localhost" };
