(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const $ = id => document.getElementById(id);

  const CONTENT_FILES = [
    'core/text.js', 'core/profile.js', 'core/matcher.js', 'core/answers.js', 'core/reports.js',
    'storage/store.js', 'adapters/workday.js',
    'content/scan.js', 'content/fill.js', 'content/engine.js', 'content/index.js'
  ];

  const LAUNCHER_FILES = CONTENT_FILES.concat(['content/launcher.js']);
  const WORKDAY_HOST = /(^|\.)myworkdayjobs\.com$/i;

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
    say(`Filled ${counts.filled + counts.verify}, needs you ${counts.review}, already filled ${counts.existing}.`);
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
    const response = await request({ type: 'fill' });
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

  // One click per site: ask Chrome for access to just this site, then register
  // the page button there. Nothing is read or changed anywhere else.
  async function enableSite() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let url;
    try {
      url = new URL(tab.url);
    } catch (error) {
      say('This page cannot have a button.', true);
      return;
    }
    if (url.protocol !== 'https:') {
      say('The page button works on secure (https) sites only.', true);
      return;
    }
    const pattern = WORKDAY_HOST.test(url.hostname) ? '*://*.myworkdayjobs.com/*' : `${url.origin}/*`;
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      say('Access was not granted, so no button was added.', true);
      return;
    }
    const id = `jaf-${pattern.replace(/[^a-z0-9]+/gi, '-')}`;
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (!existing.length) {
      await chrome.scripting.registerContentScripts([{
        id, matches: [pattern], js: LAUNCHER_FILES, runAt: 'document_idle', persistAcrossSessions: true
      }]);
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: LAUNCHER_FILES });
    say(`Button added on ${pattern.replace('*://', '').replace('/*', '')}. Press Alt+Shift+F or use the button on the page.`);
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

  $('fill').addEventListener('click', fill);
  $('enable-site').addEventListener('click', enableSite);
  $('learn').addEventListener('click', learn);
  $('copy-report').addEventListener('click', copyReport);
  $('download-report').addEventListener('click', downloadReport);
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  showProfileStatus();
})();
