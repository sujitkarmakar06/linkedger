'use strict';
/*
 * LinkLedger - Backlink Exchange & SEO Ops Manager
 * Single-file Express backend. PostgreSQL via pg Pool. Idempotent migrations on boot.
 * No fabricated data: integrations return honest errors / empty states when a source
 * cannot be reached. Secrets are read from env vars only (never hard-coded).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /render\.com|amazonaws|supabase|neon\.tech/.test(DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

// ---------------------------------------------------------------------------
// Migrations: run numbered db/*.sql idempotently on boot. Never destructive.
// ---------------------------------------------------------------------------
async function migrate() {
  const dir = path.join(__dirname, 'db');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      await pool.query(sql);
      console.log('[migrate] applied', f);
    } catch (e) {
      console.error('[migrate] FAILED', f, e.message);
      throw e;
    }
  }
  // ensure at least one geo_files row per kind exists lazily; nothing seeded with fake data.
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '8mb' }));

function sign(user) {
  return jwt.sign({ uid: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'auth required' });
  try { req.user = jwt.verify(tok, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'invalid token' }); }
}
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error('[err]', req.method, req.path, e.message);
  res.status(500).json({ error: e.message || 'server error' });
});
function normDomain(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}
function envOrNull(k) { const v = process.env[k]; return v && v.trim() ? v.trim() : null; }

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const exists = await pool.query('SELECT 1 FROM users WHERE email=$1', [email.toLowerCase()]);
  if (exists.rowCount) return res.status(409).json({ error: 'account already exists' });
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query('INSERT INTO users (email,password_hash,name) VALUES ($1,$2,$3) RETURNING id,email,name',
    [email.toLowerCase(), hash, name || null]);
  res.json({ token: sign(r.rows[0]), user: r.rows[0] });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const r = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
  if (!r.rowCount) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, r.rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token: sign(r.rows[0]), user: { id: r.rows[0].id, email: r.rows[0].email, name: r.rows[0].name } });
}));

app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT id,email,name FROM users WHERE id=$1', [req.user.uid]);
  res.json({ user: r.rows[0] || null });
}));

// ---------------------------------------------------------------------------
// Exchanges
// ---------------------------------------------------------------------------
app.get('/api/exchanges', auth, wrap(async (req, res) => {
  const { q, status, owner, month, link_type } = req.query;
  const where = []; const args = [];
  if (q) { args.push('%' + q + '%'); where.push(`(prospect_domain ILIKE $${args.length} OR anchor_text ILIKE $${args.length} OR our_target_url ILIKE $${args.length})`); }
  if (status) { args.push(status); where.push(`status=$${args.length}`); }
  if (owner) { args.push(owner); where.push(`owner_name=$${args.length}`); }
  if (month) { args.push(month); where.push(`month_label=$${args.length}`); }
  if (link_type) { args.push(link_type); where.push(`link_type=$${args.length}`); }
  const sql = 'SELECT * FROM exchanges' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC';
  const r = await pool.query(sql, args);
  res.json({ rows: r.rows });
}));

app.post('/api/exchanges', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.prospect_domain) return res.status(400).json({ error: 'prospect_domain required' });
  const r = await pool.query(
    `INSERT INTO exchanges (prospect_domain,our_target_url,anchor_text,link_type,domain_rating,owner_name,website_name,status,month_label,contact_name,contact_email,notes,sr_raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [normDomain(b.prospect_domain), b.our_target_url || null, b.anchor_text || null, b.link_type || 'dofollow',
     b.domain_rating != null ? parseInt(b.domain_rating, 10) : null, b.owner_name || null, b.website_name || null,
     b.status || 'pending', b.month_label || null, b.contact_name || null, b.contact_email || null, b.notes || null,
     b.sr_raw ? JSON.stringify(b.sr_raw) : null]);
  res.json({ row: r.rows[0] });
}));

app.put('/api/exchanges/:id', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const fields = ['prospect_domain','blog_url','our_target_url','anchor_text','link_type','domain_rating','owner_name','website_name','status','link_status','month_label','contact_name','contact_email','reciprocal_source','reciprocal_anchor','reciprocal_target','notes'];
  const sets = []; const args = [];
  for (const f of fields) if (f in b) { args.push(f === 'domain_rating' && b[f] != null ? parseInt(b[f], 10) : (f === 'prospect_domain' ? normDomain(b[f]) : b[f])); sets.push(`${f}=$${args.length}`); }
  if (!sets.length) return res.json({ row: null });
  args.push(req.params.id);
  const r = await pool.query(`UPDATE exchanges SET ${sets.join(',')}, updated_at=now() WHERE id=$${args.length} RETURNING *`, args);
  res.json({ row: r.rows[0] });
}));

app.delete('/api/exchanges/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM exchanges WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/exchanges/bulk-delete', auth, wrap(async (req, res) => {
  const ids = (req.body && req.body.ids) || [];
  if (!ids.length) return res.json({ ok: true, deleted: 0 });
  const r = await pool.query('DELETE FROM exchanges WHERE id = ANY($1::int[])', [ids]);
  res.json({ ok: true, deleted: r.rowCount });
}));

app.get('/api/exchanges/:id/comments', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM exchange_comments WHERE exchange_id=$1 ORDER BY created_at', [req.params.id]);
  res.json({ rows: r.rows });
}));
app.post('/api/exchanges/:id/comments', auth, wrap(async (req, res) => {
  const body = (req.body && req.body.body) || '';
  if (!body.trim()) return res.status(400).json({ error: 'comment body required' });
  const r = await pool.query('INSERT INTO exchange_comments (exchange_id,author,body) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, req.user.name || req.user.email, body]);
  res.json({ row: r.rows[0] });
}));

// ---------------------------------------------------------------------------
// Dashboard aggregates
// ---------------------------------------------------------------------------
app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const total = await pool.query('SELECT count(*)::int AS n FROM exchanges');
  const live = await pool.query("SELECT count(*)::int AS n FROM exchanges WHERE status='live'");
  const byStatus = await pool.query('SELECT status, count(*)::int AS n FROM exchanges GROUP BY status ORDER BY n DESC');
  const byOwner = await pool.query("SELECT COALESCE(owner_name,'-') AS owner, count(*)::int AS n FROM exchanges GROUP BY owner_name ORDER BY n DESC");
  const byMonth = await pool.query("SELECT COALESCE(month_label,'-') AS month, count(*)::int AS n FROM exchanges GROUP BY month_label ORDER BY month");
  const thisMonth = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
  const tm = await pool.query('SELECT count(*)::int AS n FROM exchanges WHERE month_label=$1', [thisMonth]);
  res.json({
    total: total.rows[0].n, live: live.rows[0].n, this_month: tm.rows[0].n, this_month_label: thisMonth,
    by_status: byStatus.rows, by_owner: byOwner.rows, by_month: byMonth.rows,
  });
}));

// ---------------------------------------------------------------------------
// Prospects (editable database + comments)
// ---------------------------------------------------------------------------
app.get('/api/prospects', auth, wrap(async (req, res) => {
  const { q, status, owner } = req.query;
  const where = []; const args = [];
  if (q) { args.push('%' + q + '%'); where.push(`(domain ILIKE $${args.length} OR contact_name ILIKE $${args.length} OR niche ILIKE $${args.length})`); }
  if (status) { args.push(status); where.push(`status=$${args.length}`); }
  if (owner) { args.push(owner); where.push(`owner_name=$${args.length}`); }
  const sql = 'SELECT * FROM prospects' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY domain_rating DESC NULLS LAST, domain';
  const r = await pool.query(sql, args);
  res.json({ rows: r.rows });
}));
app.post('/api/prospects', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.domain) return res.status(400).json({ error: 'domain required' });
  const r = await pool.query(
    `INSERT INTO prospects (domain,contact_name,contact_email,domain_rating,status,niche,sites_offered,owner_name,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (domain) DO UPDATE SET contact_name=COALESCE(EXCLUDED.contact_name,prospects.contact_name)
     RETURNING *`,
    [normDomain(b.domain), b.contact_name || null, b.contact_email || null,
     b.domain_rating != null && b.domain_rating !== '' ? parseInt(b.domain_rating, 10) : null,
     b.status || 'active', b.niche || null, b.sites_offered || null, b.owner_name || null, b.notes || null]);
  res.json({ row: r.rows[0] });
}));
app.put('/api/prospects/:id', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const fields = ['domain','contact_name','contact_email','domain_rating','status','niche','sites_offered','owner_name','notes'];
  const sets = []; const args = [];
  for (const f of fields) if (f in b) { args.push(f === 'domain_rating' && b[f] !== '' && b[f] != null ? parseInt(b[f], 10) : (f === 'domain' ? normDomain(b[f]) : b[f])); sets.push(`${f}=$${args.length}`); }
  if (!sets.length) return res.json({ row: null });
  args.push(req.params.id);
  const r = await pool.query(`UPDATE prospects SET ${sets.join(',')}, updated_at=now() WHERE id=$${args.length} RETURNING *`, args);
  res.json({ row: r.rows[0] });
}));
app.delete('/api/prospects/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM prospects WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));
app.get('/api/prospects/:id/comments', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM prospect_comments WHERE prospect_id=$1 ORDER BY created_at', [req.params.id]);
  res.json({ rows: r.rows });
}));
app.post('/api/prospects/:id/comments', auth, wrap(async (req, res) => {
  const body = (req.body && req.body.body) || '';
  if (!body.trim()) return res.status(400).json({ error: 'comment body required' });
  const r = await pool.query('INSERT INTO prospect_comments (prospect_id,author,body) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, req.user.name || req.user.email, body]);
  res.json({ row: r.rows[0] });
}));

// ---------------------------------------------------------------------------
// Websites & Members
// ---------------------------------------------------------------------------
for (const [route, table, cols] of [
  ['websites', 'websites', ['website_name', 'domain']],
  ['members', 'members', ['name', 'role']],
]) {
  app.get('/api/' + route, auth, wrap(async (req, res) => {
    const r = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`); res.json({ rows: r.rows });
  }));
  app.post('/api/' + route, auth, wrap(async (req, res) => {
    const b = req.body || {};
    const vals = cols.map(c => b[c] || null);
    const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
    const r = await pool.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals);
    res.json({ row: r.rows[0] });
  }));
  app.delete('/api/' + route + '/:id', auth, wrap(async (req, res) => {
    await pool.query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]); res.json({ ok: true });
  }));
}

// ---------------------------------------------------------------------------
// Outreach pipeline + templates + settings
// ---------------------------------------------------------------------------
app.get('/api/outreach', auth, wrap(async (req, res) => {
  const { status, owner, pitch_type } = req.query;
  const where = []; const args = [];
  if (status) { args.push(status); where.push(`outreach_status=$${args.length}`); }
  if (owner) { args.push(owner); where.push(`owner_name=$${args.length}`); }
  if (pitch_type) { args.push(pitch_type); where.push(`pitch_type=$${args.length}`); }
  const r = await pool.query('SELECT * FROM outreach' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated_at DESC', args);
  res.json({ rows: r.rows });
}));
app.post('/api/outreach', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.domain) return res.status(400).json({ error: 'domain required' });
  const r = await pool.query(
    `INSERT INTO outreach (domain,pitch_type,outreach_status,contact_name,contact_email,owner_name,qualified,domain_rating,traffic,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [normDomain(b.domain), b.pitch_type || null, b.outreach_status || 'prospect', b.contact_name || null,
     b.contact_email || null, b.owner_name || null, b.qualified == null ? null : !!b.qualified,
     b.domain_rating != null ? parseInt(b.domain_rating, 10) : null, b.traffic != null ? parseInt(b.traffic, 10) : null, b.notes || null]);
  res.json({ row: r.rows[0] });
}));
app.put('/api/outreach/:id', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const fields = ['domain','pitch_type','outreach_status','contact_name','contact_email','owner_name','qualified','domain_rating','traffic','notes'];
  const sets = []; const args = [];
  for (const f of fields) if (f in b) { args.push(b[f]); sets.push(`${f}=$${args.length}`); }
  if (!sets.length) return res.json({ row: null });
  args.push(req.params.id);
  const r = await pool.query(`UPDATE outreach SET ${sets.join(',')}, updated_at=now() WHERE id=$${args.length} RETURNING *`, args);
  res.json({ row: r.rows[0] });
}));
app.delete('/api/outreach/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM outreach WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));

app.get('/api/outreach-templates', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM outreach_templates ORDER BY id DESC'); res.json({ rows: r.rows });
}));
app.post('/api/outreach-templates', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query('INSERT INTO outreach_templates (name,pitch_type,subject,body) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.name || 'Untitled', b.pitch_type || null, b.subject || null, b.body || null]);
  res.json({ row: r.rows[0] });
}));
app.get('/api/outreach-settings', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM outreach_settings WHERE id=1'); res.json({ row: r.rows[0] });
}));
app.put('/api/outreach-settings', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query('UPDATE outreach_settings SET min_dr=COALESCE($1,min_dr),min_traffic=COALESCE($2,min_traffic),sender_name=COALESCE($3,sender_name),sender_signature=COALESCE($4,sender_signature) WHERE id=1 RETURNING *',
    [b.min_dr != null ? parseInt(b.min_dr,10) : null, b.min_traffic != null ? parseInt(b.min_traffic,10) : null, b.sender_name || null, b.sender_signature || null]);
  res.json({ row: r.rows[0] });
}));

console.log('[boot] core routes registered');

// ===========================================================================
// Integration helpers (all keys from env; honest errors when unreachable)
// ===========================================================================
async function jfetch(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!r.ok) {
    const msg = (json && (json.error_description || json.error || (json.error && json.error.message))) || text || ('HTTP ' + r.status);
    const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)); e.status = r.status; e.body = json || text; throw e;
  }
  return json;
}

async function getToken(purpose) {
  const r = await pool.query('SELECT * FROM integration_tokens WHERE purpose=$1', [purpose]);
  return r.rows[0] || null;
}
async function saveToken(purpose, { access_token, refresh_token, expires_in, meta }) {
  const expiry = expires_in ? new Date(Date.now() + (expires_in - 60) * 1000) : null;
  await pool.query(
    `INSERT INTO integration_tokens (purpose,access_token,refresh_token,expiry,meta,updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (purpose) DO UPDATE SET access_token=EXCLUDED.access_token,
       refresh_token=COALESCE(EXCLUDED.refresh_token, integration_tokens.refresh_token),
       expiry=EXCLUDED.expiry, meta=COALESCE(EXCLUDED.meta, integration_tokens.meta), updated_at=now()`,
    [purpose, access_token || null, refresh_token || null, expiry, meta ? JSON.stringify(meta) : null]);
}

// Google OAuth (shared by GSC-read + Gmail-send). Refresh token stored per purpose.
async function googleAccessToken(purpose) {
  const clientId = envOrNull('GOOGLE_CLIENT_ID');
  const clientSecret = envOrNull('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  const tok = await getToken(purpose);
  let refresh = (tok && tok.refresh_token) || (purpose === 'gsc' ? envOrNull('GSC_REFRESH_TOKEN') : envOrNull('GMAIL_REFRESH_TOKEN'));
  if (tok && tok.access_token && tok.expiry && new Date(tok.expiry) > new Date()) return tok.access_token;
  if (!refresh) throw new Error('Not connected. Authorize ' + purpose + ' first.');
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' });
  const j = await jfetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  await saveToken(purpose, { access_token: j.access_token, expires_in: j.expires_in });
  return j.access_token;
}

function googleAuthUrl(purpose) {
  const clientId = envOrNull('GOOGLE_CLIENT_ID');
  const redirect = purpose === 'gsc' ? envOrNull('GSC_REDIRECT_URI') : envOrNull('GOOGLE_REDIRECT_URI');
  const scope = purpose === 'gsc'
    ? 'https://www.googleapis.com/auth/webmasters.readonly'
    : 'https://www.googleapis.com/auth/gmail.send';
  if (!clientId || !redirect) throw new Error('Missing GOOGLE_CLIENT_ID or redirect URI for ' + purpose + '.');
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code',
    access_type: 'offline', prompt: 'consent', scope, state: purpose });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

app.get('/api/google/auth-url', auth, wrap(async (req, res) => {
  const purpose = req.query.for === 'gmail' ? 'gmail' : 'gsc';
  res.json({ url: googleAuthUrl(purpose) });
}));

// OAuth callback (browser GET, no auth header). state carries purpose.
async function handleGoogleCallback(req, res) {
  const code = req.query.code; const purpose = req.query.state === 'gmail' ? 'gmail' : 'gsc';
  if (!code) return res.status(400).send('Missing code');
  const clientId = envOrNull('GOOGLE_CLIENT_ID'); const clientSecret = envOrNull('GOOGLE_CLIENT_SECRET');
  const redirect = purpose === 'gsc' ? envOrNull('GSC_REDIRECT_URI') : envOrNull('GOOGLE_REDIRECT_URI');
  try {
    const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' });
    const j = await jfetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    await saveToken(purpose, { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in });
    res.redirect('/?connected=' + purpose);
  } catch (e) { res.status(500).send('OAuth error: ' + e.message); }
}
app.get('/api/google/callback', wrap(handleGoogleCallback));  // Gmail
app.get('/api/gmail/callback', wrap(handleGoogleCallback));   // alias per spec redirect URIs

app.get('/api/integrations/status', auth, wrap(async (req, res) => {
  const rows = await pool.query('SELECT purpose, (refresh_token IS NOT NULL) AS connected, (access_token IS NOT NULL) AS has_token, updated_at FROM integration_tokens');
  const map = {}; rows.rows.forEach(r => { map[r.purpose] = { connected: r.connected, has_token: r.has_token, updated_at: r.updated_at }; });
  res.json({
    gsc: { configured: !!(envOrNull('GOOGLE_CLIENT_ID') && envOrNull('GSC_REDIRECT_URI')), connected: !!(map.gsc && map.gsc.connected) || !!envOrNull('GSC_REFRESH_TOKEN') },
    gmail: { configured: !!(envOrNull('GOOGLE_CLIENT_ID') && envOrNull('GOOGLE_REDIRECT_URI')), connected: !!(map.gmail && map.gmail.connected) },
    linkedin: { configured: !!envOrNull('LINKEDIN_CLIENT_ID'), connected: !!(map.linkedin && (map.linkedin.connected || map.linkedin.has_token)) },
    ahrefs: { configured: !!envOrNull('AHREFS_API_KEY') },
    moz: { configured: !!(envOrNull('MOZ_ACCESS_ID') && envOrNull('MOZ_SECRET_KEY')) },
    pagespeed: { configured: true, keyed: !!envOrNull('PAGESPEED_API_KEY') },
    semrush: { configured: !!envOrNull('SEMRUSH_API_KEY') },
    facebook: { configured: !!(envOrNull('FACEBOOK_APP_ID') && envOrNull('FACEBOOK_APP_SECRET')), connected: !!(map.facebook && (map.facebook.connected || map.facebook.has_token)) },
    instagram: { configured: !!envOrNull('INSTAGRAM_ACCESS_TOKEN'), connected: !!(map.instagram && (map.instagram.connected || map.instagram.has_token)) },
    twitter: { configured: !!envOrNull('TWITTER_BEARER_TOKEN'), connected: !!(map.twitter && (map.twitter.connected || map.twitter.has_token)) },
  });
}));

// --- GSC summary -----------------------------------------------------------
app.get('/api/google/gsc-summary', auth, wrap(async (req, res) => {
  const site = envOrNull('GSC_SITE_URL');
  if (!site) return res.status(400).json({ error: 'GSC_SITE_URL not set.' });
  const token = await googleAccessToken('gsc');
  const end = new Date(); const start = new Date(); start.setDate(end.getDate() - (parseInt(req.query.days, 10) || 28));
  const fmt = d => d.toISOString().slice(0, 10);
  const j = await jfetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: ['query'], rowLimit: 5000 }) });
  const rows = (j && j.rows) || [];
  let clicks = 0, impressions = 0, posSum = 0, top10 = 0;
  rows.forEach(r => { clicks += r.clicks || 0; impressions += r.impressions || 0; posSum += (r.position || 0) * (r.impressions || 1); if ((r.position || 99) <= 10) top10++; });
  const ctr = impressions ? +((clicks * 1000 / impressions) / 10).toFixed(1) : 0;
  const position = impressions ? +(posSum / impressions).toFixed(1) : null;
  res.json({ clicks, impressions, ctr, position, keywords_top10: top10, queries: rows.length, range_days: (parseInt(req.query.days,10)||28) });
}));

// --- PageSpeed -------------------------------------------------------------
// Pure parser (unit-tested) - extracts performance score + LCP from a
// PageSpeed Insights v5 response. Separated so it can be tested offline.
function parsePageSpeed(j, target) {
  const lr = j && j.lighthouseResult;
  if (!lr) {
    const apiErr = j && j.error && (j.error.message || j.error);
    throw new Error('PageSpeed returned no lighthouseResult' + (apiErr ? (': ' + apiErr) : '') + '.');
  }
  const rawScore = lr.categories && lr.categories.performance && lr.categories.performance.score;
  const lcpAudit = lr.audits && lr.audits['largest-contentful-paint'];
  const lcp = lcpAudit && lcpAudit.numericValue;
  return {
    url: target,
    score: rawScore != null ? Math.round(rawScore * 100) : null,
    lcp_seconds: lcp != null ? +(lcp / 1000).toFixed(1) : null,
  };
}

async function runPageSpeed(url) {
  const key = envOrNull('PAGESPEED_API_KEY');      // optional: raises quota when set
  const target = url || envOrNull('PAGESPEED_URL');
  if (!target) throw new Error('No URL given and PAGESPEED_URL not set.');
  const u = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&category=performance&url='
    + encodeURIComponent(target) + (key ? ('&key=' + key) : '');
  const j = await jfetch(u);
  return parsePageSpeed(j, target);
}

// --- Ahrefs DR + traffic ---------------------------------------------------
async function ahrefsLookup(domain) {
  const key = envOrNull('AHREFS_API_KEY');
  if (!key) throw new Error('AHREFS_API_KEY not set.');
  const target = normDomain(domain);
  const date = new Date().toISOString().slice(0, 10);
  const headers = { authorization: 'Bearer ' + key, accept: 'application/json' };
  let dr = null, traffic = null;
  try {
    const drj = await jfetch(`https://api.ahrefs.com/v3/site-explorer/domain-rating?target=${encodeURIComponent(target)}&date=${date}`, { headers });
    dr = (drj && (drj.domain_rating != null ? drj.domain_rating : (drj.domain_rating && drj.domain_rating.domain_rating))) ?? (drj && drj.domainRating) ?? null;
    if (dr && typeof dr === 'object') dr = dr.domain_rating ?? null;
  } catch (e) { /* surface below if both fail */ }
  try {
    const mj = await jfetch(`https://api.ahrefs.com/v3/site-explorer/metrics?target=${encodeURIComponent(target)}&date=${date}&volume_mode=monthly`, { headers });
    const m = (mj && (mj.metrics || mj)) || {};
    traffic = m.org_traffic ?? m.organic_traffic ?? null;
  } catch (e) { /* surface below if both fail */ }
  if (dr == null && traffic == null) throw new Error('Ahrefs returned no DR/traffic for ' + target + ' (check API plan/endpoints).');
  return { domain: target, domain_rating: dr != null ? Math.round(dr) : null, traffic: traffic != null ? Math.round(traffic) : null };
}

