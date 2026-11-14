(async function () {
  'use strict';
  const { el, api, t } = SB;
  const box = document.getElementById('notices');

  let corpMe = null;
  if (SB.getCorpSession) {
    corpMe = await SB.getCorpSession();
  }

  function renderNoticeForm(onPublished) {
    const titleInput = el('input', {
      id: 'corp-notice-title',
      type: 'text',
      maxlength: '120',
      required: true,
      placeholder: 'Enter notice title for residents',
    });
    const bodyInput = el('textarea', {
      id: 'corp-notice-body',
      rows: '4',
      maxlength: '2000',
      required: true,
      placeholder: 'Type the notice message to announce to the people...',
    });
    const pinCheck = el('input', { type: 'checkbox', id: 'corp-notice-pinned' });
    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Publish notice');
    const formError = el('p', { class: 'form-error', role: 'alert', hidden: true });

    const form = el('form', { class: 'form-card', novalidate: true },
      el('h2', null, 'Give a Notice to the People'),
      el('div', { class: 'field' },
        el('label', { for: 'corp-notice-title' }, 'Title'),
        titleInput,
        el('p', { class: 'error', 'data-error': 'title', hidden: true })),
      el('div', { class: 'field' },
        el('label', { for: 'corp-notice-body' }, 'Notice text'),
        bodyInput,
        el('p', { class: 'error', 'data-error': 'body', hidden: true })),
      el('label', { class: 'check' }, pinCheck, el('span', null, 'Mark as important (stays at the top)')),
      formError,
      el('div', { class: 'form-actions' }, submitBtn));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      formError.hidden = true;
      submitBtn.disabled = true;
      try {
        await api('/api/admin/notices', {
          method: 'POST',
          body: {
            title: titleInput.value,
            body: bodyInput.value,
            pinned: pinCheck.checked,
          },
        });
        form.reset();
        SB.showFieldErrors(form, null);
        SB.toast('Notice published.');
        await onPublished();
      } catch (error) {
        SB.showFieldErrors(form, error.fields);
        if (!error.fields) {
          formError.textContent = error.message;
          formError.hidden = false;
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
    return form;
  }

  async function loadNotices() {
    const { items } = await api('/api/notices');
    const listNodes = items.length ? items.map((notice) =>
      el('article', { class: notice.pinned ? 'panel notice-card notice-important' : 'panel notice-card', id: `notice-${notice.id}` },
        el('p', { class: 'notice-meta' },
          notice.pinned && el('span', { class: 'badge badge-important' }, t('notices.pinned')),
          el('span', null, SB.formatDate(notice.createdAt))),
        el('h2', null, notice.title),
        el('p', { class: 'prose' }, notice.body),
        corpMe && el('div', { class: 'manage-foot' },
          el('span'),
          el('button', {
            type: 'button',
            class: 'btn btn-sm btn-danger',
            onclick: async (e) => {
              if (!window.confirm('Delete this notice?')) return;
              e.currentTarget.disabled = true;
              try {
                await api(`/api/admin/notices/${notice.id}`, { method: 'DELETE' });
                SB.toast('Notice deleted.');
                await loadNotices();
              } catch (err) {
                e.currentTarget.disabled = false;
                SB.toast(err.message, 'error');
              }
            },
          }, 'Delete'))))
      : [SB.empty(t('notices.none'))];

    box.replaceChildren(
      ...(corpMe ? [renderNoticeForm(loadNotices)] : []),
      ...listNodes,
    );
  }

  try {
    await loadNotices();
    // A link from the home page points at one notice: bring it into view.
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: 'start' });
  } catch (error) {
    box.replaceChildren(SB.empty(t('common.loadError'), error.message));
  }
})();
