// Officials' panel: sign-in, tabs, the submissions list and the "Manage" dialog.
// Polls, notices and officer accounts are in admin-extra.js and plug in through SB.admin.
(function () {
  'use strict';
  const { el, api } = SB;

  const loginView = document.getElementById('login-view');
  const panelView = document.getElementById('panel-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const filters = document.getElementById('admin-filters');
  const fields = filters.elements;
  const rows = document.getElementById('admin-rows');
  const more = document.getElementById('admin-more');
  const manage = document.getElementById('manage');
  const manageBody = document.getElementById('manage-body');
  const passwordDialog = document.getElementById('password-dialog');
  const passwordForm = document.getElementById('password-form');
  const tabButtons = [...document.querySelectorAll('#admin-tabs [data-tab]')];

  const REASONS = {
    spam: 'Spam or advertising',
    abuse: 'Abusive or hateful',
    personal: 'Personal details',
    false: 'False or misleading',
    other: 'Something else',
  };

  let meta;
  let me;
  let page = 1;

  async function showLogin() {
    panelView.hidden = true;
    loginView.hidden = false;
    if (SB.openRoleGate) SB.openRoleGate(false);
    try {
      meta = meta || await SB.meta();
      const loginDist = document.getElementById('login-district');
      if (loginDist && !loginDist.options.length) {
        SB.fillSelect(loginDist, meta.districts.map((d) => ({ value: d.id, label: `${d.label} (${d.id})` })), 'Select district corporation (or leave blank for head admin)');
        loginDist.addEventListener('change', () => {
          const hint = document.getElementById('login-district-hint');
          if (loginDist.value) {
            loginForm.elements.username.value = loginDist.value;
            if (hint) {
              hint.textContent = `District User ID: ${loginDist.value}`;
              hint.hidden = false;
            }
            loginForm.elements.password.focus();
          } else if (hint) {
            hint.hidden = true;
          }
        });
      }
    } catch {}
  }

  // Any call can discover the session has expired; send the user back to the login form.
  async function adminApi(path, options) {
    try {
      return await api(path, options);
    } catch (error) {
      if (error.status === 401 && !path.endsWith('/login')) {
        if (manage.open) manage.close();
        showLogin();
      }
      throw error;
    }
  }

  const fail = (error) => {
    if (error.status !== 401) SB.toast(error.message, 'error');
  };

  // Shared with admin-extra.js. `tabs` maps a tab name to the function that loads it.
  const admin = (SB.admin = { api: adminApi, fail, tabs: {}, get meta() { return meta; }, get me() { return me; } });

  // ---------- Sign in / out ----------

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    try {
      const district = loginForm.elements.district ? loginForm.elements.district.value : '';
      await adminApi('/api/admin/login', {
        method: 'POST',
        body: {
          district: district || undefined,
          username: loginForm.elements.username.value,
          password: loginForm.elements.password.value,
        },
      });
      loginForm.reset();
      const hint = document.getElementById('login-district-hint');
      if (hint) hint.hidden = true;
      await showPanel();
    } catch (error) {
      loginError.textContent = error.message;
      loginError.hidden = false;
    }
  });

  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: {} }).catch(() => {});
    try { sessionStorage.removeItem('sb_role'); } catch {}
    showLogin();
  });

  // ---------- Panel and tabs ----------

  function selectTab(name) {
    for (const button of tabButtons) {
      const active = button.dataset.tab === name;
      button.setAttribute('aria-selected', String(active));
      document.getElementById(`tab-${button.dataset.tab}`).hidden = !active;
    }
    if (admin.tabs[name]) admin.tabs[name]();
  }
  for (const button of tabButtons) button.addEventListener('click', () => selectTab(button.dataset.tab));

  async function showPanel() {
    [meta, me] = await Promise.all([SB.meta(), api('/api/admin/me')]);
    try { sessionStorage.setItem('sb_role', 'corporation'); } catch {}
    if (SB.updateCorpHeader) SB.updateCorpHeader(true);
    const head = me.role === 'admin';
    const isDistrictCorp = Boolean(me.district && !me.department);
    const distLabel = me.district ? SB.districtLabel(me.district, meta) : '';
    const headingNode = document.getElementById('admin-heading');
    if (headingNode) {
      headingNode.textContent = isDistrictCorp ? `${distLabel} Corporation` : 'Council office';
    }
    document.getElementById('admin-name').textContent = me.name;
    document.getElementById('admin-role').textContent = head
      ? 'Administrator (all districts & departments)'
      : isDistrictCorp
        ? `District Corporation Profile · ${distLabel} District (All Categories)`
        : `Officer, ${SB.departmentLabel(me.department, meta)}${me.district ? `, ${distLabel} district` : ''}`;
    for (const button of tabButtons) button.hidden = 'head' in button.dataset && !head;
    document.getElementById('a-department-field').hidden = Boolean(me.department);
    document.getElementById('a-district-field').hidden = Boolean(me.district);
    SB.fillSelect(fields.district, meta.districts.map((d) => ({ value: d.id, label: d.label })), 'All districts');

    SB.fillSelect(fields.status, meta.statuses.map((s) => ({ value: s.id, label: s.label })), 'Any status');
    SB.fillSelect(fields.department, meta.departments.map((d) => ({ value: d.id, label: d.label })), 'All departments');
    loginView.hidden = true;
    panelView.hidden = false;
    selectTab('submissions');
  }

  // ---------- Submissions list ----------

  function flags(s) {
    return [
      s.fixed && s.fixed.ratingCount > 0 && el('span', { class: 'badge badge-rating' }, `★ ${Number(s.fixed.ratingAvg).toFixed(1)} (${s.fixed.ratingCount})`),
      s.overdue && el('span', { class: 'badge badge-warn' }, 'Overdue'),
      s.disputed && el('span', { class: 'badge badge-warn' }, 'Residents say not fixed'),
      s.reports > 0 && el('span', { class: 'badge badge-hidden' }, `Reported (${s.reports})`),
      s.hidden && el('span', { class: 'badge badge-hidden' }, 'Hidden'),
    ];
  }

  function rowNode(s) {
    const category = SB.category(s.category, meta);
    return el('tr', { class: s.hidden ? 'row-hidden' : '' },
      el('td', null, el('span', { class: 'code' }, s.code)),
      el('td', null,
        el('button', { type: 'button', class: 'row-title', onclick: () => openManage(s.code) }, s.title),
        el('span', { class: 'row-sub' },
          `${meta.typeById[s.type].label} · ${category.label} · ${SB.departmentLabel(s.department, meta) || 'No department'}`),
        el('span', { class: 'badges row-flags' }, flags(s)),
        s.status === 'implemented' && SB.rateWorkWidget && SB.rateWorkWidget(s, { compact: true, onRate: () => load() })),
      el('td', null, SB.place(s, meta)),
      el('td', { class: 'num' }, s.votes),
      el('td', null, SB.statusBadge(s.status, meta)),
      el('td', { class: 'nowrap col-date' }, SB.formatDate(s.createdAt)),
      el('td', null, el('button', { type: 'button', class: 'btn btn-sm', onclick: () => openManage(s.code) }, 'Manage')));
  }

  let requestId = 0;
  async function load({ append = false } = {}) {
    const id = ++requestId;
    if (!append) page = 1;
    const q = new URLSearchParams({ limit: 20, page, sort: fields.sort.value });
    for (const name of ['search', 'status', 'department', 'district', 'attention']) {
      if (fields[name].value.trim()) q.set(name, fields[name].value.trim());
    }
    let data;
    try {
      data = await adminApi(`/api/admin/suggestions?${q}`);
    } catch (error) {
      return fail(error);
    }
    if (id !== requestId) return;

    const nodes = data.items.map(rowNode);
    if (append) rows.append(...nodes);
    else rows.replaceChildren(...nodes);
    if (!data.total) {
      rows.replaceChildren(el('tr', null, el('td', { colspan: '7', class: 'table-empty' }, 'Nothing matches those filters.')));
    }
    document.getElementById('admin-count').textContent = `${data.total} submission${data.total === 1 ? '' : 's'}`;
    more.hidden = data.page >= data.pages;

    const kpi = (value, label, attention) => {
      const tile = el('button', { type: 'button', class: value && attention ? 'kpi kpi-warn' : 'kpi' },
        el('span', { class: 'kpi-value' }, value), el('span', { class: 'kpi-label' }, label));
      tile.addEventListener('click', () => {
        fields.attention.value = attention || '';
        fields.status.value = attention === undefined ? 'submitted' : '';
        load();
      });
      return tile;
    };
    const sum = data.summary;
    const byStatus = sum.byStatus || {};
    const statusTabs = document.getElementById('status-tabs');
    if (statusTabs) {
      const statusItems = [
        { id: '', label: `All (${sum.total || 0})` },
        ...meta.statuses.map((s) => ({ id: s.id, label: `${s.label} (${byStatus[s.id] || 0})` })),
      ];
      statusTabs.replaceChildren(...statusItems.map((item) => {
        const btn = el('button', {
          type: 'button',
          'aria-pressed': String(fields.status.value === item.id && !fields.attention.value),
          onclick: () => {
            fields.attention.value = '';
            fields.status.value = item.id;
            load();
          },
        }, item.label);
        return btn;
      }));
    }

    document.getElementById('admin-kpis').replaceChildren(
      kpi(sum.awaiting, 'waiting for first review'),
      kpi(sum.overdue, `overdue (over ${sum.overdueDays} days)`, 'overdue'),
      kpi(sum.reported, 'reported by residents', 'reported'),
      kpi(sum.disputed, 'marked done, residents disagree', 'disputed'),
      kpi(sum.active, 'being worked on', ''),
      kpi(sum.ratingAvg ? `${Number(sum.ratingAvg).toFixed(1)} ★` : '–', `avg quality rating (${sum.ratingCount || 0})`, ''),
      kpi(sum.total, 'public submissions', ''));
  }
  admin.tabs.submissions = () => load();

  filters.addEventListener('submit', (event) => event.preventDefault());
  filters.addEventListener('change', () => load());
  fields.search.addEventListener('input', SB.debounce(() => load(), 300));
  more.addEventListener('click', () => {
    page += 1;
    load({ append: true });
  });

  // ---------- Manage one submission ----------

  async function openManage(code) {
    try {
      renderManage(await adminApi(`/api/admin/suggestions/${code}`));
      if (!manage.open) manage.showModal();
    } catch (error) {
      fail(error);
    }
  }

  function renderManage(s) {
    const category = SB.category(s.category, meta);
    document.getElementById('manage-title').textContent = s.title;
    const patch = (body) => adminApi(`/api/admin/suggestions/${s.code}`, { method: 'PATCH', body });
    const refresh = (updated) => {
      if (updated.moved) {
        manage.close();
        SB.toast('Passed to the other department.');
      } else {
        renderManage(updated);
      }
      load();
    };

    // --- Respond: status, public reply, optional photo of the work ---
    const status = el('select', { id: 'm-status' },
      meta.statuses.map((item) => el('option', { value: item.id, selected: item.id === s.status }, item.label)));
    const note = el('textarea', {
      id: 'm-note', rows: '4', maxlength: '1000',
      placeholder: 'Explain what the corporation is doing, or why something is not possible.',
    });
    const photo = el('input', { id: 'm-photo', type: 'file', accept: 'image/*' });
    const previewImg = el('img', { alt: 'Completed work photo preview' });
    const removePhotoBtn = el('button', {
      type: 'button', class: 'btn btn-sm',
      onclick: () => {
        photo.value = '';
        previewBox.hidden = true;
      },
    }, 'Remove photo');
    const previewBox = el('div', { class: 'photo-preview', hidden: true }, previewImg, removePhotoBtn);
    photo.addEventListener('change', async () => {
      const file = photo.files[0];
      if (!file) {
        previewBox.hidden = true;
        return;
      }
      try {
        previewImg.src = await SB.shrinkImage(file);
        previewBox.hidden = false;
        if (status.value === s.status && s.status !== 'implemented') {
          status.value = 'implemented';
          status.dispatchEvent(new Event('change'));
        }
      } catch (err) {
        photo.value = '';
        previewBox.hidden = true;
        formError.textContent = err.message;
        formError.hidden = false;
      }
    });
    const formError = el('p', { class: 'error', hidden: true });
    const save = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Publish update');

    // Interactive 5-Star Corporator Rating picker inside the completion form (shown when status is "implemented")
    let selectedRating = (s.fixed && s.fixed.myRating) || 0;
    const formStarBtns = [1, 2, 3, 4, 5].map((stars) => el('button', {
      type: 'button',
      class: 'star-btn',
      title: `${stars} star${stars > 1 ? 's' : ''}`,
      onclick: async () => {
        selectedRating = stars;
        paintFormStars();
        if (s.status === 'implemented') {
          try {
            s.fixed = await api(`/api/suggestions/${encodeURIComponent(s.code)}/rate`, {
              method: 'POST',
              body: { rating: stars },
            });
            SB.toast(`Rated Corporator work ${stars} ★!`);
            renderManage(await adminApi(`/api/admin/suggestions/${s.code}`));
            load();
          } catch (err) {
            fail(err);
          }
        }
      },
    }, '★'));
    const formRatingHint = el('p', { class: 'rating-summary' });
    function paintFormStars() {
      formStarBtns.forEach((btn, idx) => {
        btn.classList.toggle('star-active', idx < selectedRating);
        btn.setAttribute('aria-pressed', String(idx + 1 === selectedRating));
      });
      if (s.fixed && s.fixed.ratingCount > 0 && s.fixed.ratingAvg != null) {
        formRatingHint.textContent = `Current rating: ★ ${Number(s.fixed.ratingAvg).toFixed(1)} / 5 (${s.fixed.ratingCount} rating${s.fixed.ratingCount === 1 ? '' : 's'})`;
        formRatingHint.hidden = false;
      } else if (selectedRating > 0) {
        formRatingHint.textContent = `Selected: ${selectedRating} ★ (will be saved with update)`;
        formRatingHint.hidden = false;
      } else {
        formRatingHint.textContent = 'Click 1 to 5 stars to rate the completed work.';
        formRatingHint.hidden = false;
      }
    }
    paintFormStars();

    const formRatingField = el('div', { class: 'field rating-box', hidden: status.value !== 'implemented' },
      el('label', { class: 'rating-label' }, '⭐ Rate Corporator after Work is Completed (1 to 5 Stars):'),
      el('div', { class: 'star-group', role: 'group', 'aria-label': '5-star Corporator rating' }, formStarBtns),
      formRatingHint);

    status.addEventListener('change', () => {
      formRatingField.hidden = status.value !== 'implemented';
    });

    const form = el('form', { class: 'manage-form', novalidate: true },
      el('h3', null, 'Update Status & Upload Completion Photo'),
      el('div', { class: 'field' }, el('label', { for: 'm-status' }, 'Problem Status (Submitted / Under review / Planned / In progress / Implemented / Not feasible)'), status),
      el('div', { class: 'field' },
        el('label', { for: 'm-note' }, 'Public reply ', el('span', { class: 'optional' }, 'optional')),
        note,
        el('p', { class: 'hint' }, 'Shown to everyone on the submission page.')),
      el('div', { class: 'field' },
        el('label', { for: 'm-photo' }, 'Upload photo after problem is completed ', el('span', { class: 'optional' }, 'optional')),
        photo,
        el('p', { class: 'hint' }, 'Attach a photo once the work is completed ("Implemented") to show residents the completed result.')),
      previewBox,
      formRatingField,
      formError,
      el('div', { class: 'form-actions' }, save));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      formError.hidden = true;
      if (status.value === s.status && !note.value.trim() && !photo.files[0] && !selectedRating) {
        formError.textContent = 'Change the status, write a reply, add a photo, or select a star rating first.';
        formError.hidden = false;
        return;
      }
      save.disabled = true;
      try {
        const image = photo.files[0] ? await SB.shrinkImage(photo.files[0]) : undefined;
        const updated = await patch({
          status: status.value,
          note: note.value,
          photo: image,
          rating: status.value === 'implemented' && selectedRating ? selectedRating : undefined,
        });
        if (SB.emitLive) {
          const stObj = meta.statusById[status.value] || { label: status.value };
          SB.emitLive({ type: 'status', code: s.code, status: status.value, statusLabel: stObj.label, title: s.title });
        }
        SB.toast('Update published.');
        refresh(updated);
      } catch (error) {
        formError.textContent = (error.fields && Object.values(error.fields)[0]) || error.message;
        formError.hidden = false;
        save.disabled = false;
      }
    });

    // --- Department ---
    const department = el('select', { id: 'm-department' },
      !s.department && el('option', { value: '' }, 'Not assigned'),
      meta.departments.map((item) => el('option', { value: item.id, selected: item.id === s.department }, item.label)));
    department.addEventListener('change', async () => {
      if (!department.value) return;
      department.disabled = true;
      try {
        refresh(await patch({ department: department.value }));
      } catch (error) {
        department.disabled = false;
        fail(error);
      }
    });

    // --- Moderation ---
    const hide = el('button', { type: 'button', class: s.hidden ? 'btn btn-sm' : 'btn btn-sm btn-danger' },
      s.hidden ? 'Show on public board again' : 'Hide from public board');
    hide.addEventListener('click', async () => {
      hide.disabled = true;
      try {
        refresh(await patch({ hidden: !s.hidden }));
      } catch (error) {
        hide.disabled = false;
        fail(error);
      }
    });

    const dismiss = el('button', { type: 'button', class: 'btn btn-sm' }, 'Dismiss reports');
    dismiss.addEventListener('click', async () => {
      dismiss.disabled = true;
      try {
        refresh(await patch({ clearReports: true }));
      } catch (error) {
        dismiss.disabled = false;
        fail(error);
      }
    });

    const comments = el('ul', { class: 'manage-comments' }, s.thread.map((comment) => {
      const remove = el('button', { type: 'button', class: 'btn btn-sm btn-danger' }, 'Delete');
      const item = el('li', null,
        el('div', null,
          el('p', { class: 'comment-head' },
            el('strong', null, comment.author || 'A resident'),
            el('span', null, SB.formatDate(comment.createdAt)),
            comment.reports > 0 && el('span', { class: 'badge badge-hidden' }, `Reported (${comment.reports})`)),
          el('p', { class: 'prose' }, comment.body)),
        remove);
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this comment permanently?')) return;
        remove.disabled = true;
        try {
          await adminApi(`/api/admin/comments/${comment.id}`, { method: 'DELETE' });
          item.remove();
          load();
        } catch (error) {
          remove.disabled = false;
          fail(error);
        }
      });
      return item;
    }));

    const fact = (label, ...value) => el('div', null, el('dt', null, label), el('dd', null, value));
    const pinned = s.lat != null && s.lng != null;
    const answers = s.fixed.yes + s.fixed.no;

    SB.fill(manageBody,
      el('div', { class: 'badges' },
        SB.typeBadge(s.type, meta), SB.statusBadge(s.status, meta), el('span', { class: 'code' }, s.code), flags(s)),
      el('dl', { class: 'facts' },
        fact('Category', `${category.icon} ${category.label}`),
        fact('Department', department),
        fact('Place', [s.location, s.ward && SB.ward(s.ward), SB.place(s, meta)].filter(Boolean).join(', ')),
        fact('Exact location', pinned
          ? [el('span', { class: 'code' }, SB.maps.coords(s.lat, s.lng)), ' ',
            el('a', { href: SB.maps.directionsLink(s.lat, s.lng), target: '_blank', rel: 'noopener noreferrer' }, 'Directions')]
          : 'No pin'),
        fact('Submitted by', s.author || 'Anonymous'),
        fact('Contact (private)', s.contact || 'Not given'),
        fact('Received', SB.formatDate(s.createdAt)),
        fact('Support', `${s.votes} vote${s.votes === 1 ? '' : 's'}, ${s.thread.length} comment${s.thread.length === 1 ? '' : 's'}`),
        s.status === 'implemented' && fact('Residents on the result',
          answers ? `${s.fixed.yes} say fixed, ${s.fixed.no} say not fixed` : 'No answers yet'),
        s.status === 'implemented' && fact('5-Star quality rating',
          s.fixed && s.fixed.ratingCount ? `★ ${Number(s.fixed.ratingAvg).toFixed(1)} / 5 (${s.fixed.ratingCount} rating${s.fixed.ratingCount === 1 ? '' : 's'})` : 'No ratings yet')),
      el('p', { class: 'prose' }, s.description),
      s.photo && el('div', { class: 'photo-preview' },
        el('a', { href: s.photo, target: '_blank', rel: 'noopener' },
          el('img', { class: 'detail-photo', src: s.photo, alt: 'Photo attached to this submission' })),
        el('button', {
          type: 'button',
          class: 'btn btn-sm btn-danger',
          onclick: async (event) => {
            if (!window.confirm('Delete this uploaded photo permanently?')) return;
            const btn = event.currentTarget;
            btn.disabled = true;
            try {
              const updated = await adminApi(`/api/admin/suggestions/${s.code}/photo`, { method: 'DELETE' });
              SB.toast('Photo deleted.');
              refresh(updated);
            } catch (error) {
              btn.disabled = false;
              fail(error);
            }
          },
        }, 'Delete photo')),
      s.reportList.length > 0 && el('div', { class: 'report-box' },
        el('h3', null, `Reports from residents (${s.reportList.length})`),
        el('ul', null, s.reportList.map((report) => el('li', null,
          `${REASONS[report.reason] || report.reason}${report.commentId ? ' (about a comment)' : ''}, ${SB.formatDate(report.createdAt)}`))),
        el('p', { class: 'hint' }, 'Hide the submission or delete the comment if the report is right, then dismiss.'),
        dismiss),
      s.updates.length > 0 && el('div', null,
        el('h3', null, 'Updates published so far'),
        el('ol', { class: 'timeline' }, s.updates.map((update) => el('li', null,
          el('p', { class: 'timeline-head' },
            el('strong', null, meta.statusById[update.status].label),
            el('span', null, `${update.byName ? `${update.byName}, ` : ''}${SB.formatDate(update.createdAt)}`)),
          update.note && el('p', { class: 'prose timeline-note' }, update.note),
          update.photo && el('div', { class: 'photo-preview' },
            el('a', { href: update.photo, target: '_blank', rel: 'noopener' },
              el('img', { class: 'timeline-photo', src: update.photo, alt: 'Photo added by the council' })),
            el('button', {
              type: 'button',
              class: 'btn btn-sm btn-danger',
              onclick: async (event) => {
                if (!window.confirm('Delete this uploaded completion photo permanently?')) return;
                const btn = event.currentTarget;
                btn.disabled = true;
                try {
                  const updated = await adminApi(`/api/admin/updates/${update.id}/photo`, { method: 'DELETE' });
                  SB.toast('Photo deleted.');
                  refresh(updated);
                } catch (error) {
                  btn.disabled = false;
                  fail(error);
                }
              },
            }, 'Delete photo')))))),
      form,
      s.thread.length > 0 && el('div', null, el('h3', null, 'Comments'), comments),
      el('div', { class: 'manage-foot' },
        el('a', { class: 'btn btn-sm', href: SB.link(s.code), target: '_blank', rel: 'noopener' }, 'Open public page'),
        hide));
    manageBody.scrollTop = 0;
  }

  // ---------- Dialogs ----------

  for (const dialog of [manage, passwordDialog]) {
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) dialog.close();
    });
  }

  // One dialog serves two jobs: changing your own password, and (admin) resetting an officer's.
  let resetFor = null;
  function openPassword(officer) {
    resetFor = officer || null;
    passwordForm.reset();
    SB.showFieldErrors(passwordForm, null);
    document.getElementById('password-title').textContent = officer ? 'Reset officer password' : 'Change password';
    document.getElementById('pw-current-field').hidden = Boolean(officer);
    const note = document.getElementById('password-for');
    note.hidden = !officer;
    note.textContent = officer ? `New password for ${officer.name || officer.username}. They will be signed out everywhere.` : '';
    passwordDialog.showModal();
  }
  admin.resetPassword = openPassword;
  document.getElementById('open-password').addEventListener('click', () => openPassword());

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = document.getElementById('pw-current').value;
    const next = document.getElementById('pw-next').value;
    if (next !== document.getElementById('pw-confirm').value) {
      SB.showFieldErrors(passwordForm, { confirm: 'The two new passwords do not match.' });
      return;
    }
    try {
      if (resetFor) {
        await adminApi(`/api/admin/officers/${resetFor.id}/password`, { method: 'POST', body: { password: next } });
      } else {
        await adminApi('/api/admin/password', { method: 'POST', body: { current, next } });
      }
      passwordDialog.close();
      SB.toast('Password saved.');
    } catch (error) {
      const fieldErrors = error.fields && { ...error.fields, next: error.fields.next || error.fields.password };
      SB.showFieldErrors(passwordForm, fieldErrors);
      if (!error.fields) fail(error);
    }
  });

  // ---------- Start ----------

  showPanel().catch(showLogin);
})();
