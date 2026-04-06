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

TWOJE ZADANIE — napisz analizę w 3-4 zdaniach po polsku, która odpowiada na:
1. Co śledzi ten ETF — jaka jest jego ekspozycja geograficzna i sektorowa (np. top sektory, regiony)
2. Co aktualnie dzieje się na tym rynku/indeksie — główne trendy, nastroje, istotne wydarzenia
3. Co może wyjaśniać zmianę kursu${moveInfo ? ` o ${moveInfo}` : ""} — powiąż z globalnym otoczeniem

ZASADY:
- Pisz konkretnie i edukacyjnie — użytkownik ma się czegoś dowiedzieć
- Korzystaj ze swojej wiedzy o rynkach, artykuły to tylko dodatkowy kontekst
- Jeśli artykuły dotyczą spółek wchodzących w skład indeksu — wspomnij o tym
- Zero ogólników w stylu "rynek jest zmienny" — daj konkretną wiedzę
- Jeśli nie masz pewnych informacji, powiedz to wprost zamiast zgadywać

Odpowiedź WYŁĄCZNIE w formacie JSON (bez markdown, bez dodatkowego tekstu):
{"summary":"...","relevantIndices":[0,1,2]}`;

  // ── Prompt dla spółki ─────────────────────────────────────────────────────────
  const stockPrompt = `Jesteś doświadczonym analitykiem finansowym i edukatorem inwestycyjnym. Dzisiaj jest ${today}.

Użytkownik posiada akcje:
- Spółka: ${fullName}
- Ticker: ${symbol}
${moveInfo ? `- Zmiana kursu od zakupu: ${moveInfo}` : ""}

Najnowsze artykuły o tej spółce:
${articlesList}

TWOJE ZADANIE — napisz analizę w 3-4 zdaniach po polsku, która odpowiada na:
1. Czym zajmuje się spółka i jaka jest jej pozycja w branży
2. Co aktualnie się dzieje ze spółką — wyniki, strategia, otoczenie konkurencyjne, regulacje
3. Co może wyjaśniać zmianę kursu${moveInfo ? ` o ${moveInfo}` : ""} — powiąż z konkretnymi newsami lub trendami sektorowymi

ZASADY:
- Pisz konkretnie i edukacyjnie — odwołuj się do faktów z artykułów
- Jeśli artykuły nie dotyczą bezpośrednio tej spółki, powiedz to i daj kontekst sektorowy z własnej wiedzy
- Zero ogólników — konkretne fakty, liczby, nazwy
- Artykuły, których NIE użyłeś do analizy, nie wpisuj do relevantIndices

Odpowiedź WYŁĄCZNIE w formacie JSON (bez markdown, bez dodatkowego tekstu):
{"summary":"...","relevantIndices":[0,1,2]}`;

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
      summary: parsed.summary || "",
      relevantIndices: Array.isArray(parsed.relevantIndices) ? parsed.relevantIndices : [],
      generatedAt: Date.now(),
    });
  } catch (e) {
    console.error("news-summary error:", e);
    return res.status(502).json({ error: e.message });
  }
}
