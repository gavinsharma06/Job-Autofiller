(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const $ = id => document.getElementById(id);

  const CONTENT_FILES = [
    'core/text.js', 'core/profile.js', 'core/matcher.js', 'core/answers.js', 'core/reports.js',
    'core/format.js', 'core/degree.js', 'core/values.js', 'core/privatedata.js',
    'storage/store.js', 'adapters/workday.js',
    'content/scan.js', 'content/multiselect.js', 'content/fill.js', 'content/repeaters.js', 'content/engine.js', 'content/index.js'
  ];

  const LAUNCHER_FILES = CONTENT_FILES.concat(['content/launcher.js']);

  function say(text, isError) {
    const el = $('message');
    el.textContent = text;
    el.className = isError ? 'error' : 'muted';
  }

  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.id;
  }

  async function request(message, frameId) {
    const tabId = await activeTabId();
    return frameId ? chrome.tabs.sendMessage(tabId, message, { frameId }) : chrome.tabs.sendMessage(tabId, message);
  }

  const STAT_TILES = [
    ['Filled', counts => (counts.filled || 0) + (counts.verify || 0), 'good'],
    ['Present', counts => counts.existing || 0, 'good'],
    ['Needs you', counts => counts.review || 0, 'warn'],
    ['Conflicts', counts => counts.conflict || 0, 'bad'],
    ['Failed', counts => counts.invalid || 0, 'bad']
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function tally(fields) {
    const counts = {};
    fields.forEach(field => { counts[field.status] = (counts[field.status] || 0) + 1; });
    return counts;
  }

  function renderStats(counts) {
    const stats = $('stats');
    stats.replaceChildren();
    stats.hidden = false;
    for (const [name, pick, tone] of STAT_TILES) {
      const value = pick(counts);
      const tile = element('div', `stat ${value ? tone : 'zero'}`);
      tile.append(element('b', '', String(value)), element('span', '', name));
      stats.appendChild(tile);
    }
  }

  function summaryLine(counts) {
    const get = name => counts[name] || 0;
    const parts = [`Filled ${get('filled') + get('verify')}`, `needs you ${get('review')}`, `already filled ${get('existing')}`];
    if (get('conflict')) parts.push(`conflicts ${get('conflict')}`);
    if (get('invalid')) parts.push(`not accepted ${get('invalid')}`);
    let text = `${parts.join(', ')}.`;
    if (get('optional')) text += ` Optional, left blank ${get('optional')}.`;
    return text;
  }

  function reasonText(field) {
    if (field.status === 'verify') return 'Filled with a lower confidence match, please check';
    if (field.status === 'invalid') return field.reason === 'value_mismatch'
      ? 'The page shows a different value than the one entered' : 'The page did not accept the value';
    return api.reports.describeReason(field.reason);
  }

  function focusButton(field) {
    const button = element('button', 'name', field.label || '(unlabelled field)');
    button.type = 'button';
    button.title = 'Jump to this field';
    button.addEventListener('click', () => request({ type: 'focus', index: field.index }, field.frameId));
    return button;
  }

  function reviewItem(field, onApply) {
    const item = element('li');
    const box = element('div', `item ${field.status}`);
    box.appendChild(focusButton(field));
    box.appendChild(element('span', 'tag', reasonText(field)));
    if (field.status === 'conflict') {
      const compare = element('div', 'compare');
      compare.append(element('span', '', `On the page: ${field.existing}`), element('span', '', `Saved profile: ${field.expected}`));
      const actions = element('div', 'actions');
      const use = element('button', '', 'Use saved value');
      use.type = 'button';
      use.addEventListener('click', () => onApply(field, use));
      const keep = element('button', 'quiet', 'Go to field');
      keep.type = 'button';
      keep.addEventListener('click', () => request({ type: 'focus', index: field.index }, field.frameId));
      actions.append(use, keep);
      box.append(compare, actions);
    }
    item.appendChild(box);
    return item;
  }

  function plainList(title, fields) {
    const details = document.createElement('details');
    details.appendChild(element('summary', '', `${title} (${fields.length})`));
    const list = element('ul', 'list');
    fields.forEach(field => list.appendChild(element('li', '', field.label || '(unlabelled field)')));
    details.appendChild(list);
    return details;
  }

  let lastFields = [];

  async function applySaved(field, button) {
    button.disabled = true;
    let outcome;
    try {
      outcome = await request({ type: 'apply', index: field.index }, field.frameId);
    } catch (error) {
      say(api.text.describeError(error), true);
      button.disabled = false;
      return;
    }
    const target = lastFields.find(item => item.index === field.index && item.frameId === field.frameId);
    if (target && outcome && outcome.status) target.status = outcome.status;
    if (target && outcome && !outcome.ok) target.reason = outcome.reason || 'value_mismatch';
    renderResults({ counts: tally(lastFields), fields: lastFields });
    say(outcome && outcome.ok ? `Updated ${field.label || 'the field'} to the saved value.`
      : 'Could not change that field. Edit it on the page.', !(outcome && outcome.ok));
  }

  function renderResults(response) {
    const results = $('results');
    results.replaceChildren();
    const { fields } = response;
    lastFields = fields;
    const counts = Object.assign({}, response.counts, tally(fields));
    renderStats(counts);
    say(summaryLine(counts));
    const groups = [
      ['Conflicts, review before submitting', 'conflict'],
      ['Not accepted by the page', 'invalid'],
      ['Needs your answer', 'review'],
      ['Filled, please check', 'verify']
    ];
    for (const [title, status] of groups) {
      const items = fields.filter(field => field.status === status);
      if (!items.length) continue;
      results.appendChild(element('h2', '', `${title} (${items.length})`));
      const list = element('ul', 'list');
      items.forEach(field => list.appendChild(reviewItem(field, applySaved)));
      results.appendChild(list);
    }
    const done = fields.filter(field => field.status === 'filled');
    if (done.length) results.appendChild(plainList('Filled', done));
    const present = fields.filter(field => field.status === 'existing');
    if (present.length) results.appendChild(plainList('Already filled', present));
    if (!fields.length) {
      results.appendChild(element('p', 'muted', 'No form fields were found that this extension could reach. The form may be embedded from another site.'));
    } else if (!fields.some(field => ['conflict', 'invalid', 'review', 'verify'].includes(field.status))) {
      results.appendChild(element('p', 'muted', 'Nothing needs review on this page. Check everything before you submit.'));
    }
  }

  // The latest saved report gives the tiles something to show before the
  // first fill in this popup, so statistics survive closing it.
  async function showLastRun() {
    const [latest] = await store.getReports();
    if (!latest || !latest.counts) return;
    renderStats(latest.counts);
    const source = $('source');
    source.hidden = false;
    source.textContent = `Last fill: ${latest.host || 'a page'}${latest.generatedOn ? `, ${latest.generatedOn}` : ''}`;
  }

  let frameIds = [0];

  function mergeResponses(responses) {
    const fields = [];
    responses.forEach(({ frameId, response }) => {
      (response.fields || []).forEach(field => fields.push(Object.assign({}, field, { frameId })));
    });
    return { fields, counts: {} };
  }

  // Embedded application forms need access to the frame's own site. Chrome
  // asks once for that site, and only for well known application systems.
  async function missingFrameAccess(tabId) {
    try {
      const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: api.site.listFrames });
      const tab = await chrome.tabs.get(tabId);
      const forms = api.site.embeddedForms(probe && probe.result, tab && tab.url);
      const missing = [];
      for (const form of forms) {
        if (!(await chrome.permissions.contains({ origins: [form.pattern] }))) missing.push(form);
      }
      return missing;
    } catch (error) {
      return [];
    }
  }

  function renderAccessNotice(missing) {
    const box = element('div', 'card');
    const hosts = missing.map(form => form.host).join(', ');
    box.appendChild(element('p', '', `This page embeds an application form from ${hosts}. Allow access to fill it.`));
    const allow = element('button', '', `Allow ${hosts}`);
    allow.type = 'button';
    allow.addEventListener('click', () => {
      // The permission request is the first thing the click does, so Chrome still counts it as a user gesture.
      chrome.permissions.request({ origins: missing.map(form => form.pattern) }).then(granted => {
        if (granted) fill();
        else say('Access was not granted, so the embedded form was not filled.', true);
      }, error => say(`Chrome refused the access request: ${String(error && error.message || error)}`, true));
    });
    box.appendChild(allow);
    $('results').prepend(box);
  }

  async function fill() {
    say('Filling...');
    $('results').replaceChildren();
    $('source').hidden = true;
    const tabId = await activeTabId();
    let injected;
    try {
      injected = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
    } catch (error) {
      say('This page cannot be filled. Browser pages and the Web Store are blocked. If the page just opened, scroll or reload it and try again.', true);
      return;
    }
    frameIds = Array.isArray(injected) && injected.length ? Array.from(new Set(injected.map(item => item.frameId || 0))) : [0];
    const responses = [];
    let failure = null;
    for (const frameId of frameIds) {
      try {
        responses.push({ frameId, response: await request({ type: 'fill' }, frameId) });
      } catch (error) {
        failure = failure || error;
      }
    }
    if (!responses.length) {
      say(api.text.describeError(failure), true);
      return;
    }
    if (responses.some(item => item.response && item.response.error === 'no_profile')) {
      say('Add your details in Settings first.', true);
      return;
    }
    const errored = responses.find(item => item.response && item.response.error);
    const usable = responses.filter(item => item.response && !item.response.error);
    if (!usable.length) {
      say(`Could not fill this page: ${errored.response.error}`, true);
      return;
    }
    const withFields = usable.filter(item => (item.response.fields || []).length);
    const merged = withFields.length === 1 && withFields[0].frameId === 0 && usable.length === 1
      ? Object.assign({}, withFields[0].response, { fields: withFields[0].response.fields.map(field => Object.assign({}, field, { frameId: 0 })) })
      : mergeResponses(withFields.length ? withFields : usable.slice(0, 1));
    if (merged.counts && Object.keys(merged.counts).length === 0) merged.counts = tally(merged.fields);
    renderResults(merged);
    const missing = await missingFrameAccess(tabId);
    if (missing.length) renderAccessNotice(missing);
  }

  async function learn() {
    const area = $('learn-area');
    area.replaceChildren();
    let response;
    try {
      response = { items: [] };
      for (const frameId of frameIds) {
        const part = await request({ type: 'learn' }, frameId);
        response.items = response.items.concat(part && part.items ? part.items : []);
      }
    } catch (error) {
      say('Run Fill this page first.', true);
      return;
    }
    if (!response.items.length) {
      say('No new answers to save. Fill the highlighted fields first, then check again.');
      return;
    }
    const heading = document.createElement('h2');
    heading.textContent = 'Save these answers for next time?';
    const list = document.createElement('ul');
    list.className = 'list';
    const boxes = response.items.map(item => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      const text = document.createElement('span');
      text.textContent = ` ${item.label}: ${item.value}`;
      label.append(box, text);
      li.appendChild(label);
      list.appendChild(li);
      return { box, item };
    });
    const save = document.createElement('button');
    save.textContent = 'Save selected';
    save.addEventListener('click', async () => {
      let answers = await store.getAnswers();
      for (const { box, item } of boxes) {
        if (box.checked) answers = api.answers.upsertAnswer(answers, item.label, item.value);
      }
      await store.saveAnswers(answers);
      area.replaceChildren();
      say('Answers saved on this device.');
    });
    area.append(heading, list, save);
  }

  async function latestReport() {
    const [latest] = await store.getReports();
    if (!latest) say('No report yet. Press Fill this page first.');
    return latest;
  }

  async function copyReport() {
    const report = await latestReport();
    if (!report) return;
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    say('Report copied. It lists fields and reasons only, never your answers.');
  }

  async function downloadReport() {
    const report = await latestReport();
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fill-report-${report.host || 'page'}-${report.generatedOn}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    say('Report downloaded. It lists fields and reasons only, never your answers.');
  }

  // The tab is looked up ahead of time so the permission request is the first
  // thing the click does and Chrome still counts it as a user gesture.
  let activeTab = null;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { activeTab = tab; });

  async function enableSite() {
    try {
      const tab = activeTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const result = await api.site.enableOnTab(chrome, tab, LAUNCHER_FILES);
      say(result.message, !result.ok);
    } catch (error) {
      say(`Could not add the page button: ${String(error && error.message || error)}`, true);
    }
  }

  async function showProfileStatus() {
    const profile = await store.getProfile();
    const described = api.profile.describeProfile(profile);
    const text = $('profile-status');
    const chip = $('profile-chip');
    if (described.state === 'missing') {
      text.textContent = 'No profile yet. Open Settings and run Quick Setup.';
      chip.className = 'chip missing';
      return;
    }
    const name = api.profile.getValue(profile, 'fullName') || profile.personal.email;
    if (described.state === 'incomplete') {
      text.textContent = `${name}. Missing: ${described.missing.join(', ')}.`;
      chip.className = 'chip incomplete';
      return;
    }
    text.textContent = `${name}. Profile ready.`;
    chip.className = 'chip ready';
  }

  async function showRole() {
    $('role').value = await store.getRole();
  }

  $('role').addEventListener('change', () => store.saveRole($('role').value));
  $('fill').addEventListener('click', fill);
  $('enable-site').addEventListener('click', enableSite);
  $('learn').addEventListener('click', learn);
  $('copy-report').addEventListener('click', copyReport);
  $('download-report').addEventListener('click', downloadReport);
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('profile-chip').addEventListener('click', () => chrome.runtime.openOptionsPage());
  showProfileStatus().catch(error => say(api.text.describeError(error), true));
  showRole();
  showLastRun().catch(() => {});
})();
