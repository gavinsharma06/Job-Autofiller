(function (root) {
  const load = (name, path) => (typeof require === 'function' ? require(path) : root.JobAutofiller[name]);
  const profileApi = load('profile', '../core/profile');
  const matcher = load('matcher', '../core/matcher');
  const answersApi = load('answers', '../core/answers');
  const scan = load('scan', './scan');
  const filler = load('fill', './fill');
  const workday = load('workday', '../adapters/workday');

  const DEFAULT_TIMING = { timeout: 2000, interval: 50 };
  const LEARNABLE_KINDS = new Set(['text', 'textarea', 'select', 'radio', 'listbox']);
  const MAX_LEARN_LENGTH = 500;

  const STYLE_ID = 'job-autofiller-style';
  const STYLE = `
    [data-jaf="review"] { outline: 2px solid #d97706 !important; outline-offset: 2px !important; }
    [data-jaf="verify"] { outline: 2px solid #2563eb !important; outline-offset: 2px !important; }
    [data-jaf="filled"] { outline: 2px solid #16a34a !important; outline-offset: 2px !important; }
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

  async function processField(field, profile, answers, adapter, timing) {
    if (field.kind === 'file') return review('manual_upload');
    if (field.hasValue) return { status: 'existing' };
    if (matcher.isSensitive(field.label)) return review('sensitive');

    if (field.kind === 'checkbox') {
      const key = adapter && adapter.keyFor(field);
      if (key && key.endsWith('.current')) {
        const wanted = profileApi.getValue(profile, key);
        if (wanted === true) {
          const outcome = await filler.fillField(field, true, timing);
          return outcome.ok ? { status: 'filled', key, via: 'workday' } : review(outcome.reason, { key });
        }
        return review('no_profile_value', { key });
      }
      return review(matcher.isConsent(field.label) ? 'consent' : 'manual_checkbox');
    }

    if (field.kind === 'combobox') return review('unsupported_control');

    const match = resolveKey(field, adapter);
    if (match && match.ambiguous) return review('ambiguous');

    let value = null;
    let meta = {};
    if (match) {
      value = profileApi.getValue(profile, match.key);
      meta = { key: match.key, via: match.via };
      if (value === '') return review('no_profile_value', meta);
    } else {
      value = answersApi.findAnswer(answers, field.label);
      if (value == null) return review('no_match');
      meta = { via: 'saved answer' };
    }

    const outcome = await filler.fillField(field, value, timing);
    if (!outcome.ok) return review(outcome.reason, meta);
    const unsure = match && match.confidence !== matcher.HIGH;
    return Object.assign({ status: unsure ? 'verify' : 'filled' }, meta);
  }

  async function fillPage(doc, profile, answers, options) {
    const timing = Object.assign({}, DEFAULT_TIMING, options && options.timing);
    ensureStyle(doc);
    clearMarks(doc);
    const adapter = workday.matchesHost(doc.location && doc.location.hostname) ? workday : null;
    const results = [];
    for (const field of scan.collectFields(doc)) {
      let outcome;
      try {
        outcome = await processField(field, profile, answers || [], adapter, timing);
      } catch (error) {
        outcome = review('error');
      }
      if (outcome.status !== 'existing') field.el.setAttribute('data-jaf', outcome.status);
      results.push(Object.assign({ field, index: field.index, label: field.label, kind: field.kind, type: field.type,
        automationId: field.automationId, autocomplete: field.autocomplete }, outcome));
    }
    return { ats: adapter ? 'workday' : 'generic', results };
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

  const api = { fillPage, collectLearnable, clearMarks };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
