(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const $ = id => document.getElementById(id);

  const CONTENT_FILES = [
    'core/text.js', 'core/profile.js', 'core/matcher.js', 'core/answers.js', 'core/reports.js',
    'storage/store.js', 'adapters/workday.js',
    'content/scan.js', 'content/fill.js', 'content/engine.js', 'content/index.js'
  ];

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

  async function copyReport() {
    const [latest] = await store.getReports();
    if (!latest) {
      say('No fill report yet.');
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(latest, null, 2));
    say('Report copied. It lists fields and reasons only, never your answers.');
  }

  async function showProfileStatus() {
    const profile = await store.getProfile();
    $('profile-status').textContent = api.profile.hasProfileData(profile)
      ? `Profile: ${api.profile.getValue(profile, 'fullName') || profile.personal.email}`
      : 'No profile yet. Open Settings to add your details.';
  }

  $('fill').addEventListener('click', fill);
  $('learn').addEventListener('click', learn);
  $('copy-report').addEventListener('click', copyReport);
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  showProfileStatus();
})();
