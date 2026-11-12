(async function () {
  'use strict';
  const { api, t } = SB;

  const form = document.getElementById('track-form');
  const input = document.getElementById('code');
  const error = document.getElementById('track-error');

  // Accepts "sb-abc234", "SB ABC234" or just "abc234".
  function normalise(value) {
    const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const tail = compact.startsWith('SB') && compact.length > 6 ? compact.slice(2) : compact;
    return `SB-${tail}`;
  }

  async function lookup(raw) {
    const code = normalise(raw);
    error.hidden = true;
    try {
      await api(`/api/suggestions/${encodeURIComponent(code)}`);
      location.href = SB.link(code);
    } catch (err) {
      error.textContent = err.status === 404 ? t('track.notFound') : err.message;
      error.hidden = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (input.value.trim()) lookup(input.value);
  });

  const fromLink = new URLSearchParams(location.search).get('code');
  if (fromLink) {
    input.value = fromLink;
    lookup(fromLink);
  }

  const codes = SB.myCodes();
  if (codes.length) {
    try {
      const [meta, data] = await Promise.all([
        SB.meta(),
        api(`/api/suggestions?sort=new&limit=30&codes=${encodeURIComponent(codes.join(','))}`),
      ]);
      if (data.items.length) {
        document.getElementById('mine-list').replaceChildren(...data.items.map((item) => SB.card(item, meta)));
        document.getElementById('mine').hidden = false;
      }
    } catch { /* this list is a convenience; the form above still works */ }
  }
})();