// --- Moz DA + PA -----------------------------------------------------------
async function mozLookup(domain) {
  const id = envOrNull('MOZ_ACCESS_ID'); const secret = envOrNull('MOZ_SECRET_KEY');
  if (!id || !secret) throw new Error('Moz not configured (MOZ_ACCESS_ID / MOZ_SECRET_KEY).');
  const target = normDomain(domain);
  const authB64 = Buffer.from(id + ':' + secret).toString('base64');
  const j = await jfetch('https://lsapi.seomoz.com/v2/url_metrics',
    { method: 'POST', headers: { authorization: 'Basic ' + authB64, 'content-type': 'application/json' },
      body: JSON.stringify({ targets: [target] }) });
  const m = (j && j.results && j.results[0]) || {};
  if (m.domain_authority == null && m.page_authority == null) throw new Error('Moz returned no metrics for ' + target + '.');
  return { domain: target, domain_authority: m.domain_authority ?? null, page_authority: m.page_authority ?? null, spam_score: m.spam_score ?? null };
}

app.get('/api/seo/ahrefs', auth, wrap(async (req, res) => { res.json(await ahrefsLookup(req.query.domain)); }));
app.get('/api/seo/moz', auth, wrap(async (req, res) => { res.json(await mozLookup(req.query.domain)); }));
app.get('/api/seo/qualify', auth, wrap(async (req, res) => {
  const s = await pool.query('SELECT min_dr,min_traffic FROM outreach_settings WHERE id=1');
  const { min_dr, min_traffic } = s.rows[0] || { min_dr: 30, min_traffic: 3000 };
  const out = { domain: normDomain(req.query.domain), min_dr, min_traffic, ahrefs: null, moz: null, qualified: null, reason: null };
  try { out.ahrefs = await ahrefsLookup(req.query.domain); } catch (e) { out.ahrefs_error = e.message; }
  if (envOrNull('MOZ_ACCESS_ID')) { try { out.moz = await mozLookup(req.query.domain); } catch (e) { out.moz_error = e.message; } }
  if (out.ahrefs && out.ahrefs.domain_rating != null && out.ahrefs.traffic != null) {
    out.qualified = out.ahrefs.domain_rating >= min_dr && out.ahrefs.traffic >= min_traffic;
    out.reason = out.qualified ? 'meets DR and traffic thresholds' : 'below DR or traffic threshold';
  } else { out.reason = 'insufficient data to qualify'; }
  res.json(out);
}));

