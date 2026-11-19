// Tiny mail relay: n8n (which cannot use SMTP on Render's free plan) calls this over HTTPS,
// and this function sends the mail through your Hostinger mailbox. It does nothing else.
const crypto = require('crypto');
const { makeLink, baseUrl, transporter, EMAIL } = require('../lib/unsub');

const addrOf = s => ((String(s || '').match(/<([^<>]+)>/) || [])[1] || String(s || '')).trim().toLowerCase();
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const RELAY_TOKEN = process.env.RELAY_TOKEN, SMTP_USER = String(process.env.SMTP_USER || '').trim(), SMTP_PASS = String(process.env.SMTP_PASS || '').trim(); // trim: a stray space pasted into Vercel breaks the login
  if (!RELAY_TOKEN || !SMTP_USER || !SMTP_PASS) return res.status(500).json({ ok: false, error: 'Relay is not configured: set RELAY_TOKEN, SMTP_USER, SMTP_PASS in Vercel.' });
  if (!same(req.headers['x-relay-token'], RELAY_TOKEN)) return res.status(401).json({ ok: false, error: 'bad token' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const to = String(b.to || '').trim(), subject = String(b.subject || '').trim();
  let text = String(b.text || '');
  const from = String(b.from || '').trim() || SMTP_USER;
  if (!EMAIL.test(to)) return res.status(400).json({ ok: false, error: 'to must be exactly one email address' });
  if (!subject || subject.length > 300 || /[\r\n]/.test(subject)) return res.status(400).json({ ok: false, error: 'bad subject' });
  if (!text.trim() || text.length > 20000) return res.status(400).json({ ok: false, error: 'bad text' });
  if (addrOf(from) !== SMTP_USER.trim().toLowerCase() || /[\r\n]/.test(from)) return res.status(400).json({ ok: false, error: 'from must be your own mailbox', got: addrOf(from), expected: SMTP_USER.trim().toLowerCase() });

  const mail = { from, to, subject, text };
  if (b.unsubscribe === true || b.unsubscribe === 'true') {
    // a personal, signed unsubscribe link for this buyer. [[UNSUB_URL]] in the text is replaced by it.
    const base = baseUrl(req);
    if (!base) return res.status(500).json({ ok: false, error: 'cannot work out the relay address for the unsubscribe link; set UNSUB_BASE_URL in Vercel' });
    const link = makeLink(base, to);
    text = text.includes('[[UNSUB_URL]]') ? text.split('[[UNSUB_URL]]').join(link) : text.replace(/\s+$/, '') + '\n\nUnsubscribe: ' + link;
    mail.text = text;
    // Gmail / Apple Mail show their own "Unsubscribe" button from these headers (RFC 8058 one-click), plus a mailto fallback
    // exactly ONE List-Unsubscribe header holding both addresses (that is what RFC 8058 and Gmail expect)
    mail.headers = {
      'List-Unsubscribe': { prepared: true, value: '<' + link + '>, <mailto:' + SMTP_USER + '?subject=unsubscribe>' },
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
  }
  if (/\[\[[A-Z_]+\]\]/.test(mail.text)) return res.status(400).json({ ok: false, error: 'the text still contains an unreplaced [[...]] placeholder' });

  const { t: transport } = transporter();
  try {
    const info = await transport.sendMail(mail);
    if (!info.accepted || !info.accepted.length) return res.status(502).json({ ok: false, error: 'server did not accept the recipient', rejected: info.rejected });
    return res.status(200).json({ ok: true, messageId: info.messageId, accepted: info.accepted });
  } catch (e) {
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    return res.status(502).json({ ok: false, error: String(e && e.message || e).slice(0, 300), code: e && e.responseCode, debug: { user: SMTP_USER, user_length: SMTP_USER.length, pass_length: SMTP_PASS.length, host: process.env.SMTP_HOST || 'smtp.hostinger.com', port } });
  }
};
