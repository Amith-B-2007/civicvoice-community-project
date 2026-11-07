'use strict';

// Official sign-in: scrypt password hashes and cookie sessions stored in the database.
// Two roles: "admin" (head of the council office, sees everything) and "officer" (one department).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

const COOKIE = 'sb_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const CREDENTIALS_FILE = path.join(db.DATA_DIR, 'admin-credentials.txt');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { hash: crypto.scryptSync(password, salt, 64).toString('hex'), salt };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

// Creates the first admin account and saves its login to a local file (data/ is git-ignored).
// The password is random, or ADMIN_PASSWORD when set: on a hosting service the file is hard to
// reach, so the owner chooses the first password there. Returns the file path when an account was created.
function ensureAdmin({ reset = false } = {}) {
  if (reset) db.deleteHeadAdmins();
  if (db.countAdmins() > 0) return null;
  const chosen = process.env.ADMIN_PASSWORD || '';
  if (chosen && chosen.length < 8) console.warn('ADMIN_PASSWORD is shorter than 8 characters, so a random password was used instead.');
  const password = chosen.length >= 8 ? chosen : generatePassword();
  const { hash, salt } = hashPassword(password);
  db.createAdmin('admin', hash, salt, { role: 'admin', name: 'Administrator' });
  fs.writeFileSync(CREDENTIALS_FILE, [
    'Suggestion Box: official login',
    '',
    'Username: admin',
    `Password: ${password === chosen ? 'the one in the ADMIN_PASSWORD setting' : password}`,
    '',
    'Sign in at /admin and change this password from the panel.',
    'Forgot it later? Run:  npm run reset-admin',
    '',
  ].join('\n'));
  return CREDENTIALS_FILE;
}

function createOfficer({ username, name, department = null, district = null, password }) {
  const { hash, salt } = hashPassword(password);
  return db.createAdmin(username, hash, salt, { role: 'officer', department, district, name });
}

// Ensures every district has its own Corporation profile (User ID: <district-id>, Password: <district-id>@123)
// scoped strictly to that district (all departments/categories within that district).
function ensureDistrictCorporations(districts = []) {
  const loginsFile = path.join(db.DATA_DIR, 'district-corporation-logins.txt');
  const lines = [
    'CivicVoice: District Corporation Logins (Sign in at / or /admin)',
    'Each Corporation member can only access and manage problems for their assigned district.',
    '--------------------------------------------------------------------------------',
    `${'District'.padEnd(22)} | ${'User ID'.padEnd(20)} | Password`,
    '--------------------------------------------------------------------------------',
  ];
  let created = 0;
  for (const district of districts) {
    const username = district.id;
    const password = `${district.id}@123`;
    const labelEn = (district.label && district.label.en) || district.label || district.id;
    const name = `${labelEn} Corporation`;
    if (!db.findAdmin(username)) {
      createOfficer({ username, name, department: null, district: district.id, password });
      created += 1;
    }
    lines.push(`${String(labelEn).padEnd(22)} | ${username.padEnd(20)} | ${password}`);
  }
  lines.push('');
  fs.writeFileSync(loginsFile, lines.join('\n'));
  return { created, loginsFile };
}

function resetPassword(adminId, password) {
  const { hash, salt } = hashPassword(password);
  db.setAdminPassword(adminId, hash, salt);
  db.deleteSessionsFor(adminId);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function cookieHeader(req, value, maxAgeSeconds) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

// Returns { cookie } on success, { error } on district mismatch, or null when the details are wrong.
function login(req, username, password, expectedDistrict = null) {
  const admin = db.findAdmin(username);
  if (!admin) {
    hashPassword(password, 'no-such-user'); // spend the same time whether or not the user exists
    return null;
  }
  if (!verifyPassword(password, admin.salt, admin.password_hash)) return null;
  if (expectedDistrict && admin.role === 'officer' && admin.district && admin.district !== expectedDistrict) {
    return { error: 'This User ID belongs to a different district corporation.' };
  }
  db.purgeSessions();
  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(sha256(token), admin.id, Date.now() + SESSION_MS);
  return { cookie: cookieHeader(req, token, SESSION_MS / 1000) };
}

function currentAdmin(req) {
  const token = readCookie(req, COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = db.findSession(sha256(token));
  if (!session || session.expires_at < Date.now()) return null;
  return {
    id: session.id,
    username: session.username,
    name: session.name || session.username,
    role: session.role,
    department: session.role === 'officer' ? session.department : null,
    district: session.role === 'officer' ? session.district || null : null,
    tokenHash: sha256(token),
  };
}

function logout(req) {
  const token = readCookie(req, COOKIE);
  if (token) db.deleteSession(sha256(token));
  return cookieHeader(req, '', 0);
}

function changePassword(admin, currentPassword, newPassword) {
  const row = db.findAdminById(admin.id);
  if (!row || !verifyPassword(currentPassword, row.salt, row.password_hash)) return false;
  const { hash, salt } = hashPassword(newPassword);
  db.setAdminPassword(admin.id, hash, salt);
  db.deleteSessionsFor(admin.id, admin.tokenHash); // sign out every other device
  if (admin.role === 'admin' && fs.existsSync(CREDENTIALS_FILE)) {
    fs.writeFileSync(CREDENTIALS_FILE, [
      'Suggestion Box: official login',
      '',
      `The admin password was changed from the panel on ${new Date().toDateString()}.`,
      'Forgot it? Run:  npm run reset-admin',
      '',
    ].join('\n'));
  }
  return true;
}

module.exports = {
  ensureAdmin, ensureDistrictCorporations, createOfficer, resetPassword, generatePassword,
  login, logout, currentAdmin, changePassword,
};