console.log('[boot] integration routes registered');

// ===========================================================================
// Link Health checker (no headless browser on host; plain fetch + HTML scan)
// ===========================================================================
async function checkOneLink(ex) {
  const page = ex.our_target_url && /^https?:\/\//.test(ex.prospect_domain) ? ex.prospect_domain : ('https://' + ex.prospect_domain);
  const target = ex.our_target_url ? normDomain(ex.our_target_url) : null;
  try {
    const r = await fetch(page, { redirect: 'follow', headers: { 'user-agent': 'LinkLedgerBot/1.0 (+link-health)' } });
    const status = r.status;
    if (status === 404 || status === 410) return { state: 'missing', verdict: 'gone (' + status + ')', found_via: null };
    const html = await r.text();  // even 403 bodies are scanned per spec
    let found = false, via = null;
    if (target && html.toLowerCase().includes(target)) { found = true; via = 'url'; }
    if (!found && ex.anchor_text && html.toLowerCase().includes(ex.anchor_text.toLowerCase())) { found = true; via = 'anchor'; }
    if (found) return { state: 'alive', verdict: 'link present', found_via: via };
    if (status >= 400) return { state: 'unverifiable', verdict: 'blocked/' + status + ' - link not seen', found_via: null };
    return { state: 'missing', verdict: 'link not found on page', found_via: null };
  } catch (e) {
    return { state: 'unverifiable', verdict: 'fetch failed: ' + e.message, found_via: null };
  }
}

