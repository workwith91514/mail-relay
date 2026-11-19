// Unsubscribe page for the "Unsubscribe" link in every mail.
//  GET / HEAD : only SHOWS a page with a button (mail scanners such as Microsoft Safe Links open links by themselves; this must never unsubscribe anybody).
//  POST       : really unsubscribes. Used by the button on the page AND by Gmail / Apple Mail one-click unsubscribe (RFC 8058).
// The buyer is recorded as do_not_contact in your Google Sheet through the n8n workflow 11_UNSUBSCRIBE.
const { readLink, transporter } = require('../lib/unsub');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COMPANY = () => String(process.env.COMPANY_NAME || 'Vishwakarma Industries');

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--ink:#1c1c1c;--mut:#666;--ac:#1f3a5f;--bd:#e3e0d8}@media(prefers-color-scheme:dark){:root{--bg:#161616;--card:#212121;--ink:#eee;--mut:#aaa;--ac:#7fa6d8;--bd:#333}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
main{background:var(--card);border:1px solid var(--bd);border-radius:12px;max-width:460px;width:100%;padding:28px 24px}
h1{font-size:20px;margin:0 0 12px}p{margin:0 0 12px}.m{color:var(--mut);font-size:14px}.e{font-weight:600;word-break:break-all}
button{background:var(--ac);color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:16px;cursor:pointer;width:100%}@media(prefers-color-scheme:dark){button{color:#111}}</style></head><body><main>${inner}</main></body></html>`;
}
const confirmPage = email => page('Unsubscribe', `<h1>Unsubscribe</h1><p>Stop all emails from ${esc(COMPANY())} to:</p><p class="e">${esc(email)}</p>
<form method="post"><button type="submit">Yes, unsubscribe me</button></form>
<p class="m" style="margin-top:16px">Abmelden: Mit einem Klick erhalten Sie keine weiteren E-Mails von ${esc(COMPANY())} an diese Adresse.</p>`);
const donePage = email => page('Unsubscribed', `<h1>You are unsubscribed</h1><p>${esc(email)} will not receive any more emails from ${esc(COMPANY())}. Sorry to have bothered you.</p>
<p class="m">Sie wurden abgemeldet und erhalten keine weiteren E-Mails von uns.</p>`);
const badPage = () => page('Link not valid', `<h1>This link is not valid</h1><p>Please reply to any of our emails with the word <b>remove</b> and we will take you off the list straight away.</p>
<p class="m">Dieser Link ist ungültig. Bitte antworten Sie auf eine unserer E-Mails mit "remove" (Abmelden).</p>`);

async function record(email, source) { // tell n8n (two tries); returns true if the Sheet was updated
  const url = String(process.env.N8N_UNSUB_URL || '').trim();
  if (!url) return false;
  for (let i = 0; i < 2; i++) {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 11000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-token': String(process.env.RELAY_TOKEN || '') }, body: JSON.stringify({ email, source }), signal: ac.signal });
      clearTimeout(timer);
      if (r.ok) return true;
    } catch (e) { clearTimeout(timer); }
  }
  return false;
}
async function alertOwner(email, source) { // n8n could not be reached: never lose the request, tell the owner by mail
  try {
    const { user, t } = transporter(); if (!user) return;
    await t.sendMail({ from: user, to: user, subject: '[ACTION NEEDED] opt-out not recorded: ' + email,
      text: `${email} used the unsubscribe link (${source}) but the Google Sheet could not be updated (n8n not reachable).\n\nPlease open the Contacts tab, find this email and type do_not_contact in the status column. Do not email this person again.` });
  } catch (e) { /* nothing more we can do */ }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const html = (code, body) => { res.status(code).setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(body); };
  const q = req.query && Object.keys(req.query).length ? req.query : Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const email = readLink(q);
  if (!email) return html(400, badPage());

  if (req.method === 'GET' || req.method === 'HEAD') return html(200, confirmPage(email)); // read-only on purpose

  if (req.method === 'POST') {
    const oneClick = /List-Unsubscribe=One-Click/i.test(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const source = oneClick ? 'one-click (mail app)' : 'link';
    const ok = await record(email, source);
    if (!ok) await alertOwner(email, source);
    const wantsHtml = /text\/html/.test(String(req.headers.accept || ''));
    return wantsHtml ? html(200, donePage(email)) : res.status(200).json({ ok: true });
  }
  res.setHeader('Allow', 'GET, HEAD, POST');
  return res.status(405).json({ ok: false, error: 'method not allowed' });
};
