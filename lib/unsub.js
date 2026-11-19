// Shared helpers for the unsubscribe link: signed links, so nobody can unsubscribe somebody else by guessing.
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const secret = () => String(process.env.UNSUB_SECRET || process.env.RELAY_TOKEN || '').trim();
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const sign = email => b64u(crypto.createHmac('sha256', secret()).update('unsub1:' + String(email).trim().toLowerCase()).digest()).slice(0, 27);
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;

function makeLink(base, email) {
  const e = String(email).trim().toLowerCase();
  return base.replace(/\/+$/, '') + '/u?e=' + b64u(e) + '&s=' + sign(e);
}
// returns the email if the link is genuine, otherwise ''
function readLink(query) {
  try {
    const email = fromB64u(String((query && query.e) || '')).trim().toLowerCase();
    const s = String((query && query.s) || '');
    const want = sign(email);
    if (!secret() || !EMAIL.test(email) || s.length !== want.length) return '';
    return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)) ? email : '';
  } catch (e) { return ''; }
}
function baseUrl(req) {
  if (process.env.UNSUB_BASE_URL) return String(process.env.UNSUB_BASE_URL).trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? 'https://' + host : '';
}
function transporter() {
  const user = String(process.env.SMTP_USER || '').trim(), pass = String(process.env.SMTP_PASS || '').trim();
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  return {
    user,
    t: nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hostinger.com', port, secure: port === 465, auth: { user, pass },
      ignoreTLS: process.env.SMTP_IGNORE_TLS === '1', connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 25000
    })
  };
}
module.exports = { sign, makeLink, readLink, baseUrl, transporter, EMAIL, b64u };
