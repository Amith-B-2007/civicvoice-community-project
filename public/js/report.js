// Printable monthly report for council meetings (officials only).
(async function () {
  'use strict';
  const { el, api } = SB;
  const box = document.getElementById('report');
  const monthInput = document.getElementById('report-month');

  let meta;
  let me;
  try {
    [meta, me] = await Promise.all([SB.meta(), api('/api/admin/me')]);
  } catch (error) {
    box.replaceChildren(SB.empty('Sign in to see the report', 'This page is for council officials.',
      el('a', { class: 'btn btn-primary', href: '/admin' }, 'Official login')));
    return;
  }

  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  monthInput.value = thisMonth;
  monthInput.max = thisMonth;

  const kpi = (value, label) => el('div', { class: 'kpi' },
    el('p', { class: 'kpi-value' }, value), el('p', { class: 'kpi-label' }, label));

  function table(title, headers, rows, emptyText) {
    return el('section', { class: 'report-block' },
      el('h3', null, title),
      rows.length
        ? el('table', { class: 'table table-compact' },
          el('thead', null, el('tr', null, headers.map((header) => el('th', { scope: 'col', class: header.num ? 'num' : '' }, header.label)))),
          el('tbody', null, rows.map((row) => el('tr', null, row.map((cell, index) => el('td', { class: headers[index].num ? 'num' : '' }, cell))))))
        : el('p', { class: 'hint' }, emptyText || 'Nothing to show.'));
  }

  const count = (title, rows, label) => table(title,
    [{ label: title.replace(/^By /, '').replace(/^\w/, (c) => c.toUpperCase()) }, { label: 'Received', num: true }],
    rows.map((row) => [label(row.id), row.n]));

  function render(report) {
    const monthName = new Date(`${report.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const now = report.now;
    const days = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    const statusLabel = (id) => (meta.statusById[id] ? meta.statusById[id].label : id);
    const answers = now.fixed.yes + now.fixed.no;

    box.replaceChildren(
      el('header', { class: 'report-head' },
        el('p', { class: 'eyebrow eyebrow-plain' }, meta.region),
        el('h2', null, `Suggestion box report: ${monthName}`),
        el('p', { class: 'hint' },
          `${me.department ? SB.departmentLabel(me.department, meta) : 'All departments'}${me.district ? `, ${SB.districtLabel(me.district, meta)} district` : ''} · prepared on ${SB.formatDate(new Date().toISOString())}`)),

      el('div', { class: 'kpi-grid' },
        kpi(report.received, 'received this month'),
        kpi(report.actedOn, 'acted on this month'),
        kpi(report.implemented, 'implemented this month'),
        kpi(report.notFeasible, 'marked not feasible'),
        kpi(report.avgResponseDays == null ? '–' : Math.round(report.avgResponseDays * 10) / 10, 'days to first response')),

      el('div', { class: 'report-grid' },
        count('By category', report.byCategory, (id) => SB.category(id, meta).label),
        count('By district', report.byDistrict, (id) => SB.districtLabel(id, meta)),
        !me.department && count('By department', report.byDepartment, (id) => SB.departmentLabel(id, meta)),
        count('By type', report.byType, (id) => (meta.typeById[id] ? meta.typeById[id].label : id))),

      table('Most supported submissions received this month',
        [{ label: 'Code' }, { label: 'Title' }, { label: 'Place' }, { label: 'Status' }, { label: 'Votes', num: true }],
        report.top.map((row) => [row.code, row.title, SB.place(row, meta), statusLabel(row.status), row.votes]),
        'No submissions were received this month.'),

      table(`Waiting more than ${now.overdueDays} days for a first response`,
        [{ label: 'Code' }, { label: 'Title' }, { label: 'Place' }, { label: 'Department' }, { label: 'Days waiting', num: true }],
        report.overdue.map((row) => [row.code, row.title, SB.place(row, meta), SB.departmentLabel(row.department, meta), days(row.createdAt)]),
        'Nothing is overdue.'),

      el('section', { class: 'report-block' },
        el('h3', null, 'Overall position today'),
        el('div', { class: 'report-grid' },
          table('All submissions by status', [{ label: 'Status' }, { label: 'Count', num: true }],
            meta.statuses.map((status) => [status.label, now.byStatus[status.id] || 0])),
          table('Totals', [{ label: 'Measure' }, { label: 'Value', num: true }], [
            ['Submissions on the public board', now.total],
            ['Acted on by the council', `${now.responseRate}%`],
            ['Votes of support', now.votes],
            ['Comments', now.comments],
            ['Residents confirming work was done', answers ? `${now.fixed.rate}% of ${answers}` : 'No answers yet'],
          ]))));
  }

  async function load() {
    try {
      render(await api(`/api/admin/report?month=${encodeURIComponent(monthInput.value || thisMonth)}`));
    } catch (error) {
      box.replaceChildren(SB.empty('Could not load the report', error.message));
    }
  }

  monthInput.addEventListener('change', load);
  document.getElementById('report-print').addEventListener('click', () => window.print());
  load();
})();
