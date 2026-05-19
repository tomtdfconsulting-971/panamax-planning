// api/woo.js — Proxy WooCommerce pour éviter les erreurs CORS
export default async function handler(req, res) {
  // Allow CORS from your domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { siteUrl, ck, cs } = req.body;

  if (!siteUrl || !ck || !cs) {
    return res.status(400).json({ error: 'Paramètres manquants (siteUrl, ck, cs)' });
  }

  try {
    const url = `${siteUrl.replace(/\/$/, '')}/wp-json/wc/v3/orders?per_page=50&status=completed,processing&orderby=date&order=desc`;
    const credentials = Buffer.from(`${ck}:${cs}`).toString('base64');

    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `WooCommerce error ${response.status}`, detail: text });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: 'Erreur proxy', detail: err.message });
  }
}
