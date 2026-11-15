(function (root) {
  const load = (name, path) => (typeof require === 'function' ? require(path) : root.JobAutofiller[name]);
  const profileApi = load('profile', '../core/profile');
  const matcher = load('matcher', '../core/matcher');
  const answersApi = load('answers', '../core/answers');
  const scan = load('scan', './scan');
  const filler = load('fill', './fill');
  const workday = load('workday', '../adapters/workday');
  const format = load('format', '../core/format');
  const degree = load('degree', '../core/degree');
  const privApi = load('privatedata', '../core/privatedata');
  const repeaters = load('repeaters', './repeaters');
  const values = load('values', '../core/values');

  const DEFAULT_TIMING = { timeout: 2000, interval: 50 };
  const LEARNABLE_KINDS = new Set(['text', 'textarea', 'select', 'radio', 'listbox']);
  const MAX_LEARN_LENGTH = 500;

  const STYLE_ID = 'job-autofiller-style';
  const STYLE = `
    [data-jaf="review"] { outline: 2px solid #d97706 !important; outline-offset: 2px !important; }
    [data-jaf="verify"] { outline: 2px solid #2563eb !important; outline-offset: 2px !important; }
    [data-jaf="filled"] { outline: 2px solid #16a34a !important; outline-offset: 2px !important; }
    [data-jaf="conflict"] { outline: 2px dashed #dc2626 !important; outline-offset: 2px !important; }
    [data-jaf="invalid"] { outline: 2px dotted #9333ea !important; outline-offset: 2px !important; }
  `;

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function clearMarks(doc) {
    doc.querySelectorAll('[data-jaf]').forEach(el => el.removeAttribute('data-jaf'));
  }

  function resolveKey(field, adapter) {
    if (adapter) {
      const key = adapter.keyFor(field);
      if (key) return { key, confidence: matcher.HIGH, via: 'workday' };
    }
    const auto = matcher.matchAutocomplete(field.autocomplete);
    if (auto) return auto;
    const byLabel = matcher.matchLabel(field.label);
    if (byLabel && byLabel.ambiguous) return byLabel;
    if (byLabel) {
      if (field.labelSource === 'placeholder') byLabel.confidence = matcher.MEDIUM;
      return byLabel;
    }
    return matcher.matchInputType(field.type);
  }

  function review(reason, extra) {
    return Object.assign({ status: 'review', reason }, extra);
  }

  // Reasons that mean "nothing was tried because there was nothing to enter".
  // On an optional field these do not need the person's attention.
  // File uploads always stay visible. An unmatched question counts too on Workday, where required fields always
  // carry a star. Elsewhere it stays visible because the person may answer it.
  const NOT_ATTEMPTED = new Set(['no_profile_value', 'ambiguous', 'manual_checkbox', 'sensitive', 'approval_required']);

  function isoParts(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? { year: match[1], month: match[2], day: match[3] } : null;
  }

  // The page refused or changed what was entered. These are failures, not
  // fields that simply had no answer.
  const INVALID_REASONS = new Set(['rejected_by_page', 'value_mismatch']);

  function failure(reason, extra) {
    return INVALID_REASONS.has(reason) ? Object.assign({ status: 'invalid', reason }, extra) : review(reason, extra);
  }

  function contextFor(key, ctx) {
    const base = { enterToSearch: Boolean(ctx.adapter), key };
    if (key && /\.degree$/.test(key)) base.pick = degree.pickDegree;
    return base;
  }

  // A value is already on the page. It is kept either way. It counts as
  // present only when it agrees with the saved profile; when it says something
  // else the field is a conflict for the person to review, never overwritten.
  function classifyExisting(field, ctx) {
    if (field.kind === 'checkbox') return { status: 'existing' };
    const match = resolveKey(field, ctx.adapter);
    if (!match || match.ambiguous) return { status: 'existing' };
    const wanted = profileApi.getValue(ctx.profile, match.key);
    if (typeof wanted !== 'string' || wanted === '') return { status: 'existing', key: match.key, via: match.via };
    const expected = format.formatValue(match.key, wanted);
    const present = scan.readValue(field);
    const meta = { key: match.key, via: match.via };
    if (values.agrees(match.key, expected, present)) return Object.assign({ status: 'existing' }, meta);
    return Object.assign({ status: 'conflict', reason: 'conflicts_with_profile', existing: present, expected, fillContext: contextFor(match.key, ctx) }, meta);
  }

  async function decide(field, ctx) {
    const { profile, answers, library, host, adapter, timing } = ctx;
    if (field.kind === 'file') return review('manual_upload');
    if (field.hasValue) return classifyExisting(field, ctx);
    if (matcher.isSensitive(field.label)) return review('sensitive');

    if (field.kind === 'checkbox') {
      const key = adapter && adapter.keyFor(field);
      if (key && key.endsWith('.current')) {
        const wanted = profileApi.getValue(profile, key);
        if (wanted === true) {
          const outcome = await filler.fillField(field, true, timing);
          return outcome.ok ? { status: 'filled', key, via: 'workday' } : failure(outcome.reason, { key });
        }
        return review('no_profile_value', { key });
      }
      return review(matcher.isConsent(field.label) ? 'consent' : 'manual_checkbox');
    }

    const match = resolveKey(field, adapter);
    if (match && match.ambiguous) return review('ambiguous');

    let value = null;
    let meta = {};
    if (match) {
      value = profileApi.getValue(profile, match.key);
      meta = { key: match.key, via: match.via };
      if (value === '') return review('no_profile_value', meta);
      value = format.formatValue(match.key, value);
    } else {
      const rule = privApi.findRule(library, field.dateLabel || field.label, host);
      value = answersApi.findAnswer(answers, field.label);
      meta = { via: 'saved answer' };
      if (value == null && rule) {
        if (rule.ask) return review('approval_required', { via: 'answer library' });
        const resolved = rule.answer.map(item => privApi.resolveAnswer(item));
        value = field.datePart ? (isoParts(resolved[0]) || {})[field.datePart] : resolved;
        meta = { via: 'answer library' };
      }
      if (value == null || value === '') return review('no_match');
    }

    const key = match ? match.key : '';
    const outcome = await filler.fillField(field, value, timing, contextFor(key, ctx));
    if (!outcome.ok) return failure(outcome.reason, meta);
    // Backstop: whatever the fill reported, the page must now hold a real value.
    if (!scan.hasValue(field)) return failure('rejected_by_page', meta);
    const unsure = match && match.confidence !== matcher.HIGH;
    return Object.assign({ status: unsure ? 'verify' : 'filled' }, meta);
  }

  async function processField(field, ctx) {
    const outcome = await decide(field, ctx);
    const skipped = NOT_ATTEMPTED.has(outcome.reason) || (ctx.adapter && outcome.reason === 'no_match');
    if (outcome.status === 'review' && ctx.judgeOptional && field.required === false && skipped) {
      return Object.assign({}, outcome, { status: 'optional' });
    }
    return outcome;
  }

  // The profile the form is filled from: the saved profile plus the work
  // history, certifications and websites that come from private data.
  function buildProfile(profile, priv, role) {
    const effective = Object.assign({}, profile);
    if (!profile.employment.length && priv) effective.employment = privApi.workEntries(priv, role);
    effective.certifications = priv ? priv.certifications : [];
    effective.websites = privApi.websiteList(priv, profile).map(url => ({ url }));
    return effective;
  }

  function pageText(doc) {
    const header = doc.querySelector('[data-automation-id="jobPostingHeader"], h1');
    return `${doc.title || ''} ${header ? header.textContent : ''}`;
  }

  async function fillPage(doc, profile, answers, options) {
    const opts = options || {};
    const timing = Object.assign({}, DEFAULT_TIMING, opts.timing);
    ensureStyle(doc);
    clearMarks(doc);
    const host = doc.location && doc.location.hostname;
    const adapter = workday.matchesHost(host) ? workday : null;
    const priv = opts.privateData ? privApi.sanitizePrivate(opts.privateData) : null;
    const role = opts.role || privApi.detectRole(pageText(doc)) || 'backend';
    const effective = buildProfile(profile, priv, role);

    if (adapter) {
      await repeaters.ensureSections(doc, 'employment', effective.employment.length, timing);
      await repeaters.ensureSections(doc, 'certifications', effective.certifications.length, timing);
      await repeaters.ensureSections(doc, 'websites', effective.websites.length, timing);
    }

    const fields = scan.collectFields(doc);
    const ctx = {
      profile: effective,
      answers: answers || [],
      library: priv ? priv.library : [],
      host,
      adapter,
      timing,
      judgeOptional: Boolean(adapter) || fields.some(field => field.required)
    };
    const results = [];
    for (const field of fields) {
      let outcome;
      try {
        outcome = await processField(field, ctx);
      } catch (error) {
        outcome = review('error');
      }
      if (outcome.status !== 'existing' && outcome.status !== 'optional') field.el.setAttribute('data-jaf', outcome.status);
      results.push(Object.assign({ field, index: field.index, label: field.label, kind: field.kind, type: field.type,
        automationId: field.automationId, autocomplete: field.autocomplete }, outcome));
    }
    return { ats: adapter ? 'workday' : 'generic', role, results };
  }

  // Fields the tool could not match that now hold something the user typed.
  // These are offered for approval and never stored automatically.
  function collectLearnable(results) {
    const found = [];
    for (const result of results) {
      const field = result.field;
      if (result.status !== 'review' || result.reason !== 'no_match') continue;
      if (!field.el.isConnected || !LEARNABLE_KINDS.has(field.kind)) continue;
      if (!answersApi.canLearn(field.label)) continue;
      const value = scan.readValue(field);
      if (!value || value.length > MAX_LEARN_LENGTH) continue;
      found.push({ index: result.index, label: field.label, value });
    }
    return found;
  }

  const APPLY_KINDS = new Set(['text', 'textarea', 'select', 'radio', 'listbox']);

  // Replaces a conflicting value with the saved profile value. This only runs
  // when the person presses the button for that one field, never during Fill.
  async function applyConflict(result, timing) {
    if (!result || result.status !== 'conflict' || !result.field.el.isConnected) return { ok: false, reason: 'not_available' };
    const field = result.field;
    if (!APPLY_KINDS.has(field.kind)) return { ok: false, reason: 'manual_only' };
    const outcome = await filler.fillField(field, result.expected, Object.assign({}, DEFAULT_TIMING, timing), result.fillContext);
    if (outcome.ok && scan.hasValue(field)) {
      result.status = 'filled';
      delete result.reason;
      field.el.setAttribute('data-jaf', 'filled');
      return { ok: true };
    }
    result.status = 'invalid';
    result.reason = INVALID_REASONS.has(outcome.reason) ? outcome.reason : 'rejected_by_page';
    field.el.setAttribute('data-jaf', 'invalid');
    return { ok: false, reason: result.reason };
  }

  const api = { fillPage, collectLearnable, clearMarks, applyConflict };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
