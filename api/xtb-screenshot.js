// api/xtb-screenshot.js — Odczyt otwartych pozycji ze zrzutów ekranu aplikacji XTB (Groq, model z obsługą obrazów)
//
// Używa darmowego planu Groq — ten sam GROQ_API_KEY co api/news-summary.js (bez karty płatniczej).
//
// POST { images: [{ media_type: "image/jpeg", data: "<base64>" }, ...] }  (maks. 3 — limit modelu)
// Nagłówek Authorization: Bearer <access token Supabase> — tylko zalogowani użytkownicy,
// żeby nikt z zewnątrz nie zużywał limitów klucza.
//
// Zwraca { positions: [...], notes } — surowy odczyt; mapowanie na format aplikacji
// i porównanie z portfelem robi klient (src/xtbImport.js), z podglądem przed zapisem.
import { createClient } from "@supabase/supabase-js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const VISION_MODEL = "qwen/qwen3.8-27b";
const MAX_IMAGES = 3;
const MAX_IMAGE_B64 = 1_300_000; // ~1 MB po zdekodowaniu — klient i tak kompresuje do JPEG
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MARKETS = ["PL", "US", "DE", "UK", "NL", "FR", "UNKNOWN"];

const SYSTEM_PROMPT = `Odczytujesz zrzuty ekranu z aplikacji brokera XTB (xStation / aplikacja mobilna XTB) i zwracasz listę OTWARTYCH pozycji (akcje i ETF).

Zasady:
- Przepisuj tylko to, co faktycznie widać. Niczego nie zgaduj ani nie dopowiadaj z wiedzy o rynku.
- Jeśli ta sama pozycja jest widoczna na kilku zrzutach (nakładające się przewijanie), zwróć ją raz.
- Jeśli instrument ma kilka rozwiniętych wierszy (osobne zakupy), zwróć jeden wpis zbiorczy: łączna liczba sztuk, średnia cena otwarcia.
- Pomijaj pozycje zamknięte, zlecenia oczekujące, podsumowania konta i gotówkę.

Odpowiedz WYŁĄCZNIE obiektem JSON o dokładnie takiej strukturze:
{
  "screen_recognized": true,          // false, jeśli obrazy nie przedstawiają listy pozycji z XTB
  "notes": "",                        // krótka uwaga po polsku, tylko gdy coś było nieczytelne; inaczej ""
  "positions": [
    {
      "ticker": "NVDA.US",            // symbol XTB z końcówką rynku, jeśli widoczny; inaczej ""
      "name": "Nvidia",               // nazwa instrumentu
      "market": "US",                 // PL | US | DE | UK | NL | FR | UNKNOWN (z końcówki tickera)
      "quantity": 5.078,              // liczba sztuk; przecinek dziesiętny zamień na kropkę
      "avg_open_price": 173.9,        // średnia cena otwarcia w walucie instrumentu; 0 jeśli niewidoczna
      "value_pln": 4356.84,           // bieżąca wartość pozycji w PLN; 0 jeśli niewidoczna
      "profit_pln": 1083.24           // zysk/strata w PLN (ujemna przy stracie); 0 jeśli niewidoczny
    }
  ]
}
Liczby zapisuj jako liczby JSON (bez spacji, walut i znaku %).`;

const toNum = v => {
  if (typeof v === "number" && isFinite(v)) return v;
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
};

// Model open-source nie gwarantuje schematu — normalizujemy każde pole
function normalizePosition(p) {
  const ticker = String(p?.ticker ?? "").trim().toUpperCase();
  const suffix = ticker.match(/\.([A-Z]{2})$/)?.[1];
  const market = MARKETS.includes(suffix) ? suffix : MARKETS.includes(p?.market) ? p.market : "UNKNOWN";
  return {
    ticker,
    name: String(p?.name ?? "").trim(),
    market,
    quantity: toNum(p?.quantity),
    avg_open_price: toNum(p?.avg_open_price),
    value_pln: toNum(p?.value_pln),
    profit_pln: toNum(p?.profit_pln),
  };
}

async function requireUser(req) {
  // Lokalny serwer deweloperski (vite.config.js) oznacza żądania flagą — tam nie ma sesji Supabase
  if (req.devLocal) return true;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data?.user;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!(await requireUser(req))) {
    return res.status(401).json({ error: "Zaloguj się, aby użyć importu ze zrzutu ekranu." });
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Brak GROQ_API_KEY w konfiguracji serwera." });

  const images = Array.isArray(req.body?.images) ? req.body.images : [];
  if (!images.length) return res.status(400).json({ error: "Brak zrzutów ekranu." });
  if (images.length > MAX_IMAGES) return res.status(400).json({ error: `Maksymalnie ${MAX_IMAGES} zrzuty naraz.` });
  for (const img of images) {
    if (!ALLOWED_TYPES.includes(img?.media_type) || typeof img?.data !== "string" || img.data.length > MAX_IMAGE_B64) {
      return res.status(400).json({ error: "Nieprawidłowy obraz (dozwolone JPEG/PNG/WebP do ~1 MB)." });
    }
  }

  try {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Odczytaj otwarte pozycje z ${images.length > 1 ? `tych ${images.length} zrzutów` : "tego zrzutu"}.` },
              ...images.map(img => ({ type: "image_url", image_url: { url: `data:${img.media_type};base64,${img.data}` } })),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(55000),
    });

    if (r.status === 429) {
      return res.status(429).json({ error: "Limit darmowego planu Groq wyczerpany — spróbuj za chwilę." });
    }
    if (!r.ok) {
      console.error("[xtb-screenshot] Groq", r.status, (await r.text()).slice(0, 500));
      return res.status(502).json({ error: `Błąd usługi odczytu (${r.status}).` });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      // Niektóre modele dodają blok ```json … ``` mimo trybu JSON
      parsed = JSON.parse(text.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, "$1"));
    } catch {
      return res.status(502).json({ error: "Nie udało się zinterpretować odpowiedzi modelu — spróbuj ponownie." });
    }

    if (parsed?.screen_recognized === false) {
      return res.status(422).json({ error: "Nie rozpoznano listy pozycji XTB na zrzucie.", notes: parsed.notes });
    }

    const positions = (Array.isArray(parsed?.positions) ? parsed.positions : [])
      .map(normalizePosition)
      .filter(p => p.quantity > 0 && (p.ticker || p.name));
    return res.status(200).json({ positions, notes: String(parsed?.notes || "") });
  } catch (err) {
    console.error("[xtb-screenshot]", err);
    if (err?.name === "TimeoutError") return res.status(504).json({ error: "Odczyt trwał za długo — spróbuj z mniejszą liczbą zrzutów." });
    return res.status(500).json({ error: "Nie udało się odczytać zrzutu." });
  }
}
