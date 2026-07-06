// api/woo-order.js — Fetch a specific WooCommerce order (debug)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing order id' });

  const siteUrl = process.env.WOO_SITE_URL;
  const ck      = process.env.CONSUMER_KEY;
  const cs      = process.env.CONSUMER_SECRET;

  try {
    const url         = `${siteUrl}/wp-json/wc/v3/orders/${id}`;
    const credentials = Buffer.from(`${ck}:${cs}`).toString('base64');
    const response    = await fetch(url, {
      headers: { 'Authorization': `Basic ${credentials}` }
    });
    const data = await response.json();

    // Return only meta_data for clarity
    return res.status(200).json({
      order_id:  data.id,
      status:    data.status,
      billing:   { name: `${data.billing?.first_name} ${data.billing?.last_name}`, phone: data.billing?.phone, email: data.billing?.email },
      meta_data: data.meta_data?.filter(m => !m.key.startsWith('_')) || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
