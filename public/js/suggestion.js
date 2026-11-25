(async function () {
  'use strict';
  const { el, api, t } = SB;

  const root = document.getElementById('detail');
  const code = (new URLSearchParams(location.search).get('id') || '').trim().toUpperCase();
  const STAGES = ['submitted', 'under_review', 'planned', 'in_progress', 'implemented'];

  let meta;
  let s;
  try {
    [meta, s] = await Promise.all([SB.meta(), api(`/api/suggestions/${encodeURIComponent(code || '-')}`)]);
  } catch (error) {
    const missing = error.status === 404;
    root.replaceChildren(SB.empty(
      t(missing ? 'detail.notFound.t' : 'common.loadError'),
      missing ? t('detail.notFound.d') : error.message,
      el('a', { class: 'btn btn-primary', href: '/track' }, t('detail.trackBtn'))));
    return;
  }
  document.title = `${s.title} · ${meta.siteName}`;

  const statusLabel = (id) => (meta.statusById[id] ? meta.statusById[id].label : id);
  const photoLink = (src, alt, className = 'detail-photo') => el('a', { href: src, target: '_blank', rel: 'noopener' },
    el('img', { class: className, src, alt }));

  // ---------- Progress, Live 7-Day SLA Countdown & Official Updates ----------

  let slaTimer = null;
  function slaBanner() {
    clearInterval(slaTimer);
    const slaDays = Number(meta.overdueDays) || 7;
    const deadlineMs = new Date(s.createdAt).getTime() + slaDays * 86400000;
    const clockNode = el('strong', { class: 'sla-clock' });
    const box = el('div', { class: 'sla-live-banner' });

    function tick() {
      if (s.status === 'implemented') {
        box.className = 'sla-live-banner sla-done';
        box.replaceChildren(
          el('span', { class: 'sla-dot', 'aria-hidden': 'true' }),
          el('div', null,
            el('strong', null, '✅ Work Completed & Verified'),
            el('span', null, `Marked Implemented · Last updated ${SB.timeAgo(s.updatedAt || s.createdAt)}`)));
        clearInterval(slaTimer);
        return;
      }
      if (s.status === 'not_feasible') {
        box.className = 'sla-live-banner sla-closed';
        box.replaceChildren(
          el('div', null,
            el('strong', null, '⚪ Closed (Not Feasible)'),
            el('span', null, 'Corporation reviewed and closed this request.')));
        clearInterval(slaTimer);
        return;
      }
      if (s.status !== 'submitted') {
        box.className = 'sla-live-banner sla-active';
        box.replaceChildren(
          el('span', { class: 'sla-dot', 'aria-hidden': 'true' }),
          el('div', null,
            el('strong', null, `🟢 Live Status: ${statusLabel(s.status)}`),
            el('span', null, `Initial ${slaDays}-day SLA met · Active with ${SB.departmentLabel(s.department, meta) || 'District Corporation'}`)));
        clearInterval(slaTimer);
        return;
      }

      const diff = deadlineMs - Date.now();
      const abs = Math.abs(diff);
      const d = Math.floor(abs / 86400000);
      const h = Math.floor((abs % 86400000) / 3600000);
      const m = Math.floor((abs % 3600000) / 60000);
      const sec = Math.floor((abs % 60000) / 1000);
      const pad = (n) => String(n).padStart(2, '0');

      if (diff >= 0) {
        box.className = 'sla-live-banner sla-pending';
        clockNode.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
        if (!box.firstChild) {
          box.replaceChildren(
            el('span', { class: 'sla-dot', 'aria-hidden': 'true' }),
            el('div', null,
              el('span', { class: 'sla-title' }, `⏱️ ${slaDays}-Day SLA Countdown for Corporation Review:`),
              clockNode));
        }
      } else {
        box.className = 'sla-live-banner sla-overdue';
        clockNode.textContent = `Overdue by ${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
        if (!box.firstChild || !box.classList.contains('sla-overdue')) {
          box.replaceChildren(
            el('span', { class: 'sla-dot', 'aria-hidden': 'true' }),
            el('div', null,
              el('span', { class: 'sla-title' }, `🚨 ${slaDays}-Day SLA Breached — Escalated to District Corporation:`),
              clockNode));
        }
      }
    }

    tick();
    if (s.status === 'submitted') {
      slaTimer = setInterval(tick, 1000);
    }
    return box;
  }

  function progressPanel() {
    const current = STAGES.indexOf(s.status);
    const stepper = s.status === 'not_feasible'
      ? el('p', { class: 'notice notice-closed' }, t('detail.notFeasible'))
      : el('ol', { class: 'stepper' }, STAGES.map((stage, index) => el('li', {
        class: index < current ? 'done' : index === current ? 'current' : '',
        'aria-current': index === current ? 'step' : null,
      }, statusLabel(stage))));

    const events = [{ label: statusLabel('submitted'), at: s.createdAt }].concat(s.updates.map((update) => ({
      label: statusLabel(update.status),
      note: update.note,
      photo: update.photo,
      at: update.createdAt,
    })));

    return el('section', { class: 'panel progress-panel' },
      el('div', { class: 'progress-head' },
        el('h2', null, t('detail.progress')),
        el('span', { class: 'live-sync-pill', title: 'Automatically syncs live when Corporation updates status' }, '🟢 Live Sync')),
      slaBanner(),
      stepper,
      s.department && el('p', { class: 'handled-by' },
        el('span', null, t('detail.handledBy')), el('strong', null, SB.departmentLabel(s.department, meta))),
      el('h3', { class: 'panel-sub' }, t('detail.history')),
      el('ol', { class: 'timeline' }, events.map((event) => el('li', null,
        el('p', { class: 'timeline-head' }, el('strong', null, event.label), el('span', null, SB.formatDate(event.at))),
        event.note && el('p', { class: 'prose timeline-note' }, event.note),
        event.photo && photoLink(event.photo, t('detail.councilPhoto'), 'timeline-photo')))));
  }

  // ---------- Exact location ----------

  function locationPanel() {
    if (s.lat == null || s.lng == null) return null;
    const mapBox = el('div', { class: 'map map-small' });
    // Leaflet needs the box to be in the page before it can measure it.
    requestAnimationFrame(() => {
      const map = SB.maps.create(mapBox, meta, { center: [s.lat, s.lng], zoom: 17, wheel: false });
      L.marker([s.lat, s.lng], { icon: SB.maps.pinIcon(s.status), interactive: false }).addTo(map);
    });
    return el('section', { class: 'panel location-panel' },
      el('h2', null, t('detail.location')),
      mapBox,
      s.location && el('p', { class: 'location-text' }, s.location),
      el('p', { class: 'code' }, SB.maps.coords(s.lat, s.lng)),
      el('p', { class: 'map-links' },
        el('a', { class: 'btn btn-sm', href: SB.maps.placeLink(s.lat, s.lng), target: '_blank', rel: 'noopener noreferrer' }, t('detail.openMaps')),
        el('a', { class: 'btn btn-sm', href: SB.maps.directionsLink(s.lat, s.lng), target: '_blank', rel: 'noopener noreferrer' }, t('detail.directions'))));
  }

  // ---------- "Is this really fixed?" ----------

  function fixedPanel() {
    if (s.status !== 'implemented') return null;
    const summary = el('p', { class: 'fixed-summary' });
    const ratingSummary = el('p', { class: 'rating-summary' });
    const yes = el('button', { type: 'button', class: 'btn' }, t('detail.fixed.yes'));
    const no = el('button', { type: 'button', class: 'btn' }, t('detail.fixed.no'));

    const starButtons = [1, 2, 3, 4, 5].map((stars) => {
      const btn = el('button', {
        type: 'button',
        class: 'star-btn',
        'aria-label': `Rate ${stars} out of 5 stars`,
        title: `${stars} star${stars > 1 ? 's' : ''}`,
        onclick: () => submitRating(stars),
      }, '★');
      return btn;
    });

    function paint() {
      summary.textContent = t('detail.fixed.summary', { yes: s.fixed.yes, no: s.fixed.no });
      summary.hidden = s.fixed.yes + s.fixed.no === 0;
      yes.setAttribute('aria-pressed', String(s.fixed.mine === true));
      no.setAttribute('aria-pressed', String(s.fixed.mine === false));

      const currentStars = s.fixed.myRating || 0;
      starButtons.forEach((btn, idx) => {
        const active = idx < currentStars;
        btn.classList.toggle('star-active', active);
        btn.setAttribute('aria-pressed', String(idx + 1 === currentStars));
      });
      if (s.fixed.ratingCount > 0 && s.fixed.ratingAvg != null) {
        ratingSummary.textContent = `★ ${Number(s.fixed.ratingAvg).toFixed(1)} / 5 average quality rating (${s.fixed.ratingCount} rating${s.fixed.ratingCount === 1 ? '' : 's'})`;
        ratingSummary.hidden = false;
      } else {
        ratingSummary.hidden = true;
      }
    }

    async function answer(fixed) {
      yes.disabled = no.disabled = true;
      try {
        s.fixed = await api(`/api/suggestions/${s.code}/fixed`, { method: 'POST', body: { fixed } });
        paint();
        SB.toast(t('detail.fixed.thanks'));
      } catch (error) {
        SB.toast(error.message, 'error');
      } finally {
        yes.disabled = no.disabled = false;
      }
    }

    async function submitRating(rating) {
      for (const b of starButtons) b.disabled = true;
      try {
        s.fixed = await api(`/api/suggestions/${s.code}/rate`, { method: 'POST', body: { rating } });
        paint();
        SB.toast(`Thank you for rating the work ${rating} ★!`);
      } catch (error) {
        SB.toast(error.message, 'error');
      } finally {
        for (const b of starButtons) b.disabled = false;
      }
    }

    yes.addEventListener('click', () => answer(true));
    no.addEventListener('click', () => answer(false));
    paint();

    return el('section', { class: 'fixed-box' },
      el('h2', null, t('detail.fixed.q')),
      el('p', null, t('detail.fixed.hint')),
      el('div', { class: 'fixed-actions' }, yes, no),
      summary,
      el('div', { class: 'rating-box' },
        el('p', { class: 'rating-label' }, '⭐ Rate the Corporator for this Completed Work (1 to 5 stars):'),
        el('div', { class: 'star-group', role: 'group', 'aria-label': '5-star quality rating' }, starButtons),
        ratingSummary));
  }

  // ---------- Share ----------

  function sharePanel() {
    const button = el('button', { type: 'button', class: 'btn btn-sm' }, t('detail.copyLink'));
    button.addEventListener('click', async () => {
      button.textContent = t((await SB.copy(location.href)) ? 'detail.linkCopied' : 'common.copyFailed');
    });
    return el('section', { class: 'panel share-panel' },
      el('h2', null, t('detail.share')),
      el('p', { class: 'hint hint-top' }, t('detail.shareHint')),
      el('p', { class: 'share-row' }, el('span', { class: 'code' }, s.code), SB.saveButton(s.code, { compact: false }), button),
      el('p', { class: 'report-row' },
        el('button', { type: 'button', class: 'link-button', onclick: () => SB.openReport({ code: s.code }) }, `⚑ ${t('detail.report')}`)));
  }

  // ---------- Comments ----------

  function commentNode(comment) {
    return el('li', { class: 'comment' },
      el('p', { class: 'comment-head' },
        el('strong', null, comment.author || t('common.resident')),
        el('span', null, SB.timeAgo(comment.createdAt)),
        el('button', {
          type: 'button', class: 'link-button comment-report', title: t('detail.reportComment'),
          'aria-label': t('detail.reportComment'),
          onclick: () => SB.openReport({ code: s.code, commentId: comment.id }),
        }, '⚑')),
      el('p', { class: 'prose' }, comment.body));
  }

  function commentsSection() {
    const heading = el('h2', null, t('detail.comments', { n: s.thread.length }));
    const list = el('ol', { class: 'comments' }, s.thread.map(commentNode));
    const none = el('p', { class: 'hint hint-top' }, t('detail.noComments'));
    none.hidden = s.thread.length > 0;

    const name = el('input', { id: 'c-name', type: 'text', maxlength: '60', autocomplete: 'name' });
    const body = el('textarea', { id: 'c-body', rows: '3', maxlength: '600', required: true });
    const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
    const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, t('detail.postComment'));
    const form = el('form', { class: 'comment-form', novalidate: true },
      el('div', { class: 'field' },
        el('label', { for: 'c-body' }, t('detail.addComment')), body,
        el('p', { class: 'error', 'data-error': 'body', hidden: true })),
      el('div', { class: 'field' },
        el('label', { for: 'c-name' }, `${t('submit.name')} `, el('span', { class: 'optional' }, t('common.optional'))), name,
        el('p', { class: 'error', 'data-error': 'name', hidden: true })),
      el('div', { class: 'hp', 'aria-hidden': 'true' }, el('label', null, t('common.honeypot'), ' ', trap)),
      el('div', { class: 'form-actions' }, submit));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const { comment } = await api(`/api/suggestions/${s.code}/comments`, {
          method: 'POST',
          body: { name: name.value, body: body.value, website: trap.value },
        });
        s.thread.push(comment);
        list.append(commentNode(comment));
        heading.textContent = t('detail.comments', { n: s.thread.length });
        none.hidden = true;
        body.value = '';
        SB.showFieldErrors(form, null);
      } catch (error) {
        SB.showFieldErrors(form, error.fields);
        if (!error.fields) SB.toast(error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });

    return el('section', { class: 'panel comments-panel' }, heading, none, list, form);
  }

  // ---------- Photos: the resident's photo, and an interactive before/after comparison slider once the council adds one ----------

  function photos() {
    const after = [...s.updates].reverse().find((update) => update.photo && update.status === 'implemented')
      || [...s.updates].reverse().find((update) => update.photo);
    if (s.photo && after) {
      const stage = el('div', { class: 'ba-slider', style: '--split: 50%' });
      const range = el('input', {
        type: 'range',
        class: 'ba-range',
        min: '0',
        max: '100',
        value: '50',
        'aria-label': 'Slide left or right to compare Before and After photos',
      });
      const setSplit = (pct) => {
        const clamped = Math.max(0, Math.min(100, Number(pct)));
        range.value = String(clamped);
        stage.style.setProperty('--split', `${clamped}%`);
      };
      range.addEventListener('input', () => setSplit(range.value));

      stage.append(
        el('img', { class: 'ba-img ba-after-img', src: after.photo, alt: t('detail.after') }),
        el('div', { class: 'ba-before-clip' },
          el('img', { class: 'ba-img ba-before-img', src: s.photo, alt: t('detail.before') })),
        el('span', { class: 'ba-badge ba-badge-before' }, `⬅ ${t('detail.before')}`),
        el('span', { class: 'ba-badge ba-badge-after' }, `${t('detail.after')} ➡`),
        el('div', { class: 'ba-divider', 'aria-hidden': 'true' },
          el('span', { class: 'ba-handle' }, '⇄')),
        range
      );

      const quickBar = el('div', { class: 'ba-quick-bar' },
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => setSplit(100) }, `Show ${t('detail.before')}`),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => setSplit(50) }, '50 / 50 Split'),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => setSplit(0) }, `Show ${t('detail.after')}`));

      const sliderWrap = el('div', { class: 'ba-slider-view' }, stage, quickBar);
      const gridWrap = el('div', { class: 'before-after', hidden: true },
        el('figure', null, photoLink(s.photo, t('detail.before')), el('figcaption', null, t('detail.before'))),
        el('figure', null, photoLink(after.photo, t('detail.after')), el('figcaption', null, t('detail.after'))));

      const btnSlider = el('button', { type: 'button', class: 'btn btn-sm', 'aria-pressed': 'true' }, '⇄ Interactive Slider');
      const btnGrid = el('button', { type: 'button', class: 'btn btn-sm', 'aria-pressed': 'false' }, '🖼️ Side-by-Side');
      btnSlider.addEventListener('click', () => {
        sliderWrap.hidden = false;
        gridWrap.hidden = true;
        btnSlider.setAttribute('aria-pressed', 'true');
        btnGrid.setAttribute('aria-pressed', 'false');
      });
      btnGrid.addEventListener('click', () => {
        sliderWrap.hidden = true;
        gridWrap.hidden = false;
        btnSlider.setAttribute('aria-pressed', 'false');
        btnGrid.setAttribute('aria-pressed', 'true');
      });

      return el('div', { class: 'ba-compare-box' },
        el('div', { class: 'ba-compare-head' },
          el('strong', null, '📸 Before vs. After Work Verification'),
          el('div', { class: 'ba-view-toggle' }, btnSlider, btnGrid)),
        sliderWrap,
        gridWrap);
    }
    if (after) {
      return el('figure', null, photoLink(after.photo, t('detail.councilPhoto')), el('figcaption', null, t('detail.councilPhoto')));
    }
    return s.photo ? photoLink(s.photo, t('detail.photoAlt')) : null;
  }

  // ---------- Page & Real-Time Auto-Refresh ----------

  function renderPage() {
    const category = SB.category(s.category, meta);
    const reply = [...s.updates].reverse().find((update) => update.note);
    const place = [s.location, s.ward && SB.ward(s.ward), SB.place(s, meta)].filter(Boolean).join(', ');

    root.replaceChildren(
      el('p', { class: 'crumbs' }, el('a', { href: '/browse' }, t('detail.back'))),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'detail-main' },
          el('header', { class: 'detail-head' },
            SB.voteButton(s, { large: true }),
            el('div', null,
              el('div', { class: 'badges' },
                SB.typeBadge(s.type, meta), SB.statusBadge(s.status, meta), el('span', { class: 'code' }, s.code)),
              el('h1', null, s.title),
              el('p', { class: 'meta' },
                el('span', null, `${category.icon} ${category.label}`),
                el('span', null, place),
                el('span', null, t('detail.by', { name: s.author || t('common.anonymous') })),
                el('span', null, SB.formatDate(s.createdAt))))),
          reply && el('section', { class: 'reply' },
            el('div', { class: 'reply-head' },
              el('h2', null, t('detail.reply', { body: SB.departmentLabel(s.department, meta) || meta.bodyName })),
              SB.speakButton(() => reply.note, { compact: false, label: 'Listen to Reply' })),
            el('p', { class: 'prose' }, reply.note),
            el('p', { class: 'hint' }, SB.formatDate(reply.createdAt))),
          fixedPanel(),
          el('section', { class: 'panel description-panel' },
            el('div', { class: 'description-tools' },
              SB.speakButton(() => `${s.title}. ${s.description}`, { compact: false, label: 'Read Issue Aloud' })),
            el('p', { class: 'prose' }, s.description),
            photos()),
          commentsSection()),
        el('aside', { class: 'detail-side' }, progressPanel(), locationPanel(), sharePanel())));
  }

  renderPage();

  async function syncSuggestionLive() {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    try {
      const fresh = await api(`/api/suggestions/${encodeURIComponent(s.code)}`);
      const statusChanged = fresh.status !== s.status;
      const updatesChanged = fresh.updates.length !== s.updates.length;
      const votesChanged = fresh.votes !== s.votes;
      const ratingChanged = (fresh.fixed && fresh.fixed.ratingCount) !== (s.fixed && s.fixed.ratingCount);
      if (statusChanged || updatesChanged || votesChanged || ratingChanged) {
        const oldStatus = s.status;
        s = fresh;
        renderPage();
        if (statusChanged && oldStatus) {
          SB.toast(`🟢 Live Update: Corporator changed status to "${statusLabel(s.status)}"`);
        }
      }
    } catch {}
  }

  if (SB.onLive) {
    SB.onLive((ev) => {
      if (ev && ev.code === s.code) syncSuggestionLive();
    });
  }
  setInterval(syncSuggestionLive, 10000);
})();
