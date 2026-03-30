export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: "missing domain" });
  try {
    const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    const response = await fetch(url);
    if (!response.ok) return res.status(404).send("not found");
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("content-type") || "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(buffer));
  } catch {
    res.status(500).send("error");
  }
}
