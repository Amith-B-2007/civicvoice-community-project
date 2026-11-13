(async function () {
  'use strict';
  const { el, api, t } = SB;

  const form = document.getElementById('filters');
  const fields = form.elements;
  const results = document.getElementById('results');
  const count = document.getElementById('result-count');
  const more = document.getElementById('load-more');
  const sortButtons = [...document.querySelectorAll('.sort-tabs button')];
  const FILTERS = ['search', 'category', 'district', 'status', 'type'];

  let meta;
  try {
    meta = await SB.meta();
  } catch (error) {
    results.replaceChildren(SB.empty(t('common.loadError'), error.message));
    return;
  }

  SB.fillSelect(fields.category, meta.categories.map((c) => ({ value: c.id, label: c.label })), t('browse.allCategories'));
  SB.fillSelect(fields.district, meta.districts.map((d) => ({ value: d.id, label: d.label })), t('browse.allDistricts'));
  SB.fillSelect(fields.status, meta.statuses.map((s) => ({ value: s.id, label: s.label })), t('browse.anyStatus'));
  SB.fillSelect(fields.type, meta.types.map((type) => ({ value: type.id, label: type.label })), t('browse.allTypes'));

  // The address bar holds the current filters, so a filtered view can be shared as a link.
  const params = new URLSearchParams(location.search);
  const state = { sort: params.get('sort') || 'top', page: 1 };
  for (const name of FILTERS) {
    state[name] = params.get(name) || '';
    fields[name].value = state[name];
    state[name] = fields[name].value; // an unknown select value falls back to "all"
  }

  const paintFilters = SB.filterToggle(form);

  function query() {
    const q = new URLSearchParams();
    for (const name of FILTERS) if (state[name]) q.set(name, state[name]);
    if (state.sort !== 'top') q.set('sort', state.sort);
    return q;
  }

  let requestId = 0;
  async function load({ append = false } = {}) {
    const id = ++requestId;
    if (!append) state.page = 1;
    const q = query();
    history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
    q.set('sort', state.sort);
    q.set('page', state.page);
    paintFilters();
    for (const button of sortButtons) button.setAttribute('aria-pressed', String(button.dataset.sort === state.sort));

    try {
      const data = await api(`/api/suggestions?${q}`);
      if (id !== requestId) return; // a newer search has replaced this one
      const cards = data.items.map((item) => SB.card(item, meta));
      if (append) results.append(...cards);
      else results.replaceChildren(...cards);
      count.textContent = SB.tn('count.result', data.total);
      more.hidden = data.page >= data.pages;
      if (!data.total) {
        results.replaceChildren(SB.empty(t('browse.none.t'), t('browse.none.d'),
          el('a', { class: 'btn btn-primary', href: '/submit' }, t('nav.submit'))));
      }
    } catch (error) {
      if (id !== requestId) return;
      results.replaceChildren(SB.empty(t('common.loadError'), error.message));
      more.hidden = true;
    }
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', () => {
    for (const name of FILTERS) state[name] = fields[name].value.trim();
    load();
  });
  fields.search.addEventListener('input', SB.debounce(() => {
    state.search = fields.search.value.trim();
    load();
  }, 300));
  for (const button of sortButtons) {
    button.addEventListener('click', () => {
      state.sort = button.dataset.sort;
      load();
    });
  }
  more.addEventListener('click', () => {
    state.page += 1;
    load({ append: true });
  });

  load();
})();
