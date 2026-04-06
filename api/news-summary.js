// api/news-summary.js — Edukacyjna analiza spółki/ETF via Groq API

// Wykrywa czy to ETF
function detectETF(name = "") {
  return /\b(ETF|UCITS|iShares|Vanguard|Xtrackers|SPDR|Lyxor|Amundi|WisdomTree|Invesco)\b/i.test(name);
}

// Wyciąga nazwę indeksu z pełnej nazwy ETF
function extractIndexName(name = "") {
  return name
    .replace(/^(iShares\s+Core\s+|iShares\s+|Vanguard\s+|Xtrackers\s+|SPDR\s+|Lyxor\s+|Amundi\s+|WisdomTree\s+|Invesco\s+|BlackRock\s+)/i, "")
    .replace(/\s+(Swap\s+)?UCITS\s+ETF.*/i, "")
    .replace(/\s+ETF.*/i, "")
    .replace(/\s+(USD|EUR|PLN|GBP)\s*\(.*\)\s*$/i, "")
    .replace(/\s+(USD|EUR|PLN|GBP)\s*$/i, "")
    .trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, stockName, articles, pnlPct } = req.body || {};
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing GROQ_API_KEY" });

  const fullName  = stockName || symbol;
  const isEtf     = detectETF(fullName);
  const indexName = isEtf ? extractIndexName(fullName) : null;

  const moveInfo = pnlPct != null
    ? `${Number(pnlPct) > 0 ? "+" : ""}${Number(pnlPct).toFixed(1)}% od zakupu`
    : null;

  const articlesList = Array.isArray(articles) && articles.length > 0
    ? articles.map((a, i) => `[${i}] ${a.title} (${a.publisher || "nieznany"})`).join("\n")
    : "Brak artykułów.";

  const today = new Date().toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });

  // ── Prompt dla ETF ────────────────────────────────────────────────────────────
  const etfPrompt = `Jesteś doświadczonym analitykiem finansowym i edukatorem inwestycyjnym. Dzisiaj jest ${today}.

Użytkownik posiada ETF:
- Pełna nazwa: ${fullName}
- Ticker: ${symbol}
- Śledzony indeks/strategia: ${indexName || fullName}
${moveInfo ? `- Zmiana kursu od zakupu: ${moveInfo}` : ""}

Artykuły jako dodatkowy kontekst rynkowy:
${articlesList}

TWOJE ZADANIE — przygotuj DWA osobne teksty po polsku:

1. "description" (1-2 zdania) — ogólny profil ETF-a:
   Co śledzi ten ETF, jaka jest jego ekspozycja geograficzna i sektorowa, dla kogo jest przeznaczony.
   Pisz jak encyklopedia — fakty, liczby, bez odniesień do aktualnej sytuacji rynkowej.

2. "insight" (2-3 zdania) — aktualna sytuacja rynkowa:
   Co się teraz dzieje na tym rynku/indeksie, jakie są główne trendy i co może tłumaczyć zmianę kursu${moveInfo ? ` o ${moveInfo}` : ""}.
   Korzystaj z artykułów jako kontekstu. Jeśli artykuły dotyczą spółek z indeksu — wspomnij o tym.

ZASADY:
- Korzystaj ze swojej wiedzy, artykuły to tylko dodatkowy kontekst
- Zero ogólników — konkretne fakty, nazwy, liczby
- Jeśli artykuły są niepowiązane, napisz to wprost w "insight" i daj kontekst z własnej wiedzy

Odpowiedź WYŁĄCZNIE w formacie JSON (bez markdown, bez dodatkowego tekstu):
{"description":"...","insight":"...","relevantIndices":[0,1,2]}`;

  // ── Prompt dla spółki ─────────────────────────────────────────────────────────
  const stockPrompt = `Jesteś doświadczonym analitykiem finansowym i edukatorem inwestycyjnym. Dzisiaj jest ${today}.

Użytkownik posiada akcje:
- Spółka: ${fullName}
- Ticker: ${symbol}
${moveInfo ? `- Zmiana kursu od zakupu: ${moveInfo}` : ""}

Najnowsze artykuły o tej spółce:
${articlesList}

TWOJE ZADANIE — przygotuj DWA osobne teksty po polsku:

1. "description" (1-2 zdania) — ogólny profil spółki:
   Czym zajmuje się spółka, jaka jest jej pozycja w branży, kluczowe produkty/usługi lub rynki.
   Pisz jak encyklopedia — fakty bez odniesień do aktualnej sytuacji rynkowej.

2. "insight" (2-3 zdania) — aktualna sytuacja:
   Co się teraz dzieje ze spółką — wyniki, strategia, otoczenie konkurencyjne, regulacje.
   Co może tłumaczyć zmianę kursu${moveInfo ? ` o ${moveInfo}` : ""}. Odwołuj się do konkretnych faktów z artykułów.

ZASADY:
- Jeśli artykuły nie dotyczą tej spółki bezpośrednio — zaznacz to w "insight" i daj kontekst sektorowy
- Zero ogólników — konkretne fakty, liczby, nazwy
- Artykuły nieużyte do analizy nie trafiają do relevantIndices

Odpowiedź WYŁĄCZNIE w formacie JSON (bez markdown, bez dodatkowego tekstu):
{"description":"...","insight":"...","relevantIndices":[0,1,2]}`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 600,
        temperature: 0.2,
        messages: [{ role: "user", content: isEtf ? etfPrompt : stockPrompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("Groq API error:", r.status, err);
      return res.status(502).json({ error: "Groq API error", status: r.status });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: "Invalid Groq response", raw: text });

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json({
      description:    parsed.description    || "",
      insight:        parsed.insight        || "",
      relevantIndices: Array.isArray(parsed.relevantIndices) ? parsed.relevantIndices : [],
      generatedAt: Date.now(),
    });
  } catch (e) {
    console.error("news-summary error:", e);
    return res.status(502).json({ error: e.message });
  }
}
