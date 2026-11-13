(async function () {
  'use strict';
  const { el, api, t } = SB;

  const form = document.getElementById('map-filters');
  const fields = form.elements;
  const count = document.getElementById('map-count');

  let meta;
  try {
    meta = await SB.meta();
  } catch (error) {
    count.textContent = error.message;
    return;
  }

  SB.fillSelect(fields.district, meta.districts.map((d) => ({ value: d.id, label: d.label })), t('browse.allDistricts'));
  SB.fillSelect(fields.category, meta.categories.map((c) => ({ value: c.id, label: c.label })), t('browse.allCategories'));
  SB.fillSelect(fields.status, meta.statuses.map((s) => ({ value: s.id, label: s.label })), t('browse.anyStatus'));
  SB.fillSelect(fields.type, meta.types.map((type) => ({ value: type.id, label: type.label })), t('browse.allTypes'));

  document.getElementById('map-legend').replaceChildren(...meta.statuses.map((status) =>
    el('li', null, el('span', { class: `legend-dot fill-${status.id}`, 'aria-hidden': 'true' }), status.label)));

  const paintFilters = SB.filterToggle(form);
  const map = SB.maps.create('big-map', meta);
  const pins = L.layerGroup().addTo(map);

  function popup(item) {
    const category = SB.category(item.category, meta);
    return el('div', { class: 'map-popup' },
      el('div', { class: 'badges' }, SB.typeBadge(item.type, meta), SB.statusBadge(item.status, meta)),
      el('p', { class: 'map-popup-title' }, item.title),
      el('p', { class: 'meta' },
        el('span', null, `${category.icon} ${category.label}`),
        el('span', null, SB.place(item, meta)),
        el('span', null, SB.tn('count.supporter', item.votes))),
      el('a', { href: SB.link(item.code) }, t('map.view')));
  }

  let first = true;
  let lastDistrict = '';
  async function load() {
    const query = new URLSearchParams();
    paintFilters();
    for (const name of ['district', 'category', 'status', 'type']) if (fields[name].value) query.set(name, fields[name].value);
    try {
      const { items } = await api(`/api/map?${query}`);
      pins.clearLayers();
      for (const item of items) {
        L.marker([item.lat, item.lng], { icon: SB.maps.pinIcon(item.status), title: item.title, alt: item.title })
          .bindPopup(() => popup(item), { minWidth: 220, maxWidth: 280 })
          .addTo(pins);
      }
      count.textContent = items.length ? SB.tn('count.pin', items.length) : t('map.none');
      // Frame the pins on the first load and whenever the district changes; otherwise keep the person's view.
      const district = meta.districtById[fields.district.value];
      if ((first || fields.district.value !== lastDistrict) && items.length) {
        map.fitBounds(L.latLngBounds(items.map((item) => [item.lat, item.lng])).pad(0.15), { maxZoom: 14 });
      } else if (fields.district.value !== lastDistrict) {
        if (district) map.setView(district.center, 10);
        else map.setView(meta.map.center, meta.map.zoom);
      }
      lastDistrict = fields.district.value;
      first = false;
    } catch (error) {
      count.textContent = `${t('map.error')} ${error.message}`;
    }
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', load);
  load();
})();
