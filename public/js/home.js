(async function () {
  'use strict';
  const { el, api, t } = SB;
  const trending = document.getElementById('trending');

  try {
    const [meta, stats, top, polls, notices] = await Promise.all([
      SB.meta(),
      api('/api/stats'),
      api('/api/suggestions?sort=top&limit=3'),
      api('/api/polls'),
      api('/api/notices?limit=3'),
    ]);

    const tiles = [
      ['home.stat.shared', stats.total],
      ['home.stat.implemented', stats.byStatus.implemented],
      ['home.stat.active', stats.byStatus.planned + stats.byStatus.in_progress],
      ['home.stat.votes', stats.votes],
    ];
    document.getElementById('hero-stats').replaceChildren(
      ...tiles.map(([key, value]) => el('div', { class: 'stat' }, el('dt', null, t(key)), el('dd', null, value))));

    // Latest open poll and newest notices from the council.
    const poll = polls.items.find((item) => item.open);
    const pollBox = document.getElementById('home-poll');
    if (poll) {
      pollBox.hidden = false;
      pollBox.append(
        el('p', { class: 'eyebrow eyebrow-plain' }, t('home.poll')),
        el('h2', null, poll.question),
        el('p', { class: 'hint' }, SB.tn('count.vote', poll.total)),
        el('a', { class: 'btn btn-primary', href: '/polls' }, t('home.pollCta')));
    }
    const noticeBox = document.getElementById('home-notices');
    if (notices.items.length) {
      noticeBox.hidden = false;
      noticeBox.append(
        el('div', { class: 'section-head' },
          el('h2', null, t('home.notices')),
          el('a', { href: '/notices' }, t('home.allNotices'))),
        el('ul', { class: 'notice-list' }, notices.items.map((notice) => el('li', null,
          el('a', { href: `/notices#notice-${notice.id}` }, notice.title),
          el('span', null, SB.formatDate(notice.createdAt))))));
    }
    document.getElementById('council').hidden = !poll && !notices.items.length;

    trending.replaceChildren(...(top.items.length
      ? top.items.map((item) => SB.card(item, meta))
      : [SB.empty(t('home.empty.t'), t('home.empty.d'),
        el('a', { class: 'btn btn-primary', href: '/submit' }, t('nav.submit')))]));

    const counts = Object.fromEntries(stats.byCategory.map((row) => [row.id, row.n]));
    document.getElementById('categories').replaceChildren(...meta.categories.map((category) =>
      el('a', { class: 'category-tile', href: `/browse?category=${encodeURIComponent(category.id)}` },
        el('span', { class: 'category-icon', 'aria-hidden': 'true' }, category.icon),
        el('span', { class: 'category-name' }, category.label),
        el('span', { class: 'category-count' }, SB.tn('count.entry', counts[category.id] || 0)))));
  } catch (error) {
    trending.replaceChildren(SB.empty(t('common.loadError'), error.message));
  }
})();
