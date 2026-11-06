'use strict';

// Small helpers shared by the server: errors, input validation, body parsing, rate limiting, CSV.

// `message` is an i18n key; the server translates it for the visitor before sending.
class HttpError extends Error {
  constructor(status, message, fields, vars) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.vars = vars;
  }
}

// Collects one message per field so the form can show every problem at once.
class Validator {
  constructor(t) {
    this.t = t;
    this.fields = {};
  }

  fail(field, key, vars) {
    if (!this.fields[field]) this.fields[field] = this.t(key, vars);
    return null;
  }

  // `label` is an i18n key. Returns the cleaned string, or null when an optional field is empty.
  text(field, value, { label, min = 0, max, multiline = false }) {
    const name = this.t(label);
    if (value == null) value = '';
    if (typeof value !== 'string') return this.fail(field, 'err.invalid', { label: name });
    let s = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    s = multiline
      ? s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      : s.replace(/\s+/g, ' ').trim();
    if (!s) return min > 0 ? this.fail(field, 'err.required', { label: name }) : null;
    if (s.length < min) return this.fail(field, 'err.min', { label: name, n: min });
    if (s.length > max) return this.fail(field, 'err.max', { label: name, n: max });
    return s;
  }

  oneOf(field, value, allowed, key) {
    return allowed.includes(value) ? value : this.fail(field, key);
  }

  throwIfInvalid() {
    if (Object.keys(this.fields).length) throw new HttpError(422, 'err.fix', this.fields);
  }
}

function readJson(req, limitBytes) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) {
      req.resume();
      reject(new HttpError(415, 'err.json'));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return; // keep draining so the client can read our 413 reply
      size += chunk.length;
      if (size > limitBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'err.tooLarge'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value);
      } catch {
        reject(new HttpError(400, 'err.json'));
      }
    });
    req.on('error', reject);
  });
}

// In-memory sliding window. Good enough for one server process.
const buckets = new Map();

function rateLimit(key, max, windowMs, messageKey = 'err.rate') {
  const nowMs = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => nowMs - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    throw new HttpError(429, messageKey);
  }
  hits.push(nowMs);
  buckets.set(key, hits);
}

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, hits] of buckets) {
    if (!hits.length || hits[hits.length - 1] < cutoff) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Stop spreadsheet apps from running a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  // The BOM makes Excel read the file as UTF-8.
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { HttpError, Validator, readJson, rateLimit, escapeHtml, toCsv };
