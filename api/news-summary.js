// api/news-summary.js — Analiza newsów spółki via Groq API

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, articles, pnlPct } = req.body || {};
  if (!symbol || !Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ error: "Missing symbol or articles" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing GROQ_API_KEY" });

  const articlesList = articles
    .map((a, i) => `[${i}] ${a.title} (${a.publisher || "nieznany"})`)
    .join("\n");

  const moveInfo = pnlPct != null
    ? `Kurs zmienił się o ${pnlPct > 0 ? "+" : ""}${Number(pnlPct).toFixed(1)}% od zakupu.`
    : "";

  const prompt = `Jesteś analitykiem finansowym. Poniżej lista najnowszych newsów dotyczących spółki ${symbol}.${moveInfo ? " " + moveInfo : ""}

Newsy:
${articlesList}

Zadanie:
1. Napisz krótką analizę sytuacji spółki w 3-4 zdaniach po polsku. Bądź konkretny — wskaż co się dzieje, jakie są główne wątki i co może mieć wpływ na kurs.
2. Podaj indeksy (liczby w nawiasach kwadratowych) tylko tych artykułów, które były podstawą Twojej analizy.

Odpowiedź w formacie JSON (bez żadnego dodatkowego tekstu):
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
        max_tokens: 512,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
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

    // Wyodrębnij JSON z odpowiedzi (może być owinięty w ```json ... ```)
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
