(async function () {
  'use strict';
  const { el, api, t } = SB;
  const kpis = document.getElementById('kpis');

  function kpi(value, label, note, tone) {
    return el('div', { class: tone ? `kpi kpi-${tone}` : 'kpi' },
      el('p', { class: 'kpi-value' }, value),
      el('p', { class: 'kpi-label' }, label),
      note && el('p', { class: 'kpi-note' }, note));
  }

  // Horizontal bars: one row per item, each bar sized against the largest value.
  function bars(target, rows, colourClass) {
    const max = Math.max(1, ...rows.map((row) => row.n));
    target.replaceChildren(...(rows.length ? rows.map((row) => {
      const fill = el('span', { class: `bar-fill ${colourClass ? colourClass(row) : ''}` });
      fill.style.width = `${(row.n / max) * 100}%`;
      return el('div', { class: 'bar-row' },
        el('span', { class: 'bar-label' }, row.label),
        el('span', { class: 'bar-track' }, fill),
        el('span', { class: 'bar-value' }, row.n));
    }) : [el('p', { class: 'hint' }, t('dash.noData'))]));
  }

  try {
    const [meta, stats] = await Promise.all([SB.meta(), api('/api/stats')]);
    const answers = stats.fixed.yes + stats.fixed.no;

    kpis.replaceChildren(
      kpi(stats.total, t('dash.kpi.received')),
      kpi(`${stats.responseRate}%`, t('dash.kpi.acted'), t('dash.kpi.actedNote', { a: stats.responded, b: stats.total })),
      kpi(stats.avgResponseDays == null ? '–' : stats.avgResponseDays, t('dash.kpi.days'), t('dash.kpi.daysNote')),
      kpi(stats.byStatus.implemented, t('dash.kpi.implemented')),
      kpi(stats.overdue, t('dash.kpi.overdue', { days: stats.overdueDays }), null, stats.overdue ? 'warn' : null),
      kpi(stats.fixed.rate == null ? '–' : `${stats.fixed.rate}%`, t('dash.kpi.fixed'), SB.tn('count.response', answers)),
      kpi(stats.votes, t('dash.kpi.votes'), SB.tn('count.comment', stats.comments)));

    bars(document.getElementById('chart-status'),
      meta.statuses.map((status) => ({ id: status.id, label: status.label, n: stats.byStatus[status.id] || 0 })),
      (row) => `fill-${row.id}`);

    bars(document.getElementById('chart-category'),
      stats.byCategory.map((row) => {
        const category = SB.category(row.id, meta);
        return { label: `${category.icon} ${category.label}`, n: row.n };
      }));

    bars(document.getElementById('chart-department'),
      stats.byDepartment.map((row) => ({ label: SB.departmentLabel(row.id, meta), n: row.n })));

    bars(document.getElementById('chart-district'), stats.byDistrict.map((row) => ({ label: SB.districtLabel(row.id, meta), n: row.n })));

    const max = Math.max(1, ...stats.monthly.map((month) => month.n));
    document.getElementById('chart-monthly').replaceChildren(...stats.monthly.map((month) => {
      const column = el('span', { class: 'column-fill' });
      column.style.height = `${(month.n / max) * 100}%`;
      const label = new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString(SB.locale, { month: 'short', timeZone: 'UTC' });
      return el('div', { class: 'column' },
        el('span', { class: 'column-value' }, month.n),
        el('span', { class: 'column-track' }, column),
        el('span', { class: 'column-label' }, label));
    }));
  } catch (error) {
    kpis.replaceChildren(SB.empty(t('dash.error'), error.message));
  }
})();
