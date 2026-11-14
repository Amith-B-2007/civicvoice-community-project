(async function () {
  'use strict';
  const { el, api, t } = SB;
  const box = document.getElementById('polls');

  const corpMe = SB.getCorpSession ? await SB.getCorpSession() : null;
  const isCorp = Boolean(corpMe);

  function pollCard(initial) {
    let poll = initial;
    const card = el('article', { class: 'panel poll', id: `poll-${poll.id}` });

    function status() {
      const parts = [];
      if (!poll.open) parts.push(t('polls.isClosed'));
      else if (poll.closesAt) parts.push(t('polls.closes', { date: SB.formatDate(poll.closesAt) }));
      return parts.length ? el('p', { class: 'hint poll-status' }, parts.join(' · ')) : null;
    }

    function voteForm() {
      const error = el('p', { class: 'error', hidden: true });
      const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, t('polls.vote'));
      const form = el('form', { class: 'poll-form', novalidate: true },
        el('fieldset', { class: 'field' },
          el('legend', { class: 'sr-only' }, poll.question),
          poll.options.map((option) => el('label', { class: 'poll-option' },
            el('input', { type: 'radio', name: 'option', value: option.id, checked: option.id === poll.mine }),
            el('span', null, option.label)))),
        error,
        el('div', { class: 'form-actions' }, submit));

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const optionId = Number(form.elements.option.value);
        if (!optionId) {
          error.textContent = t('polls.pick');
          error.hidden = false;
          return;
        }
        submit.disabled = true;
        try {
          poll = await api(`/api/polls/${poll.id}/vote`, { method: 'POST', body: { optionId } });
          SB.toast(t('polls.voted'));
          render('results');
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          submit.disabled = false;
        }
      });
      return form;
    }

    function results() {
      const rows = poll.options.map((option) => {
        const share = poll.total ? Math.round((option.votes / poll.total) * 100) : 0;
        const fill = el('span', { class: 'bar-fill' });
        fill.style.width = `${share}%`;
        return el('div', { class: !isCorp && option.id === poll.mine ? 'poll-result poll-mine' : 'poll-result' },
          el('p', { class: 'poll-result-head' },
            el('span', null, option.label, !isCorp && option.id === poll.mine && el('em', null, ` (${t('polls.yours')})`)),
            el('strong', null, `${share}%`)),
          el('span', { class: 'bar-track' }, fill));
      });
      const change = !isCorp && poll.open && el('button', { type: 'button', class: 'btn btn-sm', onclick: () => render('vote') }, t('polls.change'));
      return el('div', { class: 'poll-results' }, rows, change);
    }

    function render(mode) {
      SB.fill(card,
        el('h2', null, poll.question),
        poll.description && el('p', { class: 'prose' }, poll.description),
        !isCorp && mode === 'vote' ? voteForm() : results(),
        status());
    }
    render(!isCorp && poll.open && poll.mine == null ? 'vote' : 'results');
    return card;
  }

  try {
    const { items } = await api('/api/polls');
    const open = items.filter((poll) => poll.open);
    const closed = items.filter((poll) => !poll.open);
    box.replaceChildren(
      ...(items.length ? [] : [SB.empty(t('polls.none'))]),
      ...(open.length ? [el('h2', { class: 'stack-title' }, t('polls.open')), ...open.map(pollCard)] : []),
      ...(closed.length ? [el('h2', { class: 'stack-title' }, t('polls.closed')), ...closed.map(pollCard)] : []));
  } catch (error) {
    box.replaceChildren(SB.empty(t('common.loadError'), error.message));
  }
})();
