// Officials' panel, head admin only: polls, notices and officer accounts.
(function () {
  'use strict';
  const { el } = SB;
  const admin = SB.admin;

  // Wires a "create" form: sends the body, shows field errors, and reloads the list on success.
  function createForm(formId, path, readBody, onDone, message) {
    const form = document.getElementById(formId);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await admin.api(path, { method: 'POST', body: readBody() });
        form.reset();
        SB.showFieldErrors(form, null);
        SB.toast(message);
        onDone();
      } catch (error) {
        SB.showFieldErrors(form, error.fields);
        if (!error.fields) admin.fail(error);
      } finally {
        button.disabled = false;
      }
    });
  }

  function actionButton(label, className, confirmText, action) {
    const button = el('button', { type: 'button', class: className }, label);
    button.addEventListener('click', async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        button.disabled = false;
        admin.fail(error);
      }
    });
    return button;
  }

  const value = (id) => document.getElementById(id).value;

  // ---------- Polls ----------

  async function loadPolls() {
    const box = document.getElementById('admin-polls');
    const isHead = admin.me && admin.me.role === 'admin';
    const pollForm = document.getElementById('poll-form');
    if (pollForm) pollForm.hidden = !isHead;
    let items;
    try {
      ({ items } = await admin.api('/api/polls'));
    } catch (error) {
      return admin.fail(error);
    }
    box.replaceChildren(...(items.length ? items.map((poll) => {
      const rows = poll.options.map((option) => {
        const share = poll.total ? Math.round((option.votes / poll.total) * 100) : 0;
        const fill = el('span', { class: 'bar-fill' });
        fill.style.width = `${share}%`;
        return el('div', { class: 'poll-result' },
          el('p', { class: 'poll-result-head' }, el('span', null, option.label), el('strong', null, `${share}%`)),
          el('span', { class: 'bar-track' }, fill));
      });
      return el('article', { class: 'panel poll' },
        el('div', { class: 'badges' },
          el('span', { class: poll.open ? 'badge status-implemented' : 'badge' }, poll.open ? 'Open' : 'Closed'),
          poll.closesAt && el('span', { class: 'hint' }, `Closes ${SB.formatDate(poll.closesAt)}`)),
        el('h3', null, poll.question),
        el('div', { class: 'poll-results' }, rows),
        isHead && el('div', { class: 'manage-foot' },
          poll.open
            ? actionButton('Close poll', 'btn btn-sm', null, async () => {
              await admin.api(`/api/admin/polls/${poll.id}`, { method: 'PATCH', body: { closed: true } });
              loadPolls();
            })
            : el('span'),
          actionButton('Delete', 'btn btn-sm btn-danger', 'Delete this poll and all its votes?', async () => {
            await admin.api(`/api/admin/polls/${poll.id}`, { method: 'DELETE' });
            loadPolls();
          })));
    }) : [SB.empty('No polls yet', 'Ask residents a question with the form.')]));
  }
  admin.tabs.polls = loadPolls;

  createForm('poll-form', '/api/admin/polls', () => ({
    question: value('poll-question'),
    description: value('poll-description'),
    options: value('poll-options').split('\n').map((line) => line.trim()).filter(Boolean),
    closesAt: value('poll-closes') || undefined,
  }), loadPolls, 'Poll published.');

  // ---------- Notices ----------

  async function loadNotices() {
    const box = document.getElementById('admin-notices');
    let items;
    try {
      ({ items } = await admin.api('/api/notices'));
    } catch (error) {
      return admin.fail(error);
    }
    box.replaceChildren(...(items.length ? items.map((notice) => el('article', { class: 'panel notice-card' },
      el('p', { class: 'notice-meta' },
        notice.pinned && el('span', { class: 'badge badge-important' }, 'Important'),
        el('span', null, SB.formatDate(notice.createdAt))),
      el('h3', null, notice.title),
      el('p', { class: 'prose' }, notice.body),
      el('div', { class: 'manage-foot' },
        el('span'),
        actionButton('Delete', 'btn btn-sm btn-danger', 'Delete this notice?', async () => {
          await admin.api(`/api/admin/notices/${notice.id}`, { method: 'DELETE' });
          loadNotices();
        }))))
      : [SB.empty('No notices yet', 'Announce meetings, works and schedules with the form.')]));
  }
  admin.tabs.notices = loadNotices;

  createForm('notice-form', '/api/admin/notices', () => ({
    title: value('notice-title'),
    body: value('notice-body'),
    pinned: document.getElementById('notice-pinned').checked,
  }), loadNotices, 'Notice published.');

  // ---------- Officer accounts ----------

  async function loadOfficers() {
    const meta = admin.meta;
    SB.fillSelect(document.getElementById('officer-department'),
      meta.departments.map((department) => ({ value: department.id, label: department.label })), 'Choose a department');
    SB.fillSelect(document.getElementById('officer-district'),
      meta.districts.map((district) => ({ value: district.id, label: district.label })), 'All districts');
    let items;
    try {
      ({ items } = await admin.api('/api/admin/officers'));
    } catch (error) {
      return admin.fail(error);
    }
    document.getElementById('officer-rows').replaceChildren(...items.map((officer) => el('tr', null,
      el('td', null, el('strong', null, officer.name || officer.username)),
      el('td', null, el('span', { class: 'code' }, officer.username)),
      el('td', null, officer.role === 'admin' ? 'All departments (admin)' : (officer.department ? SB.departmentLabel(officer.department, meta) : 'All categories (District Corporation)')),
      el('td', null, officer.district ? SB.districtLabel(officer.district, meta) : 'All districts'),
      el('td', { class: 'row-actions' }, officer.role === 'officer' && [
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => admin.resetPassword(officer) }, 'Reset password'),
        actionButton('Remove', 'btn btn-sm btn-danger', `Remove the account of ${officer.name || officer.username}?`, async () => {
          await admin.api(`/api/admin/officers/${officer.id}`, { method: 'DELETE' });
          loadOfficers();
        }),
      ]))));
  }
  admin.tabs.officers = loadOfficers;

  createForm('officer-form', '/api/admin/officers', () => ({
    name: value('officer-name'),
    username: value('officer-username'),
    department: value('officer-department'),
    district: value('officer-district') || undefined,
    password: value('officer-password'),
  }), loadOfficers, 'Officer account created.');
})();