app.post('/api/link-health/run', auth, wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.body && req.body.limit, 10) || 40, 100);
  const ex = await pool.query('SELECT * FROM exchanges WHERE our_target_url IS NOT NULL ORDER BY last_checked_at NULLS FIRST LIMIT $1', [limit]);
  let alive = 0, missing = 0, unver = 0;
  for (const row of ex.rows) {
    const v = await checkOneLink(row);
    if (v.state === 'alive') alive++; else if (v.state === 'missing') missing++; else unver++;
    await pool.query('UPDATE exchanges SET verdict=$1,last_check_state=$2,found_via=$3,last_checked_at=now() WHERE id=$4',
      [v.verdict, v.state, v.found_via, row.id]);
  }
  const run = await pool.query('INSERT INTO link_check_runs (finished_at,total,alive,missing,unverifiable,run_by) VALUES (now(),$1,$2,$3,$4,$5) RETURNING *',
    [ex.rows.length, alive, missing, unver, req.user.name || req.user.email]);
  res.json({ run: run.rows[0], checked: ex.rows.length });
}));
app.get('/api/link-health/runs', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM link_check_runs ORDER BY started_at DESC LIMIT 50'); res.json({ rows: r.rows });
}));
app.get('/api/link-health/links', auth, wrap(async (req, res) => {
  const where = ['our_target_url IS NOT NULL']; const args = [];
  if (req.query.state) { args.push(req.query.state); where.push(`last_check_state=$${args.length}`); }
  if (req.query.owner) { args.push(req.query.owner); where.push(`owner_name=$${args.length}`); }
  const r = await pool.query('SELECT id,prospect_domain,our_target_url,anchor_text,owner_name,verdict,last_check_state,found_via,last_checked_at FROM exchanges WHERE ' + where.join(' AND ') + ' ORDER BY last_checked_at DESC NULLS LAST', args);
  res.json({ rows: r.rows });
}));

