// Shared helpers used by every page. Everything hangs off one global: SB.
(function () {
  'use strict';

  const SB = (window.SB = {});

  // ---------- Language ----------

  const i18n = window.SB_I18N || { lang: 'en', strings: {} };
  const LOCALES = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN' };
  SB.lang = i18n.lang;
  SB.locale = LOCALES[SB.lang] || 'en-IN';

  // t('key', { n: 3 }) returns the string for the visitor's language with {n} filled in.
  SB.t = function (key, vars) {
    const text = i18n.strings[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (token, name) => (name in vars ? vars[name] : token)) : text;
  };
  // tn('count.vote', 3) picks the singular or plural form.
  SB.tn = (key, n) => SB.t(`${key}.${n === 1 ? 'one' : 'other'}`, { n });
  const t = SB.t;

  // ---------- DOM and storage ----------

  // Builds DOM nodes. User-written text always goes in as text nodes, never as HTML.
  SB.el = function (tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  };
  const el = SB.el;

  // Replaces a node's children, skipping empty values the way SB.el does (replaceChildren alone would print "null").
  SB.fill = (node, ...children) => node.replaceChildren(...children.flat(Infinity).filter((child) => child != null && child !== false));

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage blocked (private window): the page still works */ }
    return null;
  }

  // A random id kept in this browser so it gets one vote per suggestion. It is not tied to a person.
  let voter;
  SB.voterId = function () {
    if (voter) return voter;
    voter = store('sb_voter');
    if (typeof voter !== 'string' || voter.length < 16) {
      voter = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      store('sb_voter', voter);
    }
    return voter;
  };

  SB.api = async function (path, options = {}) {
    const headers = { Accept: 'application/json', 'X-Voter-Id': SB.voterId() };
    const init = { method: options.method || 'GET', headers, credentials: 'same-origin' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(path, init);
    } catch {
      throw new Error(t('common.networkError'));
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((data && data.error) || `${response.status}`);
      error.status = response.status;
      error.fields = (data && data.fields) || null;
      throw error;
    }
    return data;
  };

  let metaPromise;
  SB.meta = function () {
    metaPromise = metaPromise || SB.api('/api/meta').then((meta) => {
      const index = (list) => Object.fromEntries(list.map((item) => [item.id, item]));
      meta.categoryById = index(meta.categories);
      meta.statusById = index(meta.statuses);
      meta.typeById = index(meta.types);
      meta.departmentById = index(meta.departments);
      meta.districtById = index(meta.districts);
      return meta;
    });
    return metaPromise;
  };

  // ---------- Formatting ----------

  SB.formatDate = function (iso) {
    return new Date(iso).toLocaleDateString(SB.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  SB.timeAgo = function (iso) {
    const minutes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return t('time.justNow');
    if (minutes < 60) return t('time.min', { n: Math.floor(minutes) });
    const hours = minutes / 60;
    if (hours < 24) return t('time.hour', { n: Math.floor(hours) });
    const days = Math.floor(hours / 24);
    if (days === 1) return t('time.yesterday');
    if (days < 30) return t('time.days', { n: days });
    return SB.formatDate(iso);
  };

  // Wards are stored as "Ward 4"; show the word "Ward" in the visitor's language.
  SB.ward = function (name) {
    const match = /^Ward (\d+)$/.exec(name || '');
    return match ? t('ward.n', { n: match[1] }) : name;
  };

  SB.districtLabel = (id, meta) => (id && meta.districtById[id] ? meta.districtById[id].label : id || '');

  // "Hubballi, Dharwad": the town and its district, or just "Mysuru" when the town has the
  // district's name (in any language, so a town typed in English still matches in Kannada).
  SB.place = (item, meta) => {
    const district = SB.districtLabel(item.district, meta);
    const entry = meta.districtById[item.district];
    const names = (entry ? entry.labels : [district]).map((name) => name.toLowerCase());
    const town = item.town && !names.includes(item.town.trim().toLowerCase()) ? item.town : '';
    return [town, district].filter(Boolean).join(', ');
  };

  SB.link = (code) => `/suggestion?id=${encodeURIComponent(code)}`;

  // ---------- Reusable pieces ----------

  SB.statusBadge = function (status, meta) {
    const label = (meta.statusById[status] || { label: status }).label;
    return el('span', { class: `badge status-${status}` }, label);
  };

  SB.typeBadge = function (type, meta) {
    const label = (meta.typeById[type] || { label: type }).label;
    return el('span', { class: `badge type-${type}` }, label);
  };

  SB.category = function (id, meta) {
    return meta.categoryById[id] || { id, label: id, icon: '📌' };
  };

  SB.departmentLabel = function (id, meta) {
    return id ? (meta.departmentById[id] || { label: id }).label : '';
  };

  SB.voteButton = function (suggestion, { large = false } = {}) {
    const count = el('span', { class: 'vote-count' }, suggestion.votes);
    const button = el('button', { type: 'button', class: large ? 'vote vote-lg' : 'vote' },
      el('span', { class: 'vote-arrow', 'aria-hidden': 'true' }, '▲'),
      count,
      el('span', { class: 'vote-label' }, t('vote.label')));

    function paint() {
      count.textContent = suggestion.votes;
      button.setAttribute('aria-pressed', String(suggestion.voted));
      button.setAttribute('aria-label', t(suggestion.voted ? 'vote.ariaOn' : 'vote.aria', { n: suggestion.votes }));
    }
    paint();

    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await SB.api(`/api/suggestions/${suggestion.code}/vote`, { method: 'POST', body: {} });
        suggestion.votes = result.votes;
        suggestion.voted = result.voted;
        paint();
      } catch (error) {
        SB.toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
    return button;
  };

  SB.card = function (suggestion, meta) {
    const category = SB.category(suggestion.category, meta);
    return el('article', { class: 'card' },
      SB.voteButton(suggestion),
      el('div', { class: 'card-body' },
        el('div', { class: 'badges' },
          SB.typeBadge(suggestion.type, meta),
          SB.statusBadge(suggestion.status, meta),
          suggestion.responded && el('span', { class: 'badge badge-reply' }, t('badge.replied'))),
        el('h3', { class: 'card-title' }, el('a', { href: SB.link(suggestion.code) }, suggestion.title)),
        el('p', { class: 'card-excerpt' }, suggestion.excerpt),
        el('p', { class: 'meta' },
          el('span', null, `${category.icon} ${category.label}`),
          el('span', null, `📍 ${SB.place(suggestion, meta)}`),
          el('span', null, SB.timeAgo(suggestion.createdAt)),
          el('span', null, SB.tn('count.comment', suggestion.comments)),
          suggestion.lat != null && el('span', null, t('common.pinned')),
          suggestion.hasPhoto && el('span', null, t('common.photo')))));
  };

  SB.empty = function (title, text, action) {
    return el('div', { class: 'empty' }, el('h3', null, title), text && el('p', null, text), action);
  };

  // On phones the filter selects fold away behind a "Filters" button that shows how many are set.
  // Returns a function to call after the filters change, to update that count.
  SB.filterToggle = function (form) {
    const button = form.querySelector('.filter-toggle');
    const count = button.querySelector('.filter-count');
    button.addEventListener('click', () => {
      const open = form.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
    });
    return () => {
      const set = [...form.querySelectorAll('.filter-extra select')].filter((select) => select.value).length;
      count.textContent = set ? ` (${set})` : '';
      count.hidden = !set;
    };
  };

  SB.fillSelect = function (select, options, placeholder) {
    SB.fill(select,
      placeholder != null && el('option', { value: '' }, placeholder),
      ...options.map((option) => el('option', { value: option.value }, option.label)));
  };

  // Shows server-side validation messages under the matching fields of a form.
  SB.showFieldErrors = function (form, fields) {
    let first = null;
    for (const node of form.querySelectorAll('[data-error]')) {
      const message = fields && fields[node.dataset.error];
      node.textContent = message || '';
      node.hidden = !message;
      const input = node.closest('.field') && node.closest('.field').querySelector('input, select, textarea');
      if (input) input.toggleAttribute('aria-invalid', Boolean(message));
      if (message && !first) first = input || node;
    }
    if (first) {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (first.focus) first.focus({ preventScroll: true });
    }
  };

  let toastTimer;
  SB.toast = function (message, kind) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    // An open modal dialog covers the page, so show the message inside it.
    (document.querySelector('dialog[open]') || document.body).append(toast);
    toast.textContent = message;
    toast.className = kind === 'error' ? 'toast toast-error' : 'toast';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  };

  SB.copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API is unavailable on plain-http network addresses: fall back to the old way.
      const area = el('textarea', { class: 'sr-only', readonly: true });
      area.value = text;
      document.body.append(area);
      area.select();
      const done = document.execCommand('copy');
      area.remove();
      return done;
    }
  };

  // Tracking codes submitted from this browser (kept locally so people can find them again).
  SB.myCodes = () => (Array.isArray(store('sb_codes')) ? store('sb_codes') : []);
  SB.rememberCode = (code) => store('sb_codes', [code, ...SB.myCodes().filter((c) => c !== code)].slice(0, 30));

  SB.debounce = function (fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  // Shrinks a photo in the browser before upload: at most 1280 px on the long side, JPEG.
  SB.shrinkImage = function (file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(t('submit.photoBad')));
      };
      image.src = url;
    });
  };

  // "Report" dialog for a submission (or one of its comments when commentId is given).
  SB.openReport = function ({ code, commentId }) {
    const error = el('p', { class: 'error', hidden: true });
    const form = el('form', { novalidate: true },
      el('div', { class: 'dialog-head' },
        el('h2', null, t('report.title')),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => dialog.close() }, t('common.close'))),
      el('div', { class: 'dialog-body' },
        el('fieldset', { class: 'field' },
          el('legend', null, t('report.reason')),
          ['spam', 'abuse', 'personal', 'false', 'other'].map((reason) => el('label', { class: 'check' },
            el('input', { type: 'radio', name: 'reason', value: reason }),
            el('span', null, t(`report.${reason}`))))),
        error,
        el('div', { class: 'form-actions' },
          el('button', { type: 'submit', class: 'btn btn-primary' }, t('report.send')))));
    const dialog = el('dialog', { class: 'dialog' }, form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const reason = form.elements.reason.value;
      try {
        if (!reason) throw new Error(t('err.reportReason'));
        await SB.api('/api/reports', { method: 'POST', body: { code, commentId, reason } });
        dialog.close();
        SB.toast(t('report.done'));
      } catch (err) {
        error.textContent = (err.fields && err.fields.reason) || err.message;
        error.hidden = false;
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  };

  // ---------- Header: menu, language, text size, dark mode ----------

  const root = document.documentElement;
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    for (const link of nav.querySelectorAll('a')) {
      if (link.getAttribute('href') === location.pathname) link.setAttribute('aria-current', 'page');
    }
  }

  for (const button of document.querySelectorAll('.lang-switch button')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === SB.lang));
    button.addEventListener('click', () => {
      if (button.dataset.lang === SB.lang) return;
      // The server reads this cookie and sends every page in the chosen language.
      document.cookie = `sb_lang=${button.dataset.lang}; path=/; max-age=31536000; samesite=lax`;
      location.reload();
    });
  }

  function preference(buttonId, attribute, onValue, offValue, storageKey) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    // The icon always shows; the words hide on narrow screens but stay readable by screen readers.
    const paint = () => {
      const on = root.getAttribute(attribute) === onValue;
      button.setAttribute('aria-pressed', String(on));
      button.querySelector('.tool-text').textContent = on ? button.dataset.on : button.dataset.off;
      button.querySelector('.tool-icon').textContent = on ? button.dataset.onIcon : button.dataset.offIcon;
    };
    button.addEventListener('click', () => {
      const next = root.getAttribute(attribute) === onValue ? offValue : onValue;
      root.setAttribute(attribute, next);
      try {
        localStorage.setItem(storageKey, next);
      } catch { /* the choice just will not be remembered */ }
      paint();
    });
    paint();
  }
  preference('text-toggle', 'data-text', 'large', 'normal', 'sb_text');
  preference('theme-toggle', 'data-theme', 'dark', 'light', 'sb_theme');

  // ---------- Corporation Header Mode (hide "Submit a suggestion" at top for Corporation Login) ----------
  SB.updateCorpHeader = function (isCorp) {
    for (const btn of document.querySelectorAll('.site-header a[href="/submit"]')) {
      btn.hidden = Boolean(isCorp);
    }
  };

  let corpPromise = null;
  SB.getCorpSession = function () {
    if (!corpPromise) {
      corpPromise = SB.api('/api/admin/me').then((me) => {
        SB.updateCorpHeader(true);
        try { sessionStorage.setItem('sb_role', 'corporation'); } catch {}
        return me;
      }).catch(() => {
        const isCorpRole = (() => {
          try { return sessionStorage.getItem('sb_role') === 'corporation'; } catch { return false; }
        })();
        SB.updateCorpHeader(isCorpRole || location.pathname === '/admin');
        return null;
      });
    }
    return corpPromise;
  };
  SB.getCorpSession();

  // ---------- Role Selection Gate: Citizen User vs District Corporation Member ----------
  SB.openRoleGate = async function (startOnLogin = false) {
    const existing = document.getElementById('role-gate-dialog');
    if (existing) existing.remove();

    const chooseView = el('div', { class: 'role-gate-choose' },
      el('p', { class: 'lead role-gate-lead' }, 'Are you a Citizen or a Corporation Member?'),
      el('div', { class: 'role-gate-grid' },
        el('button', {
          type: 'button',
          class: 'action-tile role-card',
          onclick: async () => {
            await SB.api('/api/admin/logout', { method: 'POST', body: {} }).catch(() => {});
            corpPromise = Promise.resolve(null);
            try { sessionStorage.setItem('sb_role', 'user'); } catch {}
            SB.updateCorpHeader(false);
            dialog.close();
            if (location.pathname === '/admin') location.href = '/';
          },
        },
          el('span', { class: 'action-icon', 'aria-hidden': 'true' }, '👤'),
          el('strong', null, 'I am a Citizen'),
          el('span', null, 'Submit suggestions, report civic problems in your district, vote & track progress.')),
        el('button', {
          type: 'button',
          class: 'action-tile role-card role-card-corp',
          onclick: () => showCorpLogin(),
        },
          el('span', { class: 'action-icon', 'aria-hidden': 'true' }, '🏛️'),
          el('strong', null, 'I am a Corporation Member'),
          el('span', null, 'Sign in with your District User ID & Password to view and resolve your district\'s problems.'))));

    const districtSelect = el('select', { id: 'gate-district', required: true },
      el('option', { value: '' }, 'Choose your district'));
    const userIdInput = el('input', {
      id: 'gate-username', type: 'text', required: true, autocomplete: 'username',
      autocapitalize: 'none', placeholder: 'e.g. mysuru',
    });
    const passwordInput = el('input', {
      id: 'gate-password', type: 'password', required: true, autocomplete: 'current-password',
      placeholder: 'Enter district password',
    });
    const idHint = el('p', { class: 'hint', hidden: true });
    const loginError = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Sign in to District Corporation');
    const backBtn = el('button', {
      type: 'button', class: 'btn',
      onclick: () => {
        loginForm.hidden = true;
        chooseView.hidden = false;
        titleNode.textContent = 'Welcome to CivicVoice';
      },
    }, '← Back');

    districtSelect.addEventListener('change', () => {
      const distId = districtSelect.value;
      if (distId) {
        userIdInput.value = distId;
        idHint.textContent = `District Corporation User ID: ${distId}`;
        idHint.hidden = false;
        passwordInput.focus();
      } else {
        idHint.hidden = true;
      }
    });

    const loginForm = el('form', { class: 'role-login-form', hidden: true, novalidate: true },
      el('p', { class: 'hint hint-top' }, 'Each district has a dedicated Corporation profile that can only access and manage problems in that district.'),
      el('div', { class: 'field' },
        el('label', { for: 'gate-district' }, 'Select District Corporation'),
        districtSelect,
        idHint),
      el('div', { class: 'field' },
        el('label', { for: 'gate-username' }, 'District User ID'),
        userIdInput),
      el('div', { class: 'field' },
        el('label', { for: 'gate-password' }, 'Password'),
        passwordInput),
      loginError,
      el('div', { class: 'form-actions' }, submitBtn, backBtn));

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      loginError.hidden = true;
      const district = districtSelect.value;
      const username = userIdInput.value.trim().toLowerCase();
      const password = passwordInput.value;
      if (!username || !password) {
        loginError.textContent = 'Please select your district and enter your User ID and Password.';
        loginError.hidden = false;
        return;
      }
      submitBtn.disabled = true;
      try {
        await SB.api('/api/admin/login', {
          method: 'POST',
          body: { district: district || undefined, username, password },
        });
        try { sessionStorage.setItem('sb_role', 'corporation'); } catch {}
        dialog.close();
        if (location.pathname === '/admin') location.reload();
        else location.href = '/admin';
      } catch (err) {
        loginError.textContent = err.message;
        loginError.hidden = false;
        submitBtn.disabled = false;
      }
    });

    const titleNode = el('h2', null, 'Welcome to CivicVoice');

    const dialog = el('dialog', { id: 'role-gate-dialog', class: 'dialog dialog-wide role-gate-dialog' },
      el('div', { class: 'dialog-head' }, titleNode),
      el('div', { class: 'dialog-body' }, chooseView, loginForm));

    // Prevent Escape from bypassing the initial Citizen vs Corporation Member choice
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
    });

    async function showCorpLogin() {
      chooseView.hidden = true;
      loginForm.hidden = false;
      titleNode.textContent = 'District Corporation Login';
      try {
        const meta = await SB.meta();
        SB.fillSelect(districtSelect, meta.districts.map((d) => ({ value: d.id, label: `${d.label} (${d.id})` })), 'Choose your district');
      } catch {}
      districtSelect.focus();
    }

    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    if (startOnLogin) showCorpLogin();
  };

  const roleBtn = document.getElementById('role-gate-button');
  if (roleBtn) {
    roleBtn.addEventListener('click', () => SB.openRoleGate(false));
  }

  try {
    const navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    const isReload = navEntry && navEntry.type === 'reload';
    const isExternalOpen = !document.referrer || !document.referrer.startsWith(location.origin);
    if (isReload || isExternalOpen) {
      sessionStorage.removeItem('sb_role');
    }
    if (location.pathname !== '/admin' && !sessionStorage.getItem('sb_role')) {
      SB.openRoleGate(false);
    }
  } catch {}

  // ---------- Interactive 3D perspective tilt on cards ----------
  const TILT_SELECTOR = '.action-tile, .card, .category-tile, button.kpi, .steps li, .hero-panel, .council-grid .panel';
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let activeCard = null;
    document.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const card = event.target.closest && event.target.closest(TILT_SELECTOR);
      if (activeCard && activeCard !== card) {
        activeCard.style.removeProperty('--rx');
        activeCard.style.removeProperty('--ry');
        activeCard = null;
      }
      if (!card) return;
      activeCard = card;
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
    }, { passive: true });

    document.addEventListener('pointerleave', () => {
      if (activeCard) {
        activeCard.style.removeProperty('--rx');
        activeCard.style.removeProperty('--ry');
        activeCard = null;
      }
    }, { passive: true });
  }
})();
