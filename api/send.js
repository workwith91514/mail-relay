// Tiny mail relay: n8n (which cannot use SMTP on Render's free plan) calls this over HTTPS,
// and this function sends the mail through your Hostinger mailbox. It does nothing else.
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const addrOf = s => ((String(s || '').match(/<([^<>]+)>/) || [])[1] || String(s || '')).trim().toLowerCase();
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { RELAY_TOKEN, SMTP_USER, SMTP_PASS } = process.env;
  if (!RELAY_TOKEN || !SMTP_USER || !SMTP_PASS) return res.status(500).json({ ok: false, error: 'Relay is not configured: set RELAY_TOKEN, SMTP_USER, SMTP_PASS in Vercel.' });
  if (!same(req.headers['x-relay-token'], RELAY_TOKEN)) return res.status(401).json({ ok: false, error: 'bad token' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const to = String(b.to || '').trim(), subject = String(b.subject || '').trim(), text = String(b.text || '');
  const from = String(b.from || '').trim() || SMTP_USER;
  if (!EMAIL.test(to)) return res.status(400).json({ ok: false, error: 'to must be exactly one email address' });
  if (!subject || subject.length > 300 || /[\r\n]/.test(subject)) return res.status(400).json({ ok: false, error: 'bad subject' });
  if (!text.trim() || text.length > 20000) return res.status(400).json({ ok: false, error: 'bad text' });
  if (addrOf(from) !== SMTP_USER.toLowerCase() || /[\r\n]/.test(from)) return res.status(400).json({ ok: false, error: 'from must be your own mailbox' });

  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com', port, secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    ignoreTLS: process.env.SMTP_IGNORE_TLS === '1', // only for local tests
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 25000
  });
  try {
    const info = await transporter.sendMail({ from, to, subject, text });
    if (!info.accepted || !info.accepted.length) return res.status(502).json({ ok: false, error: 'server did not accept the recipient', rejected: info.rejected });
    return res.status(200).json({ ok: true, messageId: info.messageId, accepted: info.accepted });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e && e.message || e).slice(0, 300), code: e && e.responseCode });
  }
};
