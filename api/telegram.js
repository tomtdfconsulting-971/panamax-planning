// api/telegram.js — Envoie une notification Telegram à l'admin

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  if (!message)    return res.status(400).json({ error: 'Message manquant' });
  if (!BOT_TOKEN)  return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN manquant' });
  if (!CHAT_ID)    return res.status(500).json({ error: 'TELEGRAM_CHAT_ID manquant' });

  try {
    const res2 = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    CHAT_ID,
        text:       message,
        parse_mode: 'HTML',
      }),
    });

    const data = await res2.json();
    if (!data.ok) {
      console.error('Telegram API error:', data);
      return res.status(400).json({ error: data.description });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('telegram error:', err);
    return res.status(500).json({ error: err.message });
  }
}
