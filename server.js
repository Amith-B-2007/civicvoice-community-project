'use strict';

// Digital Suggestion Box for Local Governance
// One Node.js process: serves the pages, the static files and the JSON API. No npm packages.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

let db;
try {
  db = require('./src/db');
} catch (err) {
  if (err.code === 'ERR_UNKNOWN_BUILTIN_MODULE') {
    console.error('This project needs Node.js 22.13 or newer (it uses the built-in SQLite module).');
    process.exit(1);
  }
  throw err;
}
const auth = require('./src/auth');
const i18n = require('./src/i18n');
const labels = require('./src/labels');
const { HttpError, Validator, readJson, rateLimit, escapeHtml, toCsv } = require('./src/util');

const ROOT = __dirname;
const VIEWS = path.join(ROOT, 'views');
const PUBLIC = path.join(ROOT, 'public');
// With DATA_DIR set (hosting), photos live on the same volume as the database so both survive redeploys.
const UPLOADS = process.env.DATA_DIR ? path.join(db.DATA_DIR, 'uploads') : path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^﻿/, ''));
config.departments = config.departments || [];
config.overdueDays = config.overdueDays || 7;
config.map = config.map || { center: [20.5937, 78.9629], zoom: 5 };
config.districts = config.districts || [];
config.region = config.region || '';

const lists = {
  categoryIds: config.categories.map((category) => category.id),
  departmentIds: config.departments.map((department) => department.id),
  districtIds: config.districts.map((district) => district.id),
  statusIds: labels.STATUSES.map((status) => status.id),
  typeIds: labels.TYPES.map((type) => type.id),
};
const departmentOf = (categoryId) => {
  const category = config.categories.find((entry) => entry.id === categoryId);
  return (category && category.department) || null;
};

db.configure({ overdueDays: config.overdueDays });
for (const category of config.categories) {
  if (category.department) db.backfillDepartment(category.id, category.department);
}

const KB = 1024;
const MB = 1024 * KB;
const MINUTE = 60 * 1000;
const MAX_PHOTO_BYTES = 2 * MB;
const VOTER_RE = /^[A-Za-z0-9-]{16,64}$/;

// ---------- Pages ----------

const PAGES = {
  '/': 'index',
  '/submit': 'submit',
  '/browse': 'browse',
  '/suggestion': 'suggestion',
  '/map': 'map',
  '/polls': 'polls',
  '/notices': 'notices',
  '/track': 'track',
  '/dashboard': 'dashboard',
  '/poster': 'poster',
  '/admin': 'admin',
  '/report': 'report',
};

// Tiny templating:
//   {{> name}}   pulls in views/partials/name.html
//   {{t:key}}    inserts a translated string from i18n/<language>.json
//   {{siteName}} inserts a value from config.json
function render(view, lang) {
  const read = (file) => fs.readFileSync(path.join(VIEWS, file), 'utf8');
  const t = i18n.translator(lang);
  const vars = {
    lang,
    siteName: i18n.loc(config.siteName, lang),
    tagline: i18n.loc(config.tagline, lang),
    bodyName: i18n.loc(config.bodyName, lang),
    region: i18n.loc(config.region, lang),
    year: new Date().getFullYear(),
  };
  const textVars = { body: vars.bodyName, site: vars.siteName, days: config.overdueDays };
  return read(`${view}.html`)
    .replace(/\{\{>\s*(\w+)\s*\}\}/g, (_, partial) => read(`partials/${partial}.html`))
    .replace(/\{\{t:([\w.]+)\}\}/g, (_, key) => escapeHtml(t(key, textVars)))
    .replace(/\{\{(\w+)\}\}/g, (token, key) => (key in vars ? escapeHtml(vars[key]) : token));
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveFile(req, res, root, relative, cacheControl) {
  const file = path.resolve(root, relative);
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type || relative.includes('\0') || !file.startsWith(root + path.sep)) {
    throw new HttpError(404, 'Not found.');
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  if (!stat.isFile()) throw new HttpError(404, 'Not found.');
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': cacheControl });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const sendHtml = (res, status, html) => send(res, status, 'text/html; charset=utf-8', html);
const sendJson = (res, status, body) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));

// ---------- API helpers ----------

const routes = [];

function route(method, pattern, handler, options = {}) {
  const keys = [];
  const source = pattern.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, ...options });
}

// Browsers send an Origin header on cross-site writes; refuse any that are not ours.
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host = null;
  try {
    host = new URL(origin).host;
  } catch { /* malformed origin: treated as foreign */ }
  if (host !== req.headers.host) throw new HttpError(403, 'err.crossSite');
}

// Behind a hosting service's proxy every request comes from the proxy, so rate limits would be shared
// by all visitors. TRUST_PROXY=<number of proxies> reads the visitor's address from X-Forwarded-For
// instead, counting from the right because entries further left can be forged by the visitor.
const TRUST_PROXY = Math.max(0, parseInt(process.env.TRUST_PROXY, 10) || 0);
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (TRUST_PROXY && forwarded.length) return forwarded[Math.max(0, forwarded.length - TRUST_PROXY)];
  return req.socket.remoteAddress || 'unknown';
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function listFilters(query) {
  const pick = (name, allowed) => (allowed.includes(query.get(name)) ? query.get(name) : null);
  return {
    search: (query.get('search') || '').trim().slice(0, 80) || null,
    category: pick('category', lists.categoryIds),
    department: pick('department', lists.departmentIds),
    district: pick('district', lists.districtIds),
    status: pick('status', lists.statusIds),
    type: pick('type', lists.typeIds),
    attention: pick('attention', ['overdue', 'reported', 'disputed']),
    sort: pick('sort', ['top', 'new', 'discussed']) || 'top',
    page: clamp(parseInt(query.get('page'), 10) || 1, 1, 10000),
    limit: clamp(parseInt(query.get('limit'), 10) || 10, 1, 50),
    codes: (query.get('codes') || '').split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => db.CODE_RE.test(code))
      .slice(0, 30),
  };
}

