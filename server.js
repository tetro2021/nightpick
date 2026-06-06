'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'nightpick.db'));

// Persist JWT secret across restarts
const SECRET_FILE = path.join(__dirname, '.jwt_secret');
let JWT_SECRET;
try {
  JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} catch {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, JWT_SECRET);
}

const SUGGESTION_LIMIT = 100; // per category per pool
const SAVED_COMBO_LIMIT = 50;  // saved sets per pool
const SAVED_COMBO_MAX_BYTES = 500_000; // 500 KB — above any reachable UI maximum

app.use(express.json({ limit: '500kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== DATABASE INIT =====
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pools (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    created_by       TEXT NOT NULL REFERENCES users(id),
    created_at       INTEGER NOT NULL,
    is_published     INTEGER NOT NULL DEFAULT 0,
    invite_code      TEXT UNIQUE NOT NULL,
    allow_duplicates INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS pool_members (
    pool_id   TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id),
    role      TEXT NOT NULL DEFAULT 'contributor',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (pool_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id            TEXT PRIMARY KEY,
    pool_id       TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    category_id   TEXT NOT NULL,
    text          TEXT NOT NULL,
    added_by      TEXT NOT NULL REFERENCES users(id),
    added_by_name TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_combos (
    id         TEXT PRIMARY KEY,
    pool_id    TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    data       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_suggestions_pool ON suggestions(pool_id, category_id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON pool_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_saved_combos_pool ON saved_combos(pool_id, created_at);
`);

// Migration for existing databases
try { db.exec('ALTER TABLE pools ADD COLUMN allow_duplicates INTEGER NOT NULL DEFAULT 1'); } catch {}

// ===== HELPERS =====
const uid  = () => crypto.randomUUID();
const now  = () => Date.now();
const code = () => crypto.randomBytes(6).toString('hex');

const getMembership = (poolId, userId) =>
  db.prepare('SELECT role FROM pool_members WHERE pool_id=? AND user_id=?').get(poolId, userId);

// Normalize text for duplicate detection: lowercase, strip punctuation, collapse spaces
function normalizeSuggestion(text) {
  return text.toLowerCase().trim()
    .replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

const getCounts = (poolId) => {
  const rows = db.prepare(
    'SELECT category_id, COUNT(*) as cnt FROM suggestions WHERE pool_id=? GROUP BY category_id'
  ).all(poolId);
  return Object.fromEntries(rows.map(r => [r.category_id, r.cnt]));
};

// ===== AUTH MIDDLEWARE =====
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function softAuth(req, res, next) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch {}
  }
  next();
}

// ===== AUTH ROUTES =====
app.post('/api/auth/register', async (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  if (!email?.trim() || !password || !displayName?.trim())
    return res.status(400).json({ error: 'Email, password, and display name are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.trim()))
    return res.status(409).json({ error: 'An account with that email already exists.' });

  const id   = uid();
  const hash = await bcrypt.hash(password, 11);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id, email.trim(), displayName.trim(), hash, now());

  const payload = { id, email: email.trim(), displayName: displayName.trim() };
  res.json({ token: jwt.sign(payload, JWT_SECRET, { expiresIn: '60d' }), user: payload });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.trim());
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(400).json({ error: 'Invalid email or password.' });

  const payload = { id: user.id, email: user.email, displayName: user.display_name };
  res.json({ token: jwt.sign(payload, JWT_SECRET, { expiresIn: '60d' }), user: payload });
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT id, email, display_name as displayName FROM users WHERE id=?').get(req.user.id);
  u ? res.json(u) : res.status(404).json({ error: 'User not found' });
});

// ===== POOL ROUTES =====
app.get('/api/pools', auth, (req, res) => {
  const pools = db.prepare(`
    SELECT p.id, p.name, p.description, p.created_by, p.created_at, p.is_published, p.allow_duplicates,
           u.display_name as creator_name,
           pm.role as my_role, pm.joined_at as my_joined_at,
           (SELECT COUNT(*) FROM pool_members WHERE pool_id=p.id) as member_count
    FROM pools p
    JOIN pool_members pm ON pm.pool_id=p.id AND pm.user_id=?
    JOIN users u ON u.id=p.created_by
    ORDER BY pm.joined_at DESC
  `).all(req.user.id);
  res.json(pools.map(p => ({ ...p, is_published: !!p.is_published, counts: getCounts(p.id) })));
});

app.post('/api/pools', auth, (req, res) => {
  const { name, description, allowDuplicates = true } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'Pool name is required.' });
  const id = uid(); const t = now(); const inviteCode = code();
  db.prepare('INSERT INTO pools VALUES(?,?,?,?,?,0,?,?)').run(id, name.trim(), description?.trim() ?? '', req.user.id, t, inviteCode, allowDuplicates ? 1 : 0);
  db.prepare("INSERT INTO pool_members VALUES(?,?,'owner',?)").run(id, req.user.id, t);
  const pool = db.prepare('SELECT p.*, u.display_name as creator_name, 1 as member_count FROM pools p JOIN users u ON u.id=p.created_by WHERE p.id=?').get(id);
  res.json({ ...pool, is_published: false, my_role: 'owner', counts: {} });
});

app.get('/api/pools/:id', softAuth, (req, res) => {
  const pool = db.prepare(`
    SELECT p.*, u.display_name as creator_name,
           (SELECT COUNT(*) FROM pool_members WHERE pool_id=p.id) as member_count
    FROM pools p JOIN users u ON u.id=p.created_by WHERE p.id=?
  `).get(req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found.' });

  const mem = req.user ? getMembership(pool.id, req.user.id) : null;
  if (!mem && !pool.is_published) return res.status(403).json({ error: 'This pool is private.' });

  res.json({ ...pool, is_published: !!pool.is_published, my_role: mem?.role ?? null, counts: getCounts(pool.id) });
});

app.put('/api/pools/:id', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (mem?.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  const { name, description, allowDuplicates } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
  db.prepare('UPDATE pools SET name=?, description=?, allow_duplicates=? WHERE id=?')
    .run(name.trim(), description?.trim() ?? '', allowDuplicates === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/pools/:id', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (mem?.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  db.prepare('DELETE FROM pools WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/pools/:id/publish', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (mem?.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  const pool = db.prepare('SELECT is_published FROM pools WHERE id=?').get(req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found.' });
  const next = pool.is_published ? 0 : 1;
  db.prepare('UPDATE pools SET is_published=? WHERE id=?').run(next, req.params.id);
  res.json({ is_published: !!next });
});

// ===== MEMBERS =====
app.get('/api/pools/:id/members', softAuth, (req, res) => {
  const pool = db.prepare('SELECT is_published FROM pools WHERE id=?').get(req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found.' });
  const mem = req.user ? getMembership(req.params.id, req.user.id) : null;
  if (!mem && !pool.is_published) return res.status(403).json({ error: 'Not a member.' });
  const members = db.prepare(`
    SELECT pm.user_id as id, pm.role, pm.joined_at, u.display_name
    FROM pool_members pm JOIN users u ON u.id=pm.user_id
    WHERE pm.pool_id=? ORDER BY pm.joined_at ASC
  `).all(req.params.id);
  res.json(members);
});

app.delete('/api/pools/:id/members/:uid', auth, (req, res) => {
  const { id, uid: targetId } = req.params;
  const myMem = getMembership(id, req.user.id);
  if (!myMem) return res.status(403).json({ error: 'Not a member.' });
  if (targetId !== req.user.id && myMem.role !== 'owner')
    return res.status(403).json({ error: 'Owner only.' });
  const targetMem = getMembership(id, targetId);
  if (targetMem?.role === 'owner' && targetId !== req.user.id)
    return res.status(400).json({ error: 'Cannot remove the pool owner.' });
  db.prepare('DELETE FROM pool_members WHERE pool_id=? AND user_id=?').run(id, targetId);
  res.json({ ok: true });
});

// Invite
app.get('/api/pools/:id/invite-code', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (!mem) return res.status(403).json({ error: 'Not a member.' });
  const pool = db.prepare('SELECT invite_code FROM pools WHERE id=?').get(req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found.' });
  res.json({ code: pool.invite_code });
});

app.post('/api/pools/:id/invite-code/refresh', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (mem?.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  const newCode = code();
  db.prepare('UPDATE pools SET invite_code=? WHERE id=?').run(newCode, req.params.id);
  res.json({ code: newCode });
});

app.post('/api/join/:code', auth, (req, res) => {
  const pool = db.prepare('SELECT id, name FROM pools WHERE invite_code=?').get(req.params.code);
  if (!pool) return res.status(404).json({ error: 'Invalid invite link — it may have been refreshed.' });
  const existing = getMembership(pool.id, req.user.id);
  if (existing) return res.json({ poolId: pool.id, poolName: pool.name, alreadyMember: true });
  db.prepare("INSERT INTO pool_members VALUES(?,?,'contributor',?)").run(pool.id, req.user.id, now());
  res.json({ poolId: pool.id, poolName: pool.name, alreadyMember: false });
});

// ===== SUGGESTIONS =====
app.get('/api/pools/:id/suggestions', softAuth, (req, res) => {
  const pool = db.prepare('SELECT is_published FROM pools WHERE id=?').get(req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found.' });
  const mem = req.user ? getMembership(req.params.id, req.user.id) : null;
  if (!mem && !pool.is_published) return res.status(403).json({ error: 'Not a member.' });
  res.json(db.prepare('SELECT * FROM suggestions WHERE pool_id=? ORDER BY created_at ASC').all(req.params.id));
});

app.post('/api/pools/:id/suggestions', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (!mem) return res.status(403).json({ error: 'Not a member.' });
  const { categoryId, text } = req.body ?? {};
  if (!categoryId || !text?.trim()) return res.status(400).json({ error: 'Category and text required.' });
  const poolInfo = db.prepare('SELECT allow_duplicates FROM pools WHERE id=?').get(req.params.id);
  if (poolInfo && !poolInfo.allow_duplicates) {
    const norm = normalizeSuggestion(text.trim());
    const existing = db.prepare('SELECT text FROM suggestions WHERE pool_id=? AND category_id=?').all(req.params.id, categoryId);
    if (existing.some(s => normalizeSuggestion(s.text) === norm))
      return res.status(409).json({ error: 'A similar suggestion already exists in this category.' });
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM suggestions WHERE pool_id=? AND category_id=?').get(req.params.id, categoryId).c;
  if (count >= SUGGESTION_LIMIT) return res.status(429).json({ error: `Limit of ${SUGGESTION_LIMIT} suggestions per category reached.` });
  const s = { id: uid(), pool_id: req.params.id, category_id: categoryId, text: text.trim().slice(0, 200), added_by: req.user.id, added_by_name: req.user.displayName, created_at: now() };
  db.prepare('INSERT INTO suggestions VALUES(?,?,?,?,?,?,?)').run(s.id, s.pool_id, s.category_id, s.text, s.added_by, s.added_by_name, s.created_at);
  res.json(s);
});

app.delete('/api/pools/:id/suggestions/:sid', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM suggestions WHERE id=? AND pool_id=?').get(req.params.sid, req.params.id);
  if (!s) return res.status(404).json({ error: 'Suggestion not found.' });
  const mem = getMembership(req.params.id, req.user.id);
  if (!mem) return res.status(403).json({ error: 'Not a member.' });
  if (mem.role !== 'owner' && s.added_by !== req.user.id) return res.status(403).json({ error: 'You can only delete your own suggestions.' });
  db.prepare('DELETE FROM suggestions WHERE id=?').run(req.params.sid);
  res.json({ ok: true });
});

// ===== SAVED COMBOS =====
const saveRateLimit = new Map(); // userId → last-save timestamp

app.get('/api/pools/:id/saved-combos', softAuth, (req, res) => {
  const pool = db.prepare('SELECT is_published FROM pools WHERE id=?').get(req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found.' });
  const mem = req.user ? getMembership(req.params.id, req.user.id) : null;
  if (!mem && !pool.is_published) return res.status(403).json({ error: 'Not a member.' });
  const rows = db.prepare('SELECT * FROM saved_combos WHERE pool_id=? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

app.post('/api/pools/:id/saved-combos', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (mem?.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });

  // Rate limit: 10-second cooldown per user
  const lastT = saveRateLimit.get(req.user.id) || 0;
  if (Date.now() - lastT < 10_000)
    return res.status(429).json({ error: 'Please wait a moment before saving again.' });

  const { label, data } = req.body ?? {};
  if (!data || !Array.isArray(data.combos)) return res.status(400).json({ error: 'Invalid combo data.' });

  // Payload size cap (500 KB)
  if (JSON.stringify(data).length > SAVED_COMBO_MAX_BYTES)
    return res.status(400).json({ error: 'Combo set is too large to save.' });

  // Per-pool saved-set cap (50)
  const existing = db.prepare('SELECT COUNT(*) as c FROM saved_combos WHERE pool_id=?').get(req.params.id).c;
  if (existing >= SAVED_COMBO_LIMIT)
    return res.status(429).json({ error: `Pools are limited to ${SAVED_COMBO_LIMIT} saved sets. Delete one to make room.` });

  saveRateLimit.set(req.user.id, Date.now());
  const id = uid(); const t = now();
  db.prepare('INSERT INTO saved_combos VALUES(?,?,?,?,?,?)').run(id, req.params.id, req.user.id, t, label?.trim() ?? '', JSON.stringify(data));
  res.json({ id, pool_id: req.params.id, created_by: req.user.id, created_at: t, label: label?.trim() ?? '', data });
});

app.delete('/api/pools/:id/saved-combos/:comboId', auth, (req, res) => {
  const mem = getMembership(req.params.id, req.user.id);
  if (mem?.role !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  db.prepare('DELETE FROM saved_combos WHERE id=? AND pool_id=?').run(req.params.comboId, req.params.id);
  res.json({ ok: true });
});

// ===== BROWSE =====
app.get('/api/browse', softAuth, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 24, 50);
  const offset = parseInt(req.query.offset) || 0;
  const q      = req.query.q?.trim();

  let where = 'WHERE p.is_published=1';
  const params = [];
  if (q) { where += ' AND (p.name LIKE ? OR p.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const pools = db.prepare(`
    SELECT p.id, p.name, p.description, p.created_at,
           u.display_name as creator_name,
           (SELECT COUNT(*) FROM pool_members WHERE pool_id=p.id) as member_count,
           (SELECT COUNT(*) FROM suggestions WHERE pool_id=p.id) as suggestion_count
    FROM pools p JOIN users u ON u.id=p.created_by
    ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM pools p ${where}`).get(...params).c;
  res.json({ pools, total, limit, offset });
});

// Catch-all → SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3737;
app.listen(PORT, () => console.log(`NightPick running → http://localhost:${PORT}`));