// ===========================================================================
// GEO / AI visibility
// ===========================================================================
app.get('/api/geo/snapshots', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM geo_snapshots ORDER BY snapshot_date DESC LIMIT 180'); res.json({ rows: r.rows });
}));
app.post('/api/geo/snapshots', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const date = b.snapshot_date || new Date().toISOString().slice(0, 10);
  const r = await pool.query(
    `INSERT INTO geo_snapshots (snapshot_date,avg_position,impressions,clicks,ctr,keywords_top10,geo_score,ai_citations,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (snapshot_date) DO UPDATE SET
       avg_position=COALESCE(EXCLUDED.avg_position, geo_snapshots.avg_position),
       impressions=COALESCE(EXCLUDED.impressions, geo_snapshots.impressions),
       clicks=COALESCE(EXCLUDED.clicks, geo_snapshots.clicks),
       ctr=COALESCE(EXCLUDED.ctr, geo_snapshots.ctr),
       keywords_top10=COALESCE(EXCLUDED.keywords_top10, geo_snapshots.keywords_top10),
       geo_score=COALESCE(EXCLUDED.geo_score, geo_snapshots.geo_score),
       ai_citations=COALESCE(EXCLUDED.ai_citations, geo_snapshots.ai_citations),
       source=COALESCE(EXCLUDED.source, geo_snapshots.source)
     RETURNING *`,
    [date, b.avg_position ?? null, b.impressions ?? null, b.clicks ?? null, b.ctr ?? null,
     b.keywords_top10 ?? null, b.geo_score ?? null, b.ai_citations ?? null, b.source || 'manual']);
  res.json({ row: r.rows[0] });
}));

app.get('/api/geo/files', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM geo_files ORDER BY kind'); res.json({ rows: r.rows });
}));
app.put('/api/geo/files', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.kind) return res.status(400).json({ error: 'kind required' });
  const ex = await pool.query('SELECT id FROM geo_files WHERE kind=$1', [b.kind]);
  let row;
  if (ex.rowCount) row = (await pool.query('UPDATE geo_files SET content=$1,updated_at=now() WHERE kind=$2 RETURNING *', [b.content || '', b.kind])).rows[0];
  else row = (await pool.query('INSERT INTO geo_files (kind,content) VALUES ($1,$2) RETURNING *', [b.kind, b.content || ''])).rows[0];
  res.json({ row });
}));

