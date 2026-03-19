// api/wibor.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600");
  try {
    const url = "https://stooq.com/q/d/l/?s=wibor6m&i=m";
    const response = await fetch(url);
    const text = await response.text();
    const lines = text.trim().split("\n").slice(1);
    const history = {};
    lines.forEach(line => {
      const [date, , , , close] = line.split(",");
      if (!date || !close) return;
      const yearMonth = date.substring(0, 7);
      history[yearMonth] = parseFloat(close) / 100;
    });
    const keys = Object.keys(history).sort();
    const current = history[keys[keys.length - 1]];
    return res.status(200).json({ success: true, history, current, updatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
