// api/bond-rates.js — Vercel Serverless Function
// Scrape aktualnych stawek obligacji ze strony obligacjeskarbowe.pl
// Wywołanie: GET /api/bond-rates

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=86400"); // cache 24h na Vercelu

  try {
    // Pobierz stronę z aktualnymi stawkami
    const response = await fetch("https://www.obligacjeskarbowe.pl/", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const html = await response.text();

    // Parsuj stawki z HTML — strona pokazuje aktualne oprocentowanie
    const rates = {};
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Wyrażenia regularne dla każdego typu
    const patterns = {
      TOS: /TOS[^%]*?([\d,]+(?:\.\d+)?)\s*%/i,
      EDO: /EDO[^%]*?([\d,]+(?:\.\d+)?)\s*%/i,
      COI: /COI[^%]*?([\d,]+(?:\.\d+)?)\s*%/i,
      ROS: /ROS[^%]*?([\d,]+(?:\.\d+)?)\s*%/i,
      ROD: /ROD[^%]*?([\d,]+(?:\.\d+)?)\s*%/i,
      ROR: /ROR[^%]*?([\d,]+(?:\.\d+)?)\s*%/i,
      DOR: /DOR[^%]*?([\d,]+(?:\.\d+)?)\s*%/i,
    };

    Object.entries(patterns).forEach(([type, pattern]) => {
      const match = html.match(pattern);
      if (match) {
        const rate = parseFloat(match[1].replace(",", ".")) / 100;
        if (rate > 0 && rate < 0.3) {
          rates[type] = { [yearMonth]: rate };
        }
      }
    });

    // Jeśli scraping nie zadziałał, zwróć znane stawki z tego miesiąca
    if (Object.keys(rates).length === 0) {
      return res.status(200).json({
        success: false,
        message: "Scraping nieudany — użyj stawek z tabeli historycznej",
        rates: {},
      });
    }

    return res.status(200).json({
      success: true,
      rates,
      yearMonth,
      updatedAt: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