for (const [route, table, cols] of [
  ['geo/keywords', 'geo_keywords', ['keyword', 'kind', 'position', 'impressions', 'notes']],
  ['geo/ai-citations', 'geo_ai_citations', ['engine', 'state', 'query', 'checked_on', 'notes']],
  ['geo/audit-issues', 'geo_audit_issues', ['severity', 'title', 'detail']],
]) {
  app.get('/api/' + route, auth, wrap(async (req, res) => {
    const r = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`); res.json({ rows: r.rows });
  }));
  app.post('/api/' + route, auth, wrap(async (req, res) => {
    const b = req.body || {}; const vals = cols.map(c => (b[c] === undefined ? null : b[c]));
    const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
    const r = await pool.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals);
    res.json({ row: r.rows[0] });
  }));
  app.delete('/api/' + route + '/:id', auth, wrap(async (req, res) => {
    await pool.query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]); res.json({ ok: true });
  }));
}

app.get('/api/geo/audit', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM geo_audit WHERE id=1'); res.json({ row: r.rows[0] });
}));
app.post('/api/geo/pagespeed', auth, wrap(async (req, res) => {
  const ps = await runPageSpeed(req.body && req.body.url);
  await pool.query('UPDATE geo_audit SET lcp_seconds=$1, source=$2, updated_at=now() WHERE id=1', [ps.lcp_seconds, 'pagespeed']);
  res.json(ps);
}));

// GEO autopilot cron - called by GitHub Actions with x-cron-token. COALESCE preserves real numbers.
app.post('/api/geo/cron-snapshot', wrap(async (req, res) => {
  const token = envOrNull('GEO_CRON_TOKEN');
  if (!token || req.headers['x-cron-token'] !== token) return res.status(401).json({ error: 'bad cron token' });
  const date = new Date().toISOString().slice(0, 10);
  let gsc = null;
  try {
    if (envOrNull('GSC_SITE_URL')) {
      const site = envOrNull('GSC_SITE_URL'); const accessToken = await googleAccessToken('gsc');
      const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 28);
      const fmt = d => d.toISOString().slice(0, 10);
      const j = await jfetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
        { method: 'POST', headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
          body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: ['query'], rowLimit: 5000 }) });
      const rows = (j && j.rows) || []; let clicks = 0, impressions = 0, posSum = 0, top10 = 0;
      rows.forEach(r => { clicks += r.clicks || 0; impressions += r.impressions || 0; posSum += (r.position || 0) * (r.impressions || 1); if ((r.position || 99) <= 10) top10++; });
      gsc = { clicks, impressions, ctr: impressions ? +((clicks * 1000 / impressions) / 10).toFixed(1) : 0, position: impressions ? +(posSum / impressions).toFixed(1) : null, keywords_top10: top10 };
    }
  } catch (e) { gsc = { error: e.message }; }
  await pool.query(
    `INSERT INTO geo_snapshots (snapshot_date,avg_position,impressions,clicks,ctr,keywords_top10,source)
     VALUES ($1,$2,$3,$4,$5,$6,'cron')
     ON CONFLICT (snapshot_date) DO UPDATE SET
       avg_position=COALESCE(EXCLUDED.avg_position, geo_snapshots.avg_position),
       impressions=COALESCE(EXCLUDED.impressions, geo_snapshots.impressions),
       clicks=COALESCE(EXCLUDED.clicks, geo_snapshots.clicks),
       ctr=COALESCE(EXCLUDED.ctr, geo_snapshots.ctr),
       keywords_top10=COALESCE(EXCLUDED.keywords_top10, geo_snapshots.keywords_top10)`,
    [date, gsc && !gsc.error ? gsc.position : null, gsc && !gsc.error ? gsc.impressions : null,
     gsc && !gsc.error ? gsc.clicks : null, gsc && !gsc.error ? gsc.ctr : null, gsc && !gsc.error ? gsc.keywords_top10 : null]);
  res.json({ ok: true, date, gsc });
}));

// ===========================================================================
// Backlink gap (client parses Ahrefs CSV; server normalizes/subtracts/ranks)
// ===========================================================================
app.get('/api/bl/own-domains', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM bl_own_domains ORDER BY dr DESC NULLS LAST'); res.json({ rows: r.rows });
}));
app.post('/api/bl/own-domains', auth, wrap(async (req, res) => {
  const list = (req.body && req.body.domains) || [];
  let n = 0;
  for (const d of list) {
    const dom = normDomain(typeof d === 'string' ? d : d.domain); if (!dom) continue;
    const dr = (typeof d === 'object' && d.dr != null) ? parseInt(d.dr, 10) : null;
    await pool.query('INSERT INTO bl_own_domains (domain,dr) VALUES ($1,$2) ON CONFLICT (domain) DO UPDATE SET dr=COALESCE(EXCLUDED.dr,bl_own_domains.dr)', [dom, dr]);
    n++;
  }
  res.json({ ok: true, upserted: n });
}));
app.delete('/api/bl/own-domains/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM bl_own_domains WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));

app.post('/api/bl/gap', auth, wrap(async (req, res) => {
  const parsed = (req.body && req.body.rows) || [];     // [{domain,dr,dofollow}]
  const competitor = (req.body && req.body.competitor) || null;
  const own = (await pool.query('SELECT domain FROM bl_own_domains')).rows.map(r => r.domain);
  const ownSet = new Set(own);
  await pool.query('DELETE FROM bl_gap WHERE competitor = $1 OR ($1 IS NULL AND competitor IS NULL)', [competitor]);
  const seen = new Set(); let inserted = 0;
  const ranked = parsed
    .map(r => ({ domain: normDomain(r.domain), dr: r.dr != null ? parseInt(r.dr, 10) : null, dofollow: !!r.dofollow }))
    .filter(r => r.domain && !ownSet.has(r.domain) && !seen.has(r.domain) && seen.add(r.domain))
    .sort((a, b) => (b.dr || 0) - (a.dr || 0));
  for (const r of ranked) {
    await pool.query('INSERT INTO bl_gap (domain,dr,dofollow,competitor) VALUES ($1,$2,$3,$4)', [r.domain, r.dr, r.dofollow, competitor]);
    inserted++;
  }
  await pool.query('UPDATE bl_meta SET last_gap_upload=now(), competitor_label=$1 WHERE id=1', [competitor]);
  res.json({ ok: true, inserted, skipped_own: parsed.length - inserted });
}));
app.get('/api/bl/gap', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM bl_gap ORDER BY dr DESC NULLS LAST LIMIT 1000');
  const meta = await pool.query('SELECT * FROM bl_meta WHERE id=1');
  res.json({ rows: r.rows, meta: meta.rows[0] });
}));

// ===========================================================================
// Import (rows already mapped to exchange fields, from uploaded sheet/CSV)
// ===========================================================================
app.post('/api/import', auth, wrap(async (req, res) => {
  const rows = (req.body && req.body.rows) || [];
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'no rows' });
  let inserted = 0;
  for (const b of rows) {
    if (!b.prospect_domain && !b.domain) continue;
    await pool.query(
      `INSERT INTO exchanges (prospect_domain,our_target_url,anchor_text,link_type,domain_rating,owner_name,website_name,status,month_label,contact_name,contact_email,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [normDomain(b.prospect_domain || b.domain), b.our_target_url || null, b.anchor_text || null, b.link_type || 'dofollow',
       b.domain_rating != null && b.domain_rating !== '' ? parseInt(b.domain_rating, 10) : null, b.owner_name || null,
       b.website_name || null, b.status || 'pending', b.month_label || null, b.contact_name || null, b.contact_email || null, b.notes || null]);
    inserted++;
  }
  res.json({ ok: true, inserted });
}));

