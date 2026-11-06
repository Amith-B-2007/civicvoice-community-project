'use strict';

// Data layer: the schema and every SQL query live here (SQLite through Node's built-in module).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// node:sqlite prints an "experimental" notice on current Node versions; keep the console clean.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  return emitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

// On a hosting service, DATA_DIR points at the persistent volume; locally it is the project's data folder.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'suggestion-box.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL,
    ward        TEXT NOT NULL,
    location    TEXT,
    author_name TEXT,
    contact     TEXT,
    photo       TEXT,
    status      TEXT NOT NULL DEFAULT 'submitted',
    hidden      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS votes (
    suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    voter         TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (suggestion_id, voter)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    author_name   TEXT,
    body          TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS updates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    status        TEXT NOT NULL,
    note          TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  -- "Is this really fixed?" answers from residents, one per browser.
  CREATE TABLE IF NOT EXISTS confirmations (
    suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    voter         TEXT NOT NULL,
    resolved      INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (suggestion_id, voter)
  );
  -- Abuse reports. comment_id is NULL when the submission itself is reported.
  CREATE TABLE IF NOT EXISTS reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    comment_id    INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    reason        TEXT NOT NULL,
    voter         TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS polls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question    TEXT NOT NULL,
    description TEXT,
    closes_at   TEXT,
    closed      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS poll_options (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id  INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    label    TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id  INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    voter      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (poll_id, voter)
  );
  CREATE TABLE IF NOT EXISTS notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions (created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_suggestion ON comments (suggestion_id);
  CREATE INDEX IF NOT EXISTS idx_updates_suggestion ON updates (suggestion_id);
  CREATE INDEX IF NOT EXISTS idx_reports_suggestion ON reports (suggestion_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_once ON reports (suggestion_id, IFNULL(comment_id, 0), voter);
`);

const now = () => new Date().toISOString();
const get = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const like = (text) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

// Columns added after the first version. Existing databases are upgraded in place.
function addColumn(table, column, definition) {
  const exists = all(`PRAGMA table_info(${table})`).some((info) => info.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('suggestions', 'department', 'TEXT');
addColumn('suggestions', 'lat', 'REAL');
addColumn('suggestions', 'lng', 'REAL');
addColumn('updates', 'photo', 'TEXT');
addColumn('updates', 'by_name', 'TEXT');
addColumn('admins', 'role', `TEXT NOT NULL DEFAULT 'admin'`);
addColumn('admins', 'department', 'TEXT');
addColumn('admins', 'name', 'TEXT');
// State-wide version: every submission belongs to a district and a town; officers can be limited to a district.
addColumn('suggestions', 'district', 'TEXT');
addColumn('suggestions', 'town', 'TEXT');
addColumn('admins', 'district', 'TEXT');
db.exec(`UPDATE suggestions SET category = 'waste' WHERE category = 'health'`);

// Limits a query to one department and/or one district (used for officers). Empty means everything.
function scopeWhere(filter = {}, alias = '') {
  const parts = [];
  const params = [];
  for (const column of ['department', 'district']) {
    if (filter[column]) {
      parts.push(` AND ${alias}${column} = ?`);
      params.push(filter[column]);
    }
  }
  return { sql: parts.join(''), params };
}

const CODE_RE = /^SB-[A-HJ-NP-Z2-9]{6}$/;

let overdueDays = 7;
function configure(options) {
  if (options.overdueDays) overdueDays = options.overdueDays;
}
// A submission is overdue when nobody has acted on it for longer than the allowed days.
const overdueCutoff = () => new Date(Date.now() - overdueDays * 24 * 60 * 60 * 1000).toISOString();

// Tracking codes avoid look-alike characters (0/O, 1/I) so they are easy to read out and type.
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const byte of crypto.randomBytes(6)) out += alphabet[byte % alphabet.length];
  return `SB-${out}`;
}

// ---------- Suggestions ----------

// Per-row counters. The single "?" is the visitor's voter id.
const COUNTS = `
  (SELECT COUNT(*) FROM votes v WHERE v.suggestion_id = s.id) AS votes,
  (SELECT COUNT(*) FROM comments c WHERE c.suggestion_id = s.id) AS comments,
  EXISTS (SELECT 1 FROM votes v WHERE v.suggestion_id = s.id AND v.voter = ?) AS voted,
  EXISTS (SELECT 1 FROM updates u WHERE u.suggestion_id = s.id AND u.note IS NOT NULL) AS responded,
  (SELECT COUNT(*) FROM confirmations cf WHERE cf.suggestion_id = s.id AND cf.resolved = 1) AS fixed_yes,
  (SELECT COUNT(*) FROM confirmations cf WHERE cf.suggestion_id = s.id AND cf.resolved = 0) AS fixed_no,
  (SELECT COUNT(*) FROM reports r WHERE r.suggestion_id = s.id) AS reports`;

const DISPUTED = `s.status = 'implemented'
  AND (SELECT COUNT(*) FROM confirmations cf WHERE cf.suggestion_id = s.id AND cf.resolved = 0)
    > (SELECT COUNT(*) FROM confirmations cf WHERE cf.suggestion_id = s.id AND cf.resolved = 1)`;

const SORTS = {
  top: 'votes DESC, s.created_at DESC',
  new: 's.created_at DESC',
  discussed: 'comments DESC, s.created_at DESC',
};

function excerpt(text, max = 180) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length <= max ? flat : `${flat.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// Shapes a database row for the API. Private details are only ever included for officials.
function present(row, { full = false, admin = false } = {}) {
  const out = {
    code: row.code,
    type: row.type,
    title: row.title,
    category: row.category,
    department: row.department,
    district: row.district,
    town: row.town,
    ward: row.ward,
    location: row.location,
    lat: row.lat,
    lng: row.lng,
    author: row.author_name,
    status: row.status,
    votes: row.votes,
    comments: row.comments,
    voted: Boolean(row.voted),
    responded: Boolean(row.responded),
    hasPhoto: Boolean(row.photo),
    fixed: { yes: row.fixed_yes, no: row.fixed_no },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (full) {
    out.description = row.description;
    out.photo = row.photo ? `/uploads/${row.photo}` : null;
  } else {
    out.excerpt = excerpt(row.description);
  }
  if (admin) {
    out.contact = row.contact;
    out.hidden = Boolean(row.hidden);
    out.reports = row.reports;
    out.overdue = row.status === 'submitted' && row.created_at < overdueCutoff();
    out.disputed = row.status === 'implemented' && row.fixed_no > row.fixed_yes;
  }
  return out;
}

function createSuggestion(s, createdAt = now()) {
  const insert = db.prepare(`
    INSERT INTO suggestions
      (code, type, title, description, category, department, district, town, ward, location, lat, lng,
       author_name, contact, photo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      const result = insert.run(
        code, s.type, s.title, s.description, s.category, s.department ?? null,
        s.district ?? null, s.town ?? null, s.ward ?? '',
        s.location ?? null, s.lat ?? null, s.lng ?? null,
        s.authorName ?? null, s.contact ?? null, s.photo ?? null, createdAt, createdAt,
      );
      return { id: Number(result.lastInsertRowid), code };
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  throw new Error('Could not allocate a tracking code.');
}

function listSuggestions(filters = {}) {
  const where = [];
  const params = [];
  if (!filters.includeHidden) where.push('s.hidden = 0');
  for (const column of ['category', 'district', 'status', 'type', 'department']) {
    if (filters[column]) {
      where.push(`s.${column} = ?`);
      params.push(filters[column]);
    }
  }
  if (filters.pinned) where.push('s.lat IS NOT NULL');
  if (filters.codes && filters.codes.length) {
    where.push(`s.code IN (${filters.codes.map(() => '?').join(', ')})`);
    params.push(...filters.codes);
  }
  if (filters.search) {
    where.push(`(s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\' OR s.code = ?)`);
    params.push(like(filters.search), like(filters.search), filters.search.toUpperCase());
  }
  if (filters.attention === 'overdue') {
    where.push(`s.status = 'submitted' AND s.created_at < ?`);
    params.push(overdueCutoff());
  } else if (filters.attention === 'reported') {
    where.push('EXISTS (SELECT 1 FROM reports r WHERE r.suggestion_id = s.id)');
  } else if (filters.attention === 'disputed') {
    where.push(DISPUTED);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filters.limit || 10;
  const page = filters.page || 1;

  const total = get(`SELECT COUNT(*) AS n FROM suggestions s ${whereSql}`, ...params).n;
  const rows = all(
    `SELECT s.*, ${COUNTS} FROM suggestions s ${whereSql}
     ORDER BY ${SORTS[filters.sort] || SORTS.top} LIMIT ? OFFSET ?`,
    filters.voter || '', ...params, limit, (page - 1) * limit,
  );
  return {
    items: rows.map((row) => present(row, { admin: filters.includeHidden })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

function findByCode(code) {
  return get('SELECT * FROM suggestions WHERE code = ?', code);
}

function findByTitle(title) {
  return get('SELECT * FROM suggestions WHERE title = ?', title);
}

function getSuggestion(code, { voter = '', admin = false } = {}) {
  const row = get(`SELECT s.*, ${COUNTS} FROM suggestions s WHERE s.code = ?`, voter, code);
  if (!row || (row.hidden && !admin)) return null;
  const suggestion = present(row, { full: true, admin });

  const mine = get('SELECT resolved FROM confirmations WHERE suggestion_id = ? AND voter = ?', row.id, voter);
  suggestion.fixed.mine = mine ? Boolean(mine.resolved) : null;

  suggestion.updates = all(
    `SELECT id, status, note, photo, by_name AS byName, created_at AS createdAt
     FROM updates WHERE suggestion_id = ? ORDER BY created_at, id`,
    row.id,
  ).map((update) => ({
    ...update,
    id: admin ? update.id : undefined,
    photo: update.photo ? `/uploads/${update.photo}` : null,
    byName: admin ? update.byName : undefined,
  }));

  suggestion.thread = all(
    `SELECT c.id, c.author_name AS author, c.body, c.created_at AS createdAt,
            (SELECT COUNT(*) FROM reports r WHERE r.comment_id = c.id) AS reports
     FROM comments c WHERE c.suggestion_id = ? ORDER BY c.created_at, c.id`,
    row.id,
  ).map((comment) => (admin ? comment : { ...comment, reports: undefined }));

  if (admin) {
    suggestion.reportList = all(
      `SELECT reason, comment_id AS commentId, created_at AS createdAt
       FROM reports WHERE suggestion_id = ? ORDER BY created_at DESC`,
      row.id,
    );
  }
  return suggestion;
}

function updateSuggestion(id, fields) {
  for (const column of ['department', 'district', 'town', 'ward', 'lat', 'lng']) {
    if (column in fields) run(`UPDATE suggestions SET ${column} = ? WHERE id = ?`, fields[column], id);
  }
}

// Gives submissions from before departments existed the department of their category.
function backfillDepartment(category, department) {
  run('UPDATE suggestions SET department = ? WHERE department IS NULL AND category = ?', department, category);
}

// Finds existing suggestions that share keywords with a title someone is typing.
const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'near', 'please', 'need', 'needs', 'should',
  'there', 'their', 'which', 'about', 'been', 'will', 'want', 'into', 'some', 'very',
]);

function similar(text) {
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{M}\p{N}]{4,}/gu) || [])]
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, 6);
  if (!words.length) return [];
  const score = words
    .map(() => `(CASE WHEN s.title LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END
               + CASE WHEN s.description LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`)
    .join(' + ');
  const params = words.flatMap((word) => [like(word), like(word)]);
  return all(
    `SELECT code, title, status, votes FROM (
       SELECT s.code, s.title, s.status,
              (SELECT COUNT(*) FROM votes v WHERE v.suggestion_id = s.id) AS votes,
              (${score}) AS score
       FROM suggestions s WHERE s.hidden = 0
     ) WHERE score >= ? ORDER BY score DESC, votes DESC LIMIT 4`,
    ...params,
    words.length > 1 ? 4 : 2, // with several keywords, one shared common word is not a match
  );
}

// ---------- Votes, comments, official updates ----------

function toggleVote(suggestionId, voter, at = now()) {
  const removed = run('DELETE FROM votes WHERE suggestion_id = ? AND voter = ?', suggestionId, voter).changes;
  if (!removed) {
    run('INSERT INTO votes (suggestion_id, voter, created_at) VALUES (?, ?, ?)', suggestionId, voter, at);
  }
  const votes = get('SELECT COUNT(*) AS n FROM votes WHERE suggestion_id = ?', suggestionId).n;
  return { voted: !removed, votes };
}

function addComment(suggestionId, author, body, at = now()) {
  const result = run(
    'INSERT INTO comments (suggestion_id, author_name, body, created_at) VALUES (?, ?, ?, ?)',
    suggestionId, author ?? null, body, at,
  );
  return { id: Number(result.lastInsertRowid), author: author ?? null, body, createdAt: at };
}

function findComment(id) {
  return get(
    `SELECT c.id, c.suggestion_id, s.department, s.district, s.hidden FROM comments c
     JOIN suggestions s ON s.id = c.suggestion_id WHERE c.id = ?`,
    id,
  );
}

function deleteComment(id) {
  return Boolean(run('DELETE FROM comments WHERE id = ?', id).changes);
}

// An "update" is an official action: a status change, a public reply, a photo, or any mix.
function addUpdate(suggestionId, status, note, { photo = null, byName = null, at = now() } = {}) {
  run(
    'INSERT INTO updates (suggestion_id, status, note, photo, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    suggestionId, status, note ?? null, photo, byName, at,
  );
  run('UPDATE suggestions SET status = ?, updated_at = ? WHERE id = ?', status, at, suggestionId);
}

function setHidden(suggestionId, hidden) {
  run('UPDATE suggestions SET hidden = ? WHERE id = ?', hidden ? 1 : 0, suggestionId);
}

function removeSuggestionPhoto(suggestionId) {
  const row = get('SELECT photo FROM suggestions WHERE id = ?', suggestionId);
  if (!row || !row.photo) return null;
  run('UPDATE suggestions SET photo = NULL WHERE id = ?', suggestionId);
  return row.photo;
}

function findUpdate(id) {
  return get(
    `SELECT u.id, u.suggestion_id, u.photo, u.note, s.code, s.department, s.district
     FROM updates u JOIN suggestions s ON s.id = u.suggestion_id WHERE u.id = ?`,
    id,
  );
}

function removeUpdatePhoto(id) {
  const row = get('SELECT photo FROM updates WHERE id = ?', id);
  if (!row || !row.photo) return null;
  run('UPDATE updates SET photo = NULL WHERE id = ?', id);
  return row.photo;
}

// ---------- "Is it really fixed?" and abuse reports ----------

function setConfirmation(suggestionId, voter, resolved, at = now()) {
  run(
    `INSERT INTO confirmations (suggestion_id, voter, resolved, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (suggestion_id, voter) DO UPDATE SET resolved = excluded.resolved, created_at = excluded.created_at`,
    suggestionId, voter, resolved ? 1 : 0, at,
  );
  const count = (value) => get(
    'SELECT COUNT(*) AS n FROM confirmations WHERE suggestion_id = ? AND resolved = ?', suggestionId, value,
  ).n;
  return { yes: count(1), no: count(0), mine: Boolean(resolved) };
}

function addReport(suggestionId, commentId, reason, voter) {
  run(
    `INSERT OR IGNORE INTO reports (suggestion_id, comment_id, reason, voter, created_at) VALUES (?, ?, ?, ?, ?)`,
    suggestionId, commentId ?? null, reason, voter, now(),
  );
}

function clearReports(suggestionId) {
  run('DELETE FROM reports WHERE suggestion_id = ?', suggestionId);
}

// ---------- Polls ----------

const pollIsOpen = (poll) => !poll.closed && (!poll.closes_at || poll.closes_at > now());

function presentPoll(poll, voter) {
  const options = all(
    `SELECT o.id, o.label, (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
     FROM poll_options o WHERE o.poll_id = ? ORDER BY o.position`,
    poll.id,
  );
  const mine = get('SELECT option_id FROM poll_votes WHERE poll_id = ? AND voter = ?', poll.id, voter);
  return {
    id: poll.id,
    question: poll.question,
    description: poll.description,
    closesAt: poll.closes_at,
    createdAt: poll.created_at,
    open: pollIsOpen(poll),
    options,
    total: options.reduce((sum, option) => sum + option.votes, 0),
    mine: mine ? mine.option_id : null,
  };
}

function listPolls(voter = '') {
  return all('SELECT * FROM polls ORDER BY created_at DESC, id DESC').map((poll) => presentPoll(poll, voter));
}

function getPoll(id, voter = '') {
  const poll = get('SELECT * FROM polls WHERE id = ?', id);
  return poll ? presentPoll(poll, voter) : null;
}

function createPoll({ question, description, options, closesAt }, at = now()) {
  const id = Number(run(
    'INSERT INTO polls (question, description, closes_at, created_at) VALUES (?, ?, ?, ?)',
    question, description ?? null, closesAt ?? null, at,
  ).lastInsertRowid);
  options.forEach((label, position) => {
    run('INSERT INTO poll_options (poll_id, label, position) VALUES (?, ?, ?)', id, label, position);
  });
  return id;
}

function votePoll(pollId, optionId, voter, at = now()) {
  run(
    `INSERT INTO poll_votes (poll_id, option_id, voter, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (poll_id, voter) DO UPDATE SET option_id = excluded.option_id, created_at = excluded.created_at`,
    pollId, optionId, voter, at,
  );
}

const setPollClosed = (id, closed) => Boolean(run('UPDATE polls SET closed = ? WHERE id = ?', closed ? 1 : 0, id).changes);
const deletePoll = (id) => Boolean(run('DELETE FROM polls WHERE id = ?', id).changes);
const countPolls = () => get('SELECT COUNT(*) AS n FROM polls').n;

// ---------- Notices ----------

function listNotices(limit = 50) {
  return all(
    `SELECT id, title, body, pinned, created_at AS createdAt FROM notices
     ORDER BY pinned DESC, created_at DESC, id DESC LIMIT ?`,
    limit,
  ).map((notice) => ({ ...notice, pinned: Boolean(notice.pinned) }));
}

function createNotice({ title, body, pinned }, at = now()) {
  return Number(run(
    'INSERT INTO notices (title, body, pinned, created_at) VALUES (?, ?, ?, ?)', title, body, pinned ? 1 : 0, at,
  ).lastInsertRowid);
}

const deleteNotice = (id) => Boolean(run('DELETE FROM notices WHERE id = ?', id).changes);
const countNotices = () => get('SELECT COUNT(*) AS n FROM notices').n;

// ---------- Statistics ----------

// `filter` ({ department, district }) limits the numbers for officers; empty means everything.
function stats(filter = {}) {
  const plain = scopeWhere(filter);
  const scope = `hidden = 0${plain.sql}`;
  const scoped = plain.params;
  const sScope = `s.hidden = 0${scopeWhere(filter, 's.').sql}`;

  const total = get(`SELECT COUNT(*) AS n FROM suggestions WHERE ${scope}`, ...scoped).n;
  const group = (column) => all(
    `SELECT ${column} AS id, COUNT(*) AS n FROM suggestions WHERE ${scope} AND ${column} IS NOT NULL
     GROUP BY ${column} ORDER BY n DESC, id`,
    ...scoped,
  );

  const byStatus = { submitted: 0, under_review: 0, planned: 0, in_progress: 0, implemented: 0, not_feasible: 0 };
  for (const row of group('status')) byStatus[row.id] = row.n;

  const responded = get(
    `SELECT COUNT(*) AS n FROM suggestions s
     WHERE ${sScope} AND EXISTS (SELECT 1 FROM updates u WHERE u.suggestion_id = s.id)`,
    ...scoped,
  ).n;
  const avgResponseDays = get(
    `SELECT AVG(julianday(first_update) - julianday(created_at)) AS days FROM (
       SELECT s.created_at,
              (SELECT MIN(u.created_at) FROM updates u WHERE u.suggestion_id = s.id) AS first_update
       FROM suggestions s WHERE ${sScope}
     ) WHERE first_update IS NOT NULL`,
    ...scoped,
  ).days;

  // Last six calendar months, including months with nothing submitted.
  const perMonth = Object.fromEntries(
    all(`SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS n
         FROM suggestions WHERE ${scope} GROUP BY month`, ...scoped).map((row) => [row.month, row.n]),
  );
  const monthly = [];
  const today = new Date();
  for (let back = 5; back >= 0; back--) {
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1))
      .toISOString().slice(0, 7);
    monthly.push({ month, n: perMonth[month] || 0 });
  }

  const countJoined = (table, extra = '') => get(
    `SELECT COUNT(*) AS n FROM ${table} x JOIN suggestions s ON s.id = x.suggestion_id WHERE ${sScope} ${extra}`,
    ...scoped,
  ).n;
  const fixedYes = countJoined('confirmations', 'AND x.resolved = 1');
  const fixedNo = countJoined('confirmations', 'AND x.resolved = 0');

  return {
    total,
    votes: countJoined('votes'),
    comments: countJoined('comments'),
    responded,
    responseRate: total ? Math.round((responded / total) * 100) : 0,
    avgResponseDays: avgResponseDays == null ? null : Math.round(avgResponseDays * 10) / 10,
    overdue: get(
      `SELECT COUNT(*) AS n FROM suggestions WHERE ${scope} AND status = 'submitted' AND created_at < ?`,
      ...scoped, overdueCutoff(),
    ).n,
    overdueDays,
    fixed: {
      yes: fixedYes,
      no: fixedNo,
      rate: fixedYes + fixedNo ? Math.round((fixedYes / (fixedYes + fixedNo)) * 100) : null,
    },
    pinned: get(`SELECT COUNT(*) AS n FROM suggestions WHERE ${scope} AND lat IS NOT NULL`, ...scoped).n,
    byStatus,
    byCategory: group('category'),
    byDistrict: group('district'),
    byDepartment: group('department'),
    monthly,
  };
}

// Numbers officials need at the top of their panel.
function attention(filter = {}) {
  const { sql: scope, params: scoped } = scopeWhere(filter, 's.');
  const count = (where, ...params) => get(
    `SELECT COUNT(*) AS n FROM suggestions s WHERE ${where} ${scope}`, ...params, ...scoped,
  ).n;
  return {
    hidden: count('s.hidden = 1'),
    reported: count('EXISTS (SELECT 1 FROM reports r WHERE r.suggestion_id = s.id)'),
    disputed: count(`s.hidden = 0 AND ${DISPUTED}`),
  };
}

// Everything the printable monthly report shows. `month` is "YYYY-MM".
function monthlyReport(month, filter = {}) {
  const { sql: scope, params: scoped } = scopeWhere(filter, 's.');
  const inMonth = `s.hidden = 0 AND substr(s.created_at, 1, 7) = ? ${scope}`;
  const one = (sql, ...params) => get(sql, ...params);
  const group = (column) => all(
    `SELECT s.${column} AS id, COUNT(*) AS n FROM suggestions s WHERE ${inMonth} AND s.${column} IS NOT NULL
     GROUP BY s.${column} ORDER BY n DESC, id`,
    month, ...scoped,
  );
  const acted = (extra) => one(
    `SELECT COUNT(DISTINCT u.suggestion_id) AS n FROM updates u JOIN suggestions s ON s.id = u.suggestion_id
     WHERE s.hidden = 0 AND substr(u.created_at, 1, 7) = ? ${extra} ${scope}`,
    month, ...scoped,
  ).n;

  return {
    month,
    received: one(`SELECT COUNT(*) AS n FROM suggestions s WHERE ${inMonth}`, month, ...scoped).n,
    actedOn: acted(''),
    implemented: acted(`AND u.status = 'implemented'`),
    notFeasible: acted(`AND u.status = 'not_feasible'`),
    avgResponseDays: one(
      `SELECT AVG(julianday(first_update) - julianday(created_at)) AS days FROM (
         SELECT s.created_at,
                (SELECT MIN(u.created_at) FROM updates u WHERE u.suggestion_id = s.id) AS first_update
         FROM suggestions s WHERE ${inMonth}
       ) WHERE first_update IS NOT NULL`,
      month, ...scoped,
    ).days,
    byType: group('type'),
    byCategory: group('category'),
    byDistrict: group('district'),
    byDepartment: group('department'),
    top: all(
      `SELECT s.code, s.title, s.town, s.district, s.status,
              (SELECT COUNT(*) FROM votes v WHERE v.suggestion_id = s.id) AS votes
       FROM suggestions s WHERE ${inMonth} ORDER BY votes DESC, s.created_at LIMIT 5`,
      month, ...scoped,
    ),
    overdue: all(
      `SELECT s.code, s.title, s.town, s.district, s.department, s.created_at AS createdAt
       FROM suggestions s WHERE s.hidden = 0 AND s.status = 'submitted' AND s.created_at < ? ${scope}
       ORDER BY s.created_at LIMIT 50`,
      overdueCutoff(), ...scoped,
    ),
    now: stats(filter),
  };
}

function exportRows(filter = {}) {
  const { sql, params } = scopeWhere(filter, 's.');
  return all(`SELECT s.*, ${COUNTS} FROM suggestions s WHERE 1 = 1${sql} ORDER BY s.created_at DESC`, '', ...params);
}

// ---------- Official accounts and sessions ----------

const countAdmins = () => get(`SELECT COUNT(*) AS n FROM admins WHERE role = 'admin'`).n;
const findAdmin = (username) => get('SELECT * FROM admins WHERE username = ?', username);
const findAdminById = (id) => get('SELECT * FROM admins WHERE id = ?', id);
const listOfficers = () => all(
  `SELECT id, username, name, role, department, district FROM admins ORDER BY role, department, district, username`,
);
const createAdmin = (username, hash, salt, { role = 'admin', department = null, district = null, name = null } = {}) => Number(run(
  'INSERT INTO admins (username, password_hash, salt, role, department, district, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  username, hash, salt, role, department, district, name,
).lastInsertRowid);
const setAdminPassword = (id, hash, salt) => run(
  'UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?', hash, salt, id,
);
const deleteOfficer = (id) => Boolean(run(`DELETE FROM admins WHERE id = ? AND role = 'officer'`, id).changes);
const deleteHeadAdmins = () => {
  run(`DELETE FROM sessions WHERE admin_id IN (SELECT id FROM admins WHERE role = 'admin')`);
  run(`DELETE FROM admins WHERE role = 'admin'`);
};

const createSession = (tokenHash, adminId, expiresAt) => run(
  'INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)', tokenHash, adminId, expiresAt,
);
const findSession = (tokenHash) => get(
  `SELECT a.id, a.username, a.name, a.role, a.department, a.district, s.expires_at
   FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`,
  tokenHash,
);
const deleteSession = (tokenHash) => run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
const deleteSessionsFor = (adminId, exceptHash = '') => run(
  'DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?', adminId, exceptHash,
);
const purgeSessions = () => run('DELETE FROM sessions WHERE expires_at < ?', Date.now());

module.exports = {
  DATA_DIR, CODE_RE, configure,
  createSuggestion, listSuggestions, findByCode, findByTitle, getSuggestion, updateSuggestion,
  backfillDepartment, similar,
  toggleVote, addComment, findComment, deleteComment, addUpdate, setHidden,
  removeSuggestionPhoto, findUpdate, removeUpdatePhoto,
  setConfirmation, addReport, clearReports,
  listPolls, getPoll, createPoll, votePoll, setPollClosed, deletePoll, countPolls,
  listNotices, createNotice, deleteNotice, countNotices,
  stats, attention, monthlyReport, exportRows,
  countAdmins, findAdmin, findAdminById, listOfficers, createAdmin, setAdminPassword,
  deleteOfficer, deleteHeadAdmins,
  createSession, findSession, deleteSession, deleteSessionsFor, purgeSessions,
};
