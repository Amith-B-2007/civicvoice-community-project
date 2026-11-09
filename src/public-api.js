'use strict';

// API used by residents: no sign-in needed.

const fs = require('node:fs');
const path = require('node:path');

module.exports = function registerPublicApi(app) {
  const { route, config, db, i18n, lists, HttpError, Validator, readJson, rateLimit } = app;
  const { KB, MB, MINUTE } = app.sizes;
  const { STATUSES, TYPES, REPORT_REASONS } = app.labels;

  route('GET', '/api/meta', (ctx) => {
    const local = (value) => i18n.loc(value, ctx.lang);
    return {
      lang: ctx.lang,
      siteName: local(config.siteName),
      bodyName: local(config.bodyName),
      region: local(config.region),
      categories: config.categories.map((category) => ({
        id: category.id,
        icon: category.icon,
        department: category.department || null,
        label: local(category.label),
      })),
      departments: config.departments.map((department) => ({ id: department.id, label: local(department.label) })),
      districts: config.districts.map((district) => {
        const labels = typeof district.label === 'string' ? [district.label] : Object.values(district.label);
        return {
          id: district.id,
          label: local(district.label),
          labels,
          names: [...labels, ...(district.aliases || [])],
          center: district.center,
        };
      }),
      statuses: STATUSES.map((status) => ({ id: status.id, label: local(status.label) })),
      types: TYPES.map((type) => ({ id: type.id, label: local(type.label) })),
      reportReasons: REPORT_REASONS,
      map: config.map,
      overdueDays: config.overdueDays,
      publicUrl: config.publicUrl || '',
    };
  });

  // ---------- Reading ----------

  route('GET', '/api/suggestions', (ctx) => db.listSuggestions({
    ...app.listFilters(ctx.query),
    attention: null,
    voter: ctx.voter,
  }));

  // Every visible submission that has a map pin, in a light shape for drawing markers.
  route('GET', '/api/map', (ctx) => {
    const filters = app.listFilters(ctx.query);
    const { items } = db.listSuggestions({
      category: filters.category, status: filters.status, type: filters.type, district: filters.district,
      pinned: true, sort: 'new', limit: 1000,
    });
    return {
      items: items.map((item) => ({
        code: item.code, title: item.title, type: item.type, category: item.category, district: item.district, town: item.town,
        status: item.status, votes: item.votes, lat: item.lat, lng: item.lng,
      })),
    };
  });

  route('GET', '/api/suggestions/:code', (ctx) => {
    const suggestion = db.getSuggestion(app.codeParam(ctx), { voter: ctx.voter });
    if (!suggestion) throw new HttpError(404, 'err.notFound');
    return suggestion;
  });

  route('GET', '/api/similar', (ctx) => ({ items: db.similar((ctx.query.get('q') || '').slice(0, 120)) }));

  route('GET', '/api/stats', () => db.stats());

  route('GET', '/api/polls', (ctx) => ({ items: db.listPolls(ctx.voter) }));

  route('GET', '/api/notices', (ctx) => ({
    items: db.listNotices(Math.min(50, Math.max(1, parseInt(ctx.query.get('limit'), 10) || 50))),
  }));

  // ---------- Writing ----------

  // A map pin is optional, but when present it must be a real coordinate pair.
  function readPin(body, v) {
    if (body.lat == null && body.lng == null) return { lat: null, lng: null };
    const { lat, lng } = body;
    const valid = typeof lat === 'number' && typeof lng === 'number'
      && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (!valid) {
      v.fail('pin', 'err.pin');
      return { lat: null, lng: null };
    }
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }; // about 10 cm
  }

  route('POST', '/api/suggestions', async (ctx) => {
    rateLimit(`submit:${ctx.ip}`, 10, 10 * MINUTE, 'err.rateSubmit');
    const body = await readJson(ctx.req, 4 * MB);
    if (body.website) throw new HttpError(400, 'err.rejected'); // hidden field only bots fill in

    const v = new Validator(ctx.t);
    const type = v.oneOf('type', body.type, lists.typeIds, 'err.type');
    const title = v.text('title', body.title, { label: 'field.title', min: 8, max: 120 });
    const description = v.text('description', body.description, { label: 'field.description', min: 20, max: 2000, multiline: true });
    const category = v.oneOf('category', body.category, lists.categoryIds, 'err.category');
    const district = v.oneOf('district', body.district, lists.districtIds, 'err.district');
    const town = v.text('town', body.town, { label: 'field.town', min: 2, max: 80 });
    const ward = v.text('ward', body.ward, { label: 'field.ward', max: 60 });
    const location = v.text('location', body.location, { label: 'field.location', max: 200 });
    const authorName = body.anonymous ? null : v.text('name', body.name, { label: 'field.name', max: 60 });
    const contact = v.text('contact', body.contact, { label: 'field.contact', max: 120 });
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && !/^\+?[\d\s-]{7,16}$/.test(contact)) {
      v.fail('contact', 'err.contact');
    }
    const pin = readPin(body, v);
    v.throwIfInvalid();

    const photo = body.photo ? app.savePhoto(body.photo, ctx.t) : null;
    try {
      const { code } = db.createSuggestion({
        type, title, description, category, district, town, ward, location, authorName, contact, photo,
        department: app.departmentOf(category),
        lat: pin.lat,
        lng: pin.lng,
      });
      return { code };
    } catch (err) {
      if (photo) fs.rmSync(path.join(app.UPLOADS, photo), { force: true });
      throw err;
    }
  });

  route('POST', '/api/suggestions/:code/vote', (ctx) => {
    if (!ctx.voter) throw new HttpError(400, 'err.voter');
    rateLimit(`vote:${ctx.ip}`, 60, MINUTE);
    ctx.req.resume();
    return db.toggleVote(app.visibleSuggestion(ctx).id, ctx.voter);
  });

  route('POST', '/api/suggestions/:code/comments', async (ctx) => {
    rateLimit(`comment:${ctx.ip}`, 15, 10 * MINUTE, 'err.rateComment');
    const suggestion = app.visibleSuggestion(ctx);
    const body = await readJson(ctx.req, 20 * KB);
    if (body.website) throw new HttpError(400, 'err.rejected');
    const v = new Validator(ctx.t);
    const name = v.text('name', body.name, { label: 'field.name', max: 60 });
    const text = v.text('body', body.body, { label: 'field.comment', min: 2, max: 600, multiline: true });
    v.throwIfInvalid();
    return { comment: db.addComment(suggestion.id, name, text) };
  });

  // "Is this really fixed?" Residents confirm or dispute work the council marked as done.
  route('POST', '/api/suggestions/:code/fixed', async (ctx) => {
    if (!ctx.voter) throw new HttpError(400, 'err.voter');
    rateLimit(`fixed:${ctx.ip}`, 30, MINUTE);
    const suggestion = app.visibleSuggestion(ctx);
    const body = await readJson(ctx.req, 1 * KB);
    if (suggestion.status !== 'implemented') throw new HttpError(409, 'err.notImplemented');
    if (typeof body.fixed !== 'boolean') throw new HttpError(400, 'err.json');
    return db.setConfirmation(suggestion.id, ctx.voter, body.fixed);
  });

  route('POST', '/api/reports', async (ctx) => {
    if (!ctx.voter) throw new HttpError(400, 'err.voter');
    rateLimit(`report:${ctx.ip}`, 10, 10 * MINUTE);
    const body = await readJson(ctx.req, 2 * KB);
    const code = typeof body.code === 'string' ? body.code.toUpperCase() : '';
    const suggestion = db.CODE_RE.test(code) ? db.findByCode(code) : null;
    if (!suggestion || suggestion.hidden) throw new HttpError(404, 'err.notFound');
    if (!REPORT_REASONS.includes(body.reason)) throw new HttpError(422, 'err.fix', { reason: ctx.t('err.reportReason') });

    let commentId = null;
    if (body.commentId != null) {
      const comment = db.findComment(Number(body.commentId) || 0);
      if (!comment || comment.suggestion_id !== suggestion.id) throw new HttpError(404, 'err.notFound');
      commentId = comment.id;
    }
    db.addReport(suggestion.id, commentId, body.reason, ctx.voter);
    return { ok: true };
  });

  route('POST', '/api/polls/:id/vote', async (ctx) => {
    if (!ctx.voter) throw new HttpError(400, 'err.voter');
    rateLimit(`poll:${ctx.ip}`, 30, MINUTE);
    const body = await readJson(ctx.req, 1 * KB);
    const poll = db.getPoll(Number(ctx.params.id) || 0);
    if (!poll) throw new HttpError(404, 'err.pollOption');
    if (!poll.open) throw new HttpError(409, 'err.pollClosed');
    if (!poll.options.some((option) => option.id === body.optionId)) throw new HttpError(422, 'err.pollOption');
    db.votePoll(poll.id, body.optionId, ctx.voter);
    return db.getPoll(poll.id, ctx.voter);
  });
};