function codeParam(ctx) {
  const code = ctx.params.code.toUpperCase();
  if (!db.CODE_RE.test(code)) throw new HttpError(404, 'err.notFound');
  return code;
}

// Looks up a suggestion the public is allowed to see.
function visibleSuggestion(ctx) {
  const row = db.findByCode(codeParam(ctx));
  if (!row || row.hidden) throw new HttpError(404, 'err.notFound');
  return row;
}

// Photos arrive as a base64 data URL. Only real JPEG/PNG bytes are accepted and the file gets a random name.
function savePhoto(dataUrl, t) {
  const reject = (key) => new HttpError(422, 'err.fix', { photo: t(key) });
  const match = typeof dataUrl === 'string' && /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw reject('err.photoType');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > MAX_PHOTO_BYTES) throw reject('err.photoSize');
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw reject('err.photoType');
  const name = `${crypto.randomBytes(16).toString('hex')}.${isJpeg ? 'jpg' : 'png'}`;
  fs.writeFileSync(path.join(UPLOADS, name), bytes);
  return name;
}

const app = {
  route, config, db, auth, i18n, lists, labels, departmentOf, UPLOADS,
  listFilters, codeParam, visibleSuggestion, savePhoto,
  HttpError, Validator, readJson, rateLimit, toCsv,
  sizes: { KB, MB, MINUTE },
};
require('./src/public-api')(app);
require('./src/admin-api')(app);

async function handleApi(req, res, url, pathname, lang, t) {
  if (req.method !== 'GET' && req.method !== 'HEAD') checkOrigin(req);
  for (const candidate of routes) {
    if (candidate.method !== req.method) continue;
    const match = candidate.regex.exec(pathname);
    if (!match) continue;
    const voter = req.headers['x-voter-id'] || '';
    const ctx = {
      req,
      res,
      lang,
      t,
      query: url.searchParams,
      params: Object.fromEntries(candidate.keys.map((key, index) => [key, match[index + 1]])),
      ip: clientIp(req),
      voter: VOTER_RE.test(voter) ? voter : '',
    };
    if (candidate.admin) {
      ctx.admin = auth.currentAdmin(req);
      if (!ctx.admin) throw new HttpError(401, 'err.signIn');
    }
    const result = await candidate.handler(ctx);
    if (!res.writableEnded) sendJson(res, 200, result);
    return;
  }
  throw new HttpError(404, 'Not found.');
}

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=()');
  // Map tiles and the address lookup come from OpenStreetMap; everything else is served from here.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "connect-src 'self' https://nominatim.openstreetmap.org",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));

  const lang = i18n.pickLang(req);
  const t = i18n.translator(lang);
  let isApi = false;
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    isApi = pathname.startsWith('/api/');
    if (isApi) return await handleApi(req, res, url, pathname, lang, t);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    if (PAGES[pathname]) return sendHtml(res, 200, render(PAGES[pathname], lang));
    if (pathname === '/i18n.js') return send(res, 200, 'text/javascript; charset=utf-8', i18n.clientScript(lang));
    if (pathname.startsWith('/uploads/')) {
      return serveFile(req, res, UPLOADS, pathname.slice('/uploads/'.length), 'public, max-age=31536000, immutable');
    }
    return serveFile(req, res, PUBLIC, pathname.slice(1), 'no-cache');
  } catch (err) {
    if (res.headersSent) return res.end();
    const status = err instanceof HttpError ? err.status : err instanceof URIError || err.code === 'ERR_INVALID_URL' ? 400 : 500;
    if (status === 500) console.error(err);
    const message = status === 500 ? t('err.server') : t(err.message, err.vars);
    if (isApi) return sendJson(res, status, { error: message, fields: err.fields });
    if (status === 404) return sendHtml(res, 404, render('404', lang));
    send(res, status, 'text/plain; charset=utf-8', message);
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

const args = process.argv.slice(2);
const siteName = i18n.loc(config.siteName, 'en');
const credentialsFile = auth.ensureAdmin({ reset: args.includes('--reset-admin') });
auth.ensureDistrictCorporations(config.districts);
if (credentialsFile) {
  const shown = path.relative(ROOT, credentialsFile);
  console.log(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8
    ? 'Admin account ready. Sign in as "admin" with the password from the ADMIN_PASSWORD setting.'
    : `Admin account ready. Login details saved in: ${shown.startsWith('..') ? credentialsFile : shown}`);
}

if (!args.includes('--reset-admin')) {
  const port = Number(process.env.PORT) || config.port || 3000;
  const lan = args.includes('--lan');
  // On a hosting service set HOST=0.0.0.0 (or PORT) so the site listens on every interface, not just this machine.
  const host = process.env.HOST || (lan || process.env.PORT ? '0.0.0.0' : '127.0.0.1');

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Close the other program or change "port" in config.json.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, host, () => {
    console.log(`${siteName} is running:  http://localhost:${port}`);
    if (lan) {
      for (const address of lanAddresses()) console.log(`  On your Wi-Fi network:     http://${address}:${port}`);
    }
    console.log('Officials sign in at /admin. Press Ctrl+C to stop.');
  });
}
