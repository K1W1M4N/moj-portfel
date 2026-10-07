# moj-portfel

Aplikacja do śledzenia portfela inwestycyjnego (akcje/ETF, obligacje, surowce, waluty,
konta oszczędnościowe). React + Vite, dane w Supabase z fallbackiem do localStorage,
backend to funkcje serverless na Vercelu (`api/`).

Nad projektem pracują dwie osoby przez Claude Code: **Tomasz** i **Karol**. Ten plik
czyta Claude Code automatycznie na starcie każdej sesji — jeśli coś tu jest nieaktualne,
popraw ten plik zamiast tylko wspominać o tym w rozmowie.

## Stack

- **Frontend:** React 19 + Vite 8, cały stan w `src/App.jsx` (uwaga: >2500 linii).
- **Baza:** Supabase (`src/supabaseClient.js`). Jeśli brak `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`, aplikacja działa offline na `localStorage` — to zamierzone
  zachowanie (fix "Offline-First", wrzesień 2026), nie błąd.
- **Backend:** funkcje serverless w `api/`, deployowane przez Vercel. Plan Hobby pozwala
  na **maks. 12 funkcji** na wdrożenie (przekroczenie = nieudany deploy), dlatego:
  - szybkie endpointy GET leżą w `api/_lib/<nazwa>.js` i obsługuje je jedna funkcja-router
    `api/[route].js` (adres `/api/<nazwa>` bez zmian). Nowy endpoint = plik w `_lib/`
    + wpis w `ROUTES` w `api/[route].js`, nie nowy plik w `api/`;
  - osobnymi funkcjami są tylko `api/news-summary.js` (30 s) i `api/xtb-screenshot.js`
    (60 s, Supabase, POST) — limity czasu w `vercel.json`.

  Każdy endpoint ma łańcuch fallbacków (np. Yahoo Finance → Stooq → Twelve Data) — jeśli jedno źródło
  padnie, endpoint ma i tak zwrócić dane, nie 500.
- **Tryb testowy (sandbox):** `npm run dev:sandbox` (port 5174, `.env.sandbox`,
  `src/devMode.js`). Pomija logowanie i Supabase, dane tylko w localStorage tej sesji
  przeglądarki — bezpieczne środowisko do testowania zmian bez ruszania prawdziwego
  portfela w chmurze. `AUTH_BYPASS` jest zablokowany warunkiem `import.meta.env.DEV`,
  więc nie może się włączyć w buildzie produkcyjnym.

## Workflow z Karolem

Oboje commitujecie niezależnie na to samo repo — bez tego cyklu nadpisujecie sobie pracę.

