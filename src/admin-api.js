'use strict';

// API used by officials. Every route here needs a signed-in session.
// "admin" sees and manages everything; an "officer" only works on their own department.

const fs = require('node:fs');
const path = require('node:path');

module.exports = function registerAdminApi(app) {
  const { route, config, db, auth, i18n, lists, UPLOADS, HttpError, Validator, readJson, rateLimit, toCsv } = app;
  const { KB, MB, MINUTE } = app.sizes;
  const { STATUSES, TYPES } = app.labels;
  const guarded = { admin: true };

  function unlinkPhoto(filename) {
    if (!filename || /[\\/]/.test(filename)) return;
    try { fs.unlinkSync(path.join(UPLOADS, filename)); } catch {}
  }

  // An officer is limited to their department and, when set, their district. The administrator sees all.
  const limits = (ctx) => ({ department: ctx.admin.department, district: ctx.admin.district });

  const requireHead = (ctx) => {
    if (ctx.admin.role !== 'admin') throw new HttpError(403, 'err.forbidden');
  };

  // Looks up a submission the signed-in official is allowed to work on.
  function ownSuggestion(ctx) {
    const row = db.findByCode(app.codeParam(ctx));
    if (!row || (ctx.admin.department && row.department !== ctx.admin.department)
      || (ctx.admin.district && row.district !== ctx.admin.district)) {
      throw new HttpError(404, 'err.notFound');
    }
    return row;
  }

  const idParam = (ctx) => Number(ctx.params.id) || 0;
  const str = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');

  // ---------- Session ----------

  route('POST', '/api/admin/login', async (ctx) => {
    rateLimit(`login:${ctx.ip}`, 10, 15 * MINUTE, 'Too many sign-in attempts. Please wait 15 minutes.');
    const body = await readJson(ctx.req, 4 * KB);
    const username = str(body.username, 60).trim().toLowerCase();
    const password = str(body.password);
    const district = body.district && lists.districtIds.includes(body.district) ? body.district : null;
    const result = username && password ? auth.login(ctx.req, username, password, district) : null;
    if (!result) throw new HttpError(401, 'Wrong username or password.');
    if (result.error) throw new HttpError(403, result.error);
    ctx.res.setHeader('Set-Cookie', result.cookie);
    return { ok: true };
  });

  route('POST', '/api/admin/logout', (ctx) => {
    ctx.req.resume();
    ctx.res.setHeader('Set-Cookie', auth.logout(ctx.req));
    return { ok: true };
  });

  route('GET', '/api/admin/me', (ctx) => ({
    username: ctx.admin.username,
    name: ctx.admin.name,
    role: ctx.admin.role,
    department: ctx.admin.department,
    district: ctx.admin.district,
  }), guarded);

  route('POST', '/api/admin/password', async (ctx) => {
    const body = await readJson(ctx.req, 4 * KB);
    const next = str(body.next);
    if (next.length < 8) throw new HttpError(422, 'err.fix', { next: 'Use at least 8 characters.' });
    if (!auth.changePassword(ctx.admin, str(body.current), next)) {
      throw new HttpError(422, 'err.fix', { current: 'The current password is wrong.' });
    }
    return { ok: true };
  }, guarded);

  // ---------- Submissions ----------

  route('GET', '/api/admin/suggestions', (ctx) => {
    const filters = app.listFilters(ctx.query);
    const result = db.listSuggestions({
      ...filters,
      department: ctx.admin.department || filters.department,
      district: ctx.admin.district || filters.district,
      sort: ctx.query.get('sort') ? filters.sort : 'new',
      includeHidden: true,
    });
    const stats = db.stats(limits(ctx));
    result.summary = {
      total: stats.total,
      awaiting: stats.byStatus.submitted,
      active: stats.byStatus.under_review + stats.byStatus.planned + stats.byStatus.in_progress,
      byStatus: stats.byStatus,
      ratingAvg: stats.fixed.ratingAvg,
      ratingCount: stats.fixed.ratingCount,
      overdue: stats.overdue,
      overdueDays: stats.overdueDays,
      ...db.attention(limits(ctx)),
    };
    return result;
  }, guarded);

  route('GET', '/api/admin/suggestions/:code', (ctx) => {
    ownSuggestion(ctx);
    return db.getSuggestion(app.codeParam(ctx), { admin: true });
  }, guarded);

  route('PATCH', '/api/admin/suggestions/:code', async (ctx) => {
    const row = ownSuggestion(ctx);
    const body = await readJson(ctx.req, 4 * MB);

    const v = new Validator(ctx.t);
    const status = body.status === undefined
      ? row.status
      : v.oneOf('status', body.status, lists.statusIds, 'Choose a valid status.');
    const note = v.text('note', body.note, { label: 'field.reply', max: 1000, multiline: true });
    const department = body.department === undefined
      ? undefined
      : v.oneOf('department', body.department, lists.departmentIds, 'Choose a department.');
    v.throwIfInvalid();

    const photo = body.photo ? app.savePhoto(body.photo, ctx.t) : null;
    if (status !== row.status || note || photo) {
      db.addUpdate(row.id, status, note, { photo, byName: ctx.admin.name });
    }
    if (typeof body.hidden === 'boolean') db.setHidden(row.id, body.hidden);
    if (body.clearReports === true) db.clearReports(row.id);
    if (department && department !== row.department) db.updateSuggestion(row.id, { department });

    // An officer who passes a submission to another department can no longer open it.
    const moved = ctx.admin.department && department && department !== ctx.admin.department;
    return moved ? { moved: true } : db.getSuggestion(row.code, { admin: true });
  }, guarded);

  route('DELETE', '/api/admin/suggestions/:code/photo', (ctx) => {
    ctx.req.resume();
    const row = ownSuggestion(ctx);
    const removed = db.removeSuggestionPhoto(row.id);
    if (removed) unlinkPhoto(removed);
    return db.getSuggestion(row.code, { admin: true });
  }, guarded);

  route('DELETE', '/api/admin/updates/:id/photo', (ctx) => {
    ctx.req.resume();
    const update = db.findUpdate(idParam(ctx));
    if (!update || (ctx.admin.department && update.department !== ctx.admin.department)
      || (ctx.admin.district && update.district !== ctx.admin.district)) {
      throw new HttpError(404, 'Photo not found.');
    }
    const removed = db.removeUpdatePhoto(update.id);
    if (removed) unlinkPhoto(removed);
    return db.getSuggestion(update.code, { admin: true });
  }, guarded);

  route('DELETE', '/api/admin/comments/:id', (ctx) => {
    ctx.req.resume();
    const comment = db.findComment(idParam(ctx));
    if (!comment || (ctx.admin.department && comment.department !== ctx.admin.department)
      || (ctx.admin.district && comment.district !== ctx.admin.district)) {
      throw new HttpError(404, 'Comment not found.');
    }
    db.deleteComment(comment.id);
    return { ok: true };
  }, guarded);

  route('GET', '/api/admin/export.csv', (ctx) => {
    const label = (list, id) => {
      const item = list.find((entry) => entry.id === id);
      return item ? i18n.loc(item.label, 'en') : id;
    };
    const rows = [[
      'Tracking code', 'Type', 'Title', 'Description', 'Category', 'Department', 'District', 'Town', 'Ward or area', 'Address',
      'Latitude', 'Longitude', 'Status', 'Votes', 'Comments', 'Say fixed', 'Say not fixed', 'Reports',
      'Name', 'Contact', 'Hidden', 'Submitted', 'Last updated',
    ]];
    for (const row of db.exportRows(limits(ctx))) {
      rows.push([
        row.code, label(TYPES, row.type), row.title, row.description, label(config.categories, row.category),
        label(config.departments, row.department), label(config.districts, row.district), row.town, row.ward,
        row.location, row.lat, row.lng,
        label(STATUSES, row.status), row.votes, row.comments, row.fixed_yes, row.fixed_no, row.reports,
        row.author_name, row.contact, row.hidden ? 'yes' : 'no', row.created_at, row.updated_at,
      ]);
    }
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="suggestions-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(toCsv(rows));
  }, guarded);

  route('GET', '/api/admin/report', (ctx) => {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(ctx.query.get('month') || '')
      ? ctx.query.get('month')
      : new Date().toISOString().slice(0, 7);
    return db.monthlyReport(month, limits(ctx));
  }, guarded);

  // ---------- Polls (head admin) ----------

  route('POST', '/api/admin/polls', async (ctx) => {
    requireHead(ctx);
    const body = await readJson(ctx.req, 20 * KB);
    const v = new Validator(ctx.t);
    const question = v.text('question', body.question, { label: 'field.question', min: 8, max: 200 });
    const description = v.text('description', body.description, { label: 'field.description', max: 500, multiline: true });
    const options = (Array.isArray(body.options) ? body.options : []).slice(0, 8)
      .map((option) => v.text('options', option, { label: 'field.option', max: 80 }))
      .filter(Boolean);
    if (new Set(options).size < 2) v.fail('options', 'Give at least two different options.');

    let closesAt = null;
    if (body.closesAt) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.closesAt) ? new Date(`${body.closesAt}T23:59:59`) : null;
      if (!date || Number.isNaN(date.getTime()) || date < new Date()) v.fail('closesAt', 'Pick a closing date in the future.');
      else closesAt = date.toISOString();
    }
    v.throwIfInvalid();
    return { id: db.createPoll({ question, description, options: [...new Set(options)], closesAt }) };
  }, guarded);

  route('PATCH', '/api/admin/polls/:id', async (ctx) => {
    requireHead(ctx);
    const body = await readJson(ctx.req, 1 * KB);
    if (typeof body.closed !== 'boolean' || !db.setPollClosed(idParam(ctx), body.closed)) {
      throw new HttpError(404, 'Poll not found.');
    }
    return { ok: true };
  }, guarded);

  route('DELETE', '/api/admin/polls/:id', (ctx) => {
    requireHead(ctx);
    ctx.req.resume();
    if (!db.deletePoll(idParam(ctx))) throw new HttpError(404, 'Poll not found.');
    return { ok: true };
  }, guarded);

  // ---------- Notices (admin and district corporations) ----------

  route('POST', '/api/admin/notices', async (ctx) => {
    const body = await readJson(ctx.req, 20 * KB);
    const v = new Validator(ctx.t);
    const title = v.text('title', body.title, { label: 'field.noticeTitle', min: 4, max: 120 });
    const text = v.text('body', body.body, { label: 'field.noticeBody', min: 10, max: 2000, multiline: true });
    v.throwIfInvalid();
    return { id: db.createNotice({ title, body: text, pinned: body.pinned === true }) };
  }, guarded);

  route('DELETE', '/api/admin/notices/:id', (ctx) => {
    ctx.req.resume();
    if (!db.deleteNotice(idParam(ctx))) throw new HttpError(404, 'Notice not found.');
    return { ok: true };
  }, guarded);

  // ---------- Officer accounts (head admin) ----------

  route('GET', '/api/admin/officers', (ctx) => {
    requireHead(ctx);
    return { items: db.listOfficers() };
  }, guarded);

  route('POST', '/api/admin/officers', async (ctx) => {
    requireHead(ctx);
    const body = await readJson(ctx.req, 4 * KB);
    const v = new Validator(ctx.t);
    const username = str(body.username, 40).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) v.fail('username', 'Use 3 to 30 letters, digits, dots or dashes.');
    else if (db.findAdmin(username)) v.fail('username', 'That username is already taken.');
    const name = v.text('name', body.name, { label: 'field.officerName', min: 2, max: 60 });
    const department = body.department ? v.oneOf('department', body.department, lists.departmentIds, 'Choose a department.') : null;
    const district = body.district ? v.oneOf('district', body.district, lists.districtIds, 'Choose a district.') : null;
    if (!department && !district) v.fail('department', 'Choose a department or a district.');
    const password = str(body.password);
    if (password.length < 8) v.fail('password', 'Use at least 8 characters.');
    v.throwIfInvalid();
    return { id: auth.createOfficer({ username, name, department, district, password }) };
  }, guarded);

  route('POST', '/api/admin/officers/:id/password', async (ctx) => {
    requireHead(ctx);
    const body = await readJson(ctx.req, 4 * KB);
    const officer = db.findAdminById(idParam(ctx));
    if (!officer || officer.role !== 'officer') throw new HttpError(404, 'Officer not found.');
    const password = str(body.password);
    if (password.length < 8) throw new HttpError(422, 'err.fix', { password: 'Use at least 8 characters.' });
    auth.resetPassword(officer.id, password);
    return { ok: true };
  }, guarded);

  route('DELETE', '/api/admin/officers/:id', (ctx) => {
    requireHead(ctx);
    ctx.req.resume();
    if (!db.deleteOfficer(idParam(ctx))) throw new HttpError(404, 'Officer not found.');
    return { ok: true };
  }, guarded);
};
