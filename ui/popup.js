(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const $ = id => document.getElementById(id);

  const CONTENT_FILES = [
    'core/text.js', 'core/profile.js', 'core/matcher.js', 'core/answers.js', 'core/reports.js',
    'core/format.js', 'core/degree.js', 'core/privatedata.js',
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

  async function request(message) {
    const tabId = await activeTabId();
    return chrome.tabs.sendMessage(tabId, message);
  }

  function fieldButton(field) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = field.label || '(unlabelled field)';
    const reason = document.createElement('span');
    reason.className = 'tag';
    reason.textContent = field.status === 'verify' ? 'Filled, please check' : api.reports.describeReason(field.reason);
    button.appendChild(reason);
    button.addEventListener('click', () => request({ type: 'focus', index: field.index }));
    item.appendChild(button);
    return item;
  }

  function renderResults(response) {
    const results = $('results');
    results.replaceChildren();
    const { counts, fields } = response;
    let summary = `Filled ${counts.filled + counts.verify}, needs you ${counts.review}, already filled ${counts.existing}.`;
    if (counts.optional) summary += ` Optional, left blank ${counts.optional}.`;
    say(summary);
    const groups = [['Needs your attention', 'review'], ['Filled, please check', 'verify']];
    const done = fields.filter(field => field.status === 'filled');
    if (done.length) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `Filled (${done.length})`;
      const list = document.createElement('ul');
      list.className = 'list';
      done.forEach(field => {
        const item = document.createElement('li');
        item.textContent = field.label || '(unlabelled field)';
        list.appendChild(item);
      });
      details.append(summary, list);
      results.appendChild(details);
    }
    for (const [title, status] of groups) {
      const items = fields.filter(field => field.status === status);
      if (!items.length) continue;
      const heading = document.createElement('h2');
      heading.textContent = `${title} (${items.length})`;
      const list = document.createElement('ul');
      list.className = 'list';
      items.forEach(field => list.appendChild(fieldButton(field)));
      results.append(heading, list);
    }
  }

  async function fill() {
    say('Filling...');
    $('results').replaceChildren();
    const tabId = await activeTabId();
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    } catch (error) {
      say('This page cannot be filled. Browser pages and the Web Store are blocked.', true);
      return;
    }
    let response;
    try {
      response = await request({ type: 'fill' });
    } catch (error) {
      say(api.text.describeError(error), true);
      return;
    }
    if (response.error === 'no_profile') {
      say('Add your details in Settings first.', true);
      return;
    }
    if (response.error) {
      say(`Could not fill this page: ${response.error}`, true);
      return;
    }
    renderResults(response);
  }

  async function learn() {
    const area = $('learn-area');
    area.replaceChildren();
    let response;
    try {
      response = await request({ type: 'learn' });
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
    const el = $('profile-status');
    if (described.state === 'missing') {
      el.textContent = 'No profile yet. Open Settings and run Quick Setup.';
      el.className = 'error';
      return;
    }
    el.textContent = `Profile: ${api.profile.getValue(profile, 'fullName') || profile.personal.email}`;
    if (described.state === 'incomplete') {
      el.textContent += `. Missing: ${described.missing.join(', ')}.`;
      el.className = 'error';
    }
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
  showProfileStatus();
  showRole();
})();
