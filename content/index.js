(function (root) {
  if (root.__jobAutofillerReady) return;
  root.__jobAutofillerReady = true;

  const api = root.JobAutofiller;
  const store = api.storage.createStore(chrome);
  let lastRun = null;

  function publicFields(results) {
    return results.map(result => ({
      index: result.index,
      label: result.label,
      status: result.status,
      reason: result.reason || '',
      via: result.via || '',
      // Page and profile values are sent to the popup only, and only for
      // conflicts, so the person can compare them. Reports never hold them.
      existing: result.status === 'conflict' ? result.existing : undefined,
      expected: result.status === 'conflict' ? result.expected : undefined
    }));
  }

  async function fill() {
    const profile = await store.getProfile();
    if (!api.profile.hasProfileData(profile)) return { error: 'no_profile' };
    const answers = await store.getAnswers();
    const privateData = await store.getPrivate();
    const role = await store.getRole();
    lastRun = await api.engine.fillPage(document, profile, answers, { privateData, role });
    const report = api.reports.buildReport({
      host: location.hostname,
      ats: lastRun.ats,
      results: lastRun.results,
      profile,
      extensionVersion: chrome.runtime.getManifest().version
    });
    await store.addReport(report);
    return { counts: report.counts, fields: publicFields(lastRun.results) };
  }

  function focusField(index) {
    const result = lastRun && lastRun.results.find(item => item.index === index);
    if (!result || !result.field.el.isConnected) return { ok: false };
    result.field.el.scrollIntoView({ block: 'center' });
    result.field.el.focus();
    return { ok: true };
  }

  async function apply(index) {
    const result = lastRun && lastRun.results.find(item => item.index === index);
    const outcome = await api.engine.applyConflict(result);
    return Object.assign({ status: result ? result.status : '' }, outcome);
  }

  function learnable() {
    return { items: lastRun ? api.engine.collectLearnable(lastRun.results) : [] };
  }

  async function handle(message) {
    switch (message && message.type) {
      case 'fill': return fill();
      case 'focus': return focusField(message.index);
      case 'learn': return learnable();
      case 'apply': return apply(message.index);
      case 'clear':
        api.engine.clearMarks(document);
        return { ok: true };
      default: return { error: 'unknown_message' };
    }
  }

  api.run = { fill };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handle(message).then(sendResponse, error => sendResponse({ error: api.text.describeError(error) }));
    return true;
  });
})(globalThis);
