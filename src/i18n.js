'use strict';

// Languages: one JSON file of strings per language in /i18n. English is the fallback for missing keys.

const fs = require('node:fs');
const path = require('node:path');

const LANGS = ['en', 'kn', 'hi'];
const DIR = path.join(__dirname, '..', 'i18n');

const strings = {};
for (const lang of LANGS) {
  strings[lang] = JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), 'utf8').replace(/^﻿/, ''));
}

function fill(text, vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (token, key) => (key in vars ? vars[key] : token)) : text;
}

// Returns t(key, vars) for one language.
function translator(lang) {
  const own = strings[lang] || strings.en;
  return (key, vars) => fill(own[key] ?? strings.en[key] ?? key, vars);
}

// The visitor's language is kept in a cookie set by the language buttons.
function pickLang(req) {
  const match = /(?:^|;\s*)sb_lang=([a-z]{2})(?:;|$)/.exec(req.headers.cookie || '');
  return match && LANGS.includes(match[1]) ? match[1] : 'en';
}

// Config values may be plain text or { en, kn, hi }.
function loc(value, lang) {
  if (value && typeof value === 'object') return value[lang] ?? value.en ?? Object.values(value)[0];
  return value;
}

// The strings the browser scripts need, as a small script file.
function clientScript(lang) {
  const bundle = { lang, strings: { ...strings.en, ...strings[lang] } };
  return `window.SB_I18N = ${JSON.stringify(bundle)};`;
}

module.exports = { LANGS, translator, pickLang, loc, clientScript };