1. `git pull` na starcie **każdej** sesji. Historia potrafi się rozjechać o kilkanaście
   commitów (automatyczne aktualizacje stawek + realne feature'y) — zawsze sprawdź
   `git log HEAD..origin/main --oneline` przed dalszą pracą.
2. Branch na każdą zmianę: `git checkout -b feature/nazwa` albo `fix/nazwa`. Nigdy nie
   pracuj bezpośrednio na `main`.
3. Małe, jednotematyczne commity i PR-y. Nie mieszaj bug fixa z inną zmianą w jednym PR.
4. Przed commitem: `npm run build` musi przejść. Przy zmianach w UI odpal
   `npm run dev:sandbox` i sprawdź w przeglądarce.
5. PR na GitHubie, potem merge do `main` — autor PR-a może zmergować sam, bez czekania
   na review drugiej osoby (CODEOWNERS tylko przypisuje reviewera, nie blokuje mergu).
   Przed mergem: zsynchronizuj `main` do gałęzi i upewnij się, że `npm run build` przechodzi.
6. Po mergu do `main` Vercel wdraża produkcję automatycznie.

**Kto dotyka `App.jsx`.** To plik, w którym siedzicie obaj i on generuje najwięcej
konfliktów przy mergu. Umawiajcie się z góry, kto go rusza w danym tygodniu, albo
rozbijajcie zmiany na osobne, mniejsze PR-y.

**Merge conflicty** — jeśli `git pull` zgłosi konflikt w pliku, w którym oboje ostatnio
pracowaliście (np. `useCloudSync.js`, `App.jsx`), przeczytaj obie strony zmiany zanim
wybierzesz jedną — zwykle chodzi o połączenie dwóch warunków/guardów, nie o wybór
jednej wersji kosztem drugiej.

## Bilanse na ekranie głównym

Kafelki "Bilans dziś / w tym miesiącu / w tym roku / portfela" liczą się z faktycznych danych, nie z estymacji:
`src/dailyBalance.js` (poprzednie zamknięcie), `src/periodBalance.js` (kursy historyczne z `/api/price-at`,
per transza — zakup w okresie nie jest zyskiem), `src/historyStore.js` (dzienne snapshoty per portfel), `src/realizedLog.js` (dziennik zrealizowanych: sprzedane pozycje, dywidendy, odsetki z importu XTB — doliczany do "Bilansu portfela" i bilansów okresów).
To czyste moduły bez Reacta — po zmianie obliczeń odpal `npm run test:bilans`.
Plan, decyzje i znane luki: `docs/PLAN-statystyki-portfela.md`.

## Znane problemy

- **Zaszyte klucze API** (Twelve Data, GoldAPI): fallbacki usunięte z kodu (commit
  `0b2de30`, branch `fix/usun-zaszyte-klucze`), ale stare klucze nadal są w historii gita
  w plaintext. Jeśli nie zostały jeszcze unieważnione — wygenerować nowe i ustawić na
  Vercelu (Settings → Environment Variables).
- **Schemat bazy Supabase** nie jest nigdzie w repo (tabela `portfolios`, polityki RLS).
  Jeśli Claude Code ma pomóc przy czymś związanym z bazą, poproś Karola o zrzut
  struktury — bez tego Claude nie widzi tej części systemu.
- `api/_lib/bond-rates.js` — scraper obligacjeskarbowe.pl naprawiony (wrzesień 2026):
  strona owija `%` w `<sub>%</sub>`, a stare regexy dla ROS/ROD/DOR łapały przypadkowe
  fragmenty strony. Teraz kotwiczone na linku karty produktu. Jeśli znów zacznie
  zwracać `success: false`, prawdopodobnie strona znowu zmieniła markup.

## Model i limity (Claude Code)

| Rodzaj zadania | Model |
|---|---|
| Zmiany w kilku plikach naraz, refaktor `App.jsx` | Opus |
| Obliczenia finansowe (obligacje, P&L, kursy, konta oszczędnościowe) | Opus |
| Debugowanie czegoś, co "dziwnie się zachowuje" | Opus |
| Poprawka CSS, nowe pole w modalu, zmiana tekstu | Sonnet |
| Czytanie kodu i tłumaczenie, jak coś działa | Sonnet |

`/clear` między niepowiązanymi zadaniami — `App.jsx` i `StockModal.jsx` są duże, więc
otwarcie ich to spory kawałek kontekstu. Precyzyjne prompty (nazwa pliku + funkcji)
są dużo tańsze niż ogólne ("napraw ceny akcji").

## Środowisko lokalne

Pełna lista zmiennych jest w `.env.example` — skopiuj go do `.env.local` i uzupełnij:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
TWELVE_DATA_API_KEY=... # fallback kursów akcji i wyszukiwarki symboli
GOLDAPI_KEY=...         # ceny surowców
GROQ_API_KEY=...        # api/news-summary.js i api/xtb-screenshot.js
```

`.env.local` jest w `.gitignore`, więc klucze **nie przechodzą przez `git pull`** — każdy
musi je mieć u siebie. Wartości: `vercel env pull .env.local` (wymaga dostępu do projektu
na Vercelu, nadpisuje plik), panel Supabase (Project Settings → API) albo prywatnie od
drugiej osoby. Nigdy nie wklejaj wartości kluczy do repo, PR-a ani commita. Dodajesz
nową zmienną? Dopisz jej nazwę (bez wartości) do `.env.example` i ustaw ją na Vercelu.
