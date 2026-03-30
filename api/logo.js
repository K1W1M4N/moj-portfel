export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: "missing domain" });
  try {
    const response = await fetch(`https://logo.clearbit.com/${domain}`);
    if (!response.ok) return res.status(404).send("not found");
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("content-type") || "image/png");
    res.send(Buffer.from(buffer));
  } catch {
    res.status(500).send("error");
  }
}