// ===========================================================================
// LinkedIn (read-only; NEVER automate actions - search/open profile only)
// ===========================================================================
app.get('/api/linkedin/followups', auth, wrap(async (req, res) => {
  const where = []; const args = [];
  if (req.query.status) { args.push(req.query.status); where.push(`status=$${args.length}`); }
  if (req.query.owner) { args.push(req.query.owner); where.push(`owner_name=$${args.length}`); }
  const r = await pool.query('SELECT * FROM li_followups' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated_at DESC', args);
  res.json({ rows: r.rows });
}));
app.post('/api/linkedin/followups', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.person_name) return res.status(400).json({ error: 'person_name required' });
  const r = await pool.query('INSERT INTO li_followups (person_name,company,profile_url,owner_name,status,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.person_name, b.company || null, b.profile_url || null, b.owner_name || null, b.status || 'to_contact', b.notes || null]);
  res.json({ row: r.rows[0] });
}));
app.put('/api/linkedin/followups/:id', auth, wrap(async (req, res) => {
  const b = req.body || {}; const fields = ['person_name','company','profile_url','owner_name','status','notes'];
  const sets = []; const args = [];
  for (const f of fields) if (f in b) { args.push(b[f]); sets.push(`${f}=$${args.length}`); }
  if (!sets.length) return res.json({ row: null });
  args.push(req.params.id);
  const r = await pool.query(`UPDATE li_followups SET ${sets.join(',')}, updated_at=now() WHERE id=$${args.length} RETURNING *`, args);
  res.json({ row: r.rows[0] });
}));
app.delete('/api/linkedin/followups/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM li_followups WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));
// Build a LinkedIn people-search URL for the user to click (no automation).
app.get('/api/linkedin/find-url', auth, wrap(async (req, res) => {
  const q = (req.query.q || '').toString();
  res.json({ url: 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(q) });
}));

// ===========================================================================
// Email Sender (Gmail API; user-connected). 3-step: queue -> list -> send.
// ===========================================================================
app.post('/api/email/queue', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.to_email || !b.subject) return res.status(400).json({ error: 'to_email and subject required' });
  const r = await pool.query('INSERT INTO email_queue (to_email,subject,body,outreach_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.to_email, b.subject, b.body || '', b.outreach_id || null]);
  res.json({ row: r.rows[0] });
}));
app.get('/api/email/queue', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM email_queue ORDER BY created_at DESC LIMIT 200'); res.json({ rows: r.rows });
}));
app.post('/api/email/send/:id', auth, wrap(async (req, res) => {
  const q = await pool.query('SELECT * FROM email_queue WHERE id=$1', [req.params.id]);
  if (!q.rowCount) return res.status(404).json({ error: 'not found' });
  const m = q.rows[0];
  try {
    const token = await googleAccessToken('gmail');
    const raw = Buffer.from(
      `To: ${m.to_email}\r\nSubject: ${m.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${m.body || ''}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await jfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
    const r = await pool.query("UPDATE email_queue SET status='sent', sent_at=now() WHERE id=$1 RETURNING *", [m.id]);
    res.json({ row: r.rows[0] });
  } catch (e) {
    await pool.query("UPDATE email_queue SET status='failed', error=$1 WHERE id=$2", [e.message, m.id]);
    res.status(500).json({ error: e.message });
  }
}));

// LinkedIn OAuth (read-only profile; optional)
app.get('/api/linkedin/auth-url', auth, wrap(async (req, res) => {
  const id = envOrNull('LINKEDIN_CLIENT_ID'); const redirect = envOrNull('LINKEDIN_REDIRECT_URI');
  if (!id || !redirect) return res.status(400).json({ error: 'LinkedIn OAuth not configured.' });
  const p = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirect, scope: 'openid profile email', state: 'linkedin' });
  res.json({ url: 'https://www.linkedin.com/oauth/v2/authorization?' + p.toString() });
}));
app.get('/api/linkedin/callback', wrap(async (req, res) => {
  const code = req.query.code; if (!code) return res.status(400).send('Missing code');
  const id = envOrNull('LINKEDIN_CLIENT_ID'); const secret = envOrNull('LINKEDIN_CLIENT_SECRET'); const redirect = envOrNull('LINKEDIN_REDIRECT_URI');
  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: id, client_secret: secret });
    const j = await jfetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    await saveToken('linkedin', { access_token: j.access_token, expires_in: j.expires_in });
    res.redirect('/?connected=linkedin');
  } catch (e) { res.status(500).send('LinkedIn OAuth error: ' + e.message); }
}));

// ===========================================================================
// Reminders
// ===========================================================================
app.get('/api/reminders', auth, wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM reminders ORDER BY done, due_date NULLS LAST, id DESC'); res.json({ rows: r.rows });
}));
app.post('/api/reminders', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'title required' });
  const r = await pool.query('INSERT INTO reminders (title,due_date,owner_name) VALUES ($1,$2,$3) RETURNING *', [b.title, b.due_date || null, b.owner_name || null]);
  let emailed = false;
  if (b.notify && req.user.email) {
    // Queue a reminder email to the registered user; send now if Gmail is connected.
    const subj = 'Reminder: ' + b.title;
    const body = 'Reminder from LinkLedger:\n\n' + b.title + (b.due_date ? ('\nDue: ' + b.due_date) : '') + '\n\n(Set in your LinkLedger workspace.)';
    const q = await pool.query('INSERT INTO email_queue (to_email,subject,body) VALUES ($1,$2,$3) RETURNING *', [req.user.email, subj, body]);
    try {
      const token = await googleAccessToken('gmail');
      const raw = Buffer.from(`To: ${req.user.email}\r\nSubject: ${subj}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`)
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await jfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
      await pool.query("UPDATE email_queue SET status='sent', sent_at=now() WHERE id=$1", [q.rows[0].id]);
      emailed = true;
    } catch (e) { /* stays queued until Gmail is connected */ }
  }
  res.json({ row: r.rows[0], emailed });
}));
app.put('/api/reminders/:id', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const r = await pool.query('UPDATE reminders SET title=COALESCE($1,title), due_date=COALESCE($2,due_date), done=COALESCE($3,done) WHERE id=$4 RETURNING *',
    [b.title || null, b.due_date || null, b.done == null ? null : !!b.done, req.params.id]);
  res.json({ row: r.rows[0] });
}));
app.delete('/api/reminders/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM reminders WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));

// ===========================================================================
// Static + SPA + boot
// ===========================================================================
// ===========================================================================
// Backlink analysis dashboard (#11)
// ===========================================================================
app.get('/api/analysis', auth, wrap(async (req, res) => {
  const q = async (sql, args) => (await pool.query(sql, args || [])).rows;
  const totals = (await pool.query('SELECT count(*)::int n FROM exchanges')).rows[0].n;
  const dr_bands = await q(`SELECT
      count(*) FILTER (WHERE domain_rating>=60)::int AS dr60,
      count(*) FILTER (WHERE domain_rating>=40 AND domain_rating<60)::int AS dr40,
      count(*) FILTER (WHERE domain_rating IS NOT NULL AND domain_rating<40)::int AS drlow,
      count(*) FILTER (WHERE domain_rating IS NULL)::int AS drnone,
      avg(domain_rating) AS avg_dr FROM exchanges`);
  if (dr_bands[0]) dr_bands[0].avg_dr = dr_bands[0].avg_dr != null ? Math.round(Number(dr_bands[0].avg_dr)) : null;
  const link_types = await q(`SELECT COALESCE(link_type,'-') AS k, count(*)::int n FROM exchanges GROUP BY link_type ORDER BY n DESC`);
  const health = (await pool.query(`SELECT
      count(*) FILTER (WHERE link_status='live')::int AS live,
      count(*) FILTER (WHERE link_status='lost')::int AS lost,
      count(*) FILTER (WHERE link_status='removed')::int AS removed,
      count(*) FILTER (WHERE link_status='pending' OR link_status IS NULL)::int AS pending FROM exchanges`)).rows[0];
  const by_month = await q(`SELECT COALESCE(month_label,'-') AS month, count(*)::int n, min(exchange_date) d FROM exchanges GROUP BY month_label ORDER BY d NULLS LAST`);
  const top_owners = await q(`SELECT COALESCE(owner_name,'-') AS owner, count(*)::int n FROM exchanges GROUP BY owner_name ORDER BY n DESC`);
  const reciprocal = (await pool.query(`SELECT
      count(*) FILTER (WHERE reciprocal_target IS NOT NULL AND reciprocal_target<>'')::int AS given,
      count(*) FILTER (WHERE reciprocal_target IS NULL OR reciprocal_target='')::int AS none FROM exchanges`)).rows[0];
  const top_anchors = await q(`SELECT anchor_text AS a, count(*)::int n FROM exchanges WHERE anchor_text IS NOT NULL AND anchor_text<>'' GROUP BY anchor_text ORDER BY n DESC LIMIT 12`);
  res.json({ totals, dr: dr_bands[0], link_types, health, by_month, top_owners, reciprocal, top_anchors });
}));

// ===========================================================================
// Analytics: per-member link counts + link-health summary
// ===========================================================================
app.get('/api/members/stats', auth, wrap(async (req, res) => {
  const now = new Date();
  const lab = d => d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  const thisM = lab(now);
  const prevM = lab(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const r = await pool.query(
    `SELECT COALESCE(owner_name,'-') AS owner,
       count(*)::int AS total,
       count(*) FILTER (WHERE month_label=$1)::int AS this_month,
       count(*) FILTER (WHERE month_label=$2)::int AS prev_month,
       count(*) FILTER (WHERE link_status='live')::int AS live,
       count(*) FILTER (WHERE link_status='lost')::int AS lost,
       count(*) FILTER (WHERE link_status='pending')::int AS pending
     FROM exchanges GROUP BY owner_name ORDER BY total DESC`, [thisM, prevM]);
  res.json({ this_month: thisM, prev_month: prevM, rows: r.rows });
}));

app.get('/api/link-health/summary', auth, wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT
       count(*) FILTER (WHERE link_status='live')::int AS live,
       count(*) FILTER (WHERE link_status='lost')::int AS lost,
       count(*) FILTER (WHERE link_status='removed')::int AS removed,
       count(*) FILTER (WHERE link_status='pending' OR link_status IS NULL)::int AS pending,
       count(*)::int AS total
     FROM exchanges WHERE our_target_url IS NOT NULL`);
  res.json(r.rows[0]);
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function boot() {
  if (!DATABASE_URL) { console.error('[boot] DATABASE_URL not set - set it in env before starting.'); }
  try { await migrate(); } catch (e) { console.error('[boot] migration error:', e.message); }
  app.listen(PORT, () => console.log('[boot] LinkLedger listening on :' + PORT));
}

if (require.main === module) boot();
module.exports = { app, pool, migrate, normDomain, parsePageSpeed };
