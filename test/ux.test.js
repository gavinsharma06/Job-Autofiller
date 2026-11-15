const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { sampleProfile } = require('./helpers');

const root = path.join(__dirname, '..');
const ui = file => path.join(root, 'ui', file);
const example = JSON.parse(fs.readFileSync(path.join(root, 'profile.example.json'), 'utf8'));
const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

const popupSource = fs.readFileSync(path.join(root, 'ui/popup.js'), 'utf8');
const contentFiles = /CONTENT_FILES = \[([\s\S]*?)\];/.exec(popupSource)[1].match(/'[^']+'/g).map(item => item.slice(1, -1))
  .concat(['content/launcher.js']);

function storageFor(data) {
  return {
    async get(key) { return key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {}; },
    async set(items) { Object.assign(data, JSON.parse(JSON.stringify(items))); },
    async clear() { Object.keys(data).forEach(key => delete data[key]); }
  };
}

function openLauncher(data) {
  const dom = new JSDOM('<!doctype html><body><label for="e">Email</label><input id="e" type="email"></body>',
    { url: 'https://careers.example.com/apply', runScripts: 'outside-only' });
  const shadows = [];
  const original = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function attach(init) {
    const shadow = original.call(this, init);
    shadows.push(shadow);
    return shadow;
  };
  dom.window.chrome = {
    runtime: { getManifest: () => ({ version: '0.2.0' }), onMessage: { addListener: () => {} } },
    storage: { local: storageFor(data) }
  };
  dom.window.Element.prototype.scrollIntoView = () => {};
  contentFiles.forEach(file => dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8')));
  const shadow = shadows[0];
  return { dom, shadow, data, doc: dom.window.document, box: shadow.querySelector('.box'), grip: shadow.querySelector('.grip') };
}

function pointer(dom, target, type, x, y) {
  target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}

test('launcher: dragging the grip moves it, keeps it on screen and remembers the spot for this site', async () => {
  const { dom, box, grip, data, doc } = openLauncher({ profile: sampleProfile() });
  await settle();
  const startLeft = parseFloat(box.style.left);
  pointer(dom, grip, 'pointerdown', startLeft + 5, 250);
  pointer(dom, grip, 'pointermove', 205, 120);
  pointer(dom, grip, 'pointerup', 205, 120);
  assert.equal(parseFloat(box.style.left), 200);
  assert.ok(parseFloat(box.style.left) < startLeft);
  await settle();
  assert.equal(data.launcherPlacement['careers.example.com'].minimized, false);
  assert.equal(data.launcherPlacement['careers.example.com'].x, Math.round(parseFloat(box.style.left)));

  pointer(dom, grip, 'pointerdown', 200, 120);
  pointer(dom, grip, 'pointermove', -900, -900);
  pointer(dom, grip, 'pointerup', -900, -900);
  assert.equal(parseFloat(box.style.left), 6);
  assert.equal(parseFloat(box.style.top), 6);
  assert.equal(doc.getElementById('e').value, '', 'dragging never starts a fill');
});

test('launcher: arrow keys on the grip move it', async () => {
  const { dom, box, grip } = openLauncher({});
  await settle();
  const before = parseFloat(box.style.left);
  grip.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(parseFloat(box.style.left), before - 10);
});

test('launcher: minimizing keeps Fill first, named and working, and is remembered', async () => {
  const { dom, shadow, doc, data } = openLauncher({ profile: sampleProfile() });
  await settle();
  const fillButton = shadow.querySelector('button');
  assert.equal(fillButton.getAttribute('data-action'), 'fill');
  shadow.querySelector('[data-action="minimize"]').click();
  assert.equal(shadow.querySelector('.box').classList.contains('mini'), true);
  const after = shadow.querySelector('button');
  assert.equal(after, fillButton);
  assert.equal(after.getAttribute('aria-label'), 'Job Autofiller: fill this page');
  await settle();
  assert.equal(data.launcherPlacement['careers.example.com'].minimized, true);

  dom.window.JobAutofiller.trust = () => true;
  after.click();
  await settle();
  assert.equal(doc.getElementById('e').value, 'jane.sample@example.com');
});

test('launcher: a saved placement and minimized state are restored on load', async () => {
  const data = { profile: sampleProfile(), launcherPlacement: { 'careers.example.com': { x: 120, y: 140, minimized: true } } };
  const { box, shadow } = openLauncher(data);
  await settle();
  assert.equal(parseFloat(box.style.left), 120);
  assert.equal(parseFloat(box.style.top), 140);
  assert.equal(box.classList.contains('mini'), true);
  assert.equal(shadow.querySelector('button').textContent, 'Fill');
});

test('launcher: scripted pointer events from the page still cannot start a fill', async () => {
  const { dom, shadow, doc } = openLauncher({ profile: sampleProfile() });
  await settle();
  shadow.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal(doc.getElementById('e').value, '');
});

async function openUi(file, data, extra, prepare) {
  const dom = await JSDOM.fromFile(ui(file), {
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) {
      window.chrome = Object.assign({ storage: { local: storageFor(data) } }, extra);
      if (prepare) prepare(window);
    }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  await settle(40);
  return dom;
}

const CONFLICT_RESPONSE = {
  counts: { filled: 1, existing: 1, review: 1, conflict: 1, invalid: 1 },
  fields: [
    { index: 0, label: 'Email', status: 'filled', reason: '', via: 'label' },
    { index: 1, label: 'City', status: 'conflict', reason: 'conflicts_with_profile', via: 'label', existing: 'Fredericton', expected: 'Halifax' },
    { index: 2, label: 'Phone', status: 'existing', reason: '', via: 'label' },
    { index: 3, label: 'Salary expectations', status: 'review', reason: 'no_match', via: '' },
    { index: 4, label: 'Country', status: 'invalid', reason: 'value_mismatch', via: 'label' }
  ]
};

test('popup: conflicts show both values, can be fixed on request, and statistics stay in step', async () => {
  const sent = [];
  const extra = {
    runtime: { openOptionsPage() {} },
    tabs: { async query() { return [{ id: 3 }]; }, async sendMessage(tabId, message) {
      sent.push(message.type);
      return message.type === 'apply' ? { ok: true, status: 'filled' } : CONFLICT_RESPONSE;
    } },
    scripting: { async executeScript() {} }
  };
  const dom = await openUi('popup.html', { profile: example }, extra);
  const doc = dom.window.document;
  assert.match(doc.getElementById('profile-status').textContent, /Profile ready/);
  doc.getElementById('fill').click();
  await settle();
  const text = doc.getElementById('results').textContent;
  assert.match(text, /On the page: Fredericton/);
  assert.match(text, /Saved profile: Halifax/);
  assert.match(text, /left unchanged/);
  assert.match(text, /different value than the one entered/);
  const tiles = [...doc.querySelectorAll('.stat')].map(tile => `${tile.querySelector('span').textContent}:${tile.querySelector('b').textContent}`);
  assert.deepEqual(tiles, ['Filled:1', 'Present:1', 'Needs you:1', 'Conflicts:1', 'Failed:1']);

  [...doc.querySelectorAll('button')].find(button => button.textContent === 'Use saved value').click();
  await settle();
  assert.deepEqual(sent, ['fill', 'apply']);
  assert.equal([...doc.querySelectorAll('.stat')].map(tile => tile.querySelector('b').textContent).join(','), '2,1,1,0,1');
  assert.match(doc.getElementById('message').textContent, /Updated City to the saved value/);
});

test('popup: a primary Fill action is first, and secondary actions are tucked into More', async () => {
  const dom = await openUi('popup.html', { profile: example }, { runtime: { openOptionsPage() {} }, tabs: { async query() { return [{ id: 1 }]; } } });
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('button.primary').length, 1);
  const more = doc.getElementById('more');
  ['enable-site', 'learn', 'copy-report', 'download-report', 'role'].forEach(id => assert.ok(more.contains(doc.getElementById(id)), id));
});

test('popup: shows the statistics of the last saved fill before any new fill', async () => {
  const report = { generatedOn: '2026-11-15', host: 'careers.example.com', counts: { filled: 4, existing: 2, review: 1, conflict: 1, invalid: 0 }, fields: [] };
  const dom = await openUi('popup.html', { profile: example, reports: [report] }, { runtime: { openOptionsPage() {} }, tabs: { async query() { return [{ id: 1 }]; } } });
  const doc = dom.window.document;
  assert.equal(doc.getElementById('stats').hidden, false);
  assert.match(doc.getElementById('source').textContent, /careers\.example\.com/);
});

test('settings: the banner names the empty essential fields and the form outlines them', async () => {
  const partial = JSON.parse(JSON.stringify(example));
  partial.address.line1 = '';
  partial.address.postalCode = '';
  const dom = await openUi('options.html', { profile: partial });
  const doc = dom.window.document;
  const banner = doc.getElementById('profile-banner');
  assert.equal(banner.className, 'incomplete');
  assert.match(banner.textContent, /Address line 1/);
  assert.match(banner.textContent, /Postal code/);
  assert.equal(doc.querySelectorAll('label.is-missing').length, 2);
  const line1 = doc.querySelector('[data-section="address"][data-key="line1"]');
  line1.value = '1 Example Street';
  line1.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('label.is-missing').length, 1);
  assert.equal(doc.getElementById('unsaved').hidden, false);
});

test('settings: a save that does not persist is reported as a failure', async () => {
  const data = {};
  const dom = await openUi('options.html', data, null, window => {
    window.chrome.storage.local.set = async () => {};
  });
  const doc = dom.window.document;
  doc.querySelector('[data-section="personal"][data-key="firstName"]').value = 'Jane';
  doc.getElementById('save').click();
  await settle();
  assert.match(doc.getElementById('status').textContent, /did not keep/);
  assert.equal(doc.getElementById('status').className, 'error');
});

test('settings: saved answers can be edited and the stored data check reads from storage', async () => {
  const data = { profile: example, answers: [{ question: 'notice period', label: 'Notice period', answer: '2 weeks' }] };
  const dom = await openUi('options.html', data);
  const doc = dom.window.document;
  const edit = doc.querySelector('#answers textarea');
  assert.equal(edit.value, '2 weeks');
  const save = [...doc.querySelectorAll('#answers button')].find(button => button.textContent === 'Save');
  assert.equal(save.disabled, true);
  edit.value = '4 weeks';
  edit.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(save.disabled, false);
  save.click();
  await settle();
  assert.equal(data.answers[0].answer, '4 weeks');

  doc.getElementById('verify-storage').click();
  await settle();
  const report = doc.getElementById('storage-report');
  assert.equal(report.hidden, false);
  assert.match(report.textContent, /Saved answers: 1/);
  assert.match(report.textContent, /Employment entries: 1/);
});

const site = require('../core/site');

test('site: only large embedded forms from known application systems on another host are offered', () => {
  const frames = [
    { src: 'https://job-boards.greenhouse.io/embed/job_app?for=acme', w: 900, h: 4000 },
    { src: 'https://ads.example.net/frame', w: 900, h: 400 },
    { src: 'https://boards.greenhouse.io/tiny', w: 10, h: 10 },
    { src: 'http://jobs.lever.co/insecure', w: 900, h: 900 },
    { src: 'https://careers.example.com/inner', w: 900, h: 900 },
    { src: 'not a url', w: 900, h: 900 }
  ];
  assert.deepEqual(site.embeddedForms(frames, 'https://careers.example.com/jobs'),
    [{ host: 'job-boards.greenhouse.io', pattern: 'https://job-boards.greenhouse.io/*' }]);
  assert.deepEqual(site.embeddedForms(frames, 'https://job-boards.greenhouse.io/x'), []);
});

test('popup: fills an embedded frame too, targets that frame, and asks access for a frame it cannot reach', async () => {
  const messages = [];
  const frameResponse = {
    counts: { filled: 1 },
    fields: [{ index: 0, label: 'Phone', status: 'filled', reason: '', via: 'label' }]
  };
  const requested = [];
  const extra = {
    runtime: { openOptionsPage() {} },
    tabs: {
      async query() { return [{ id: 3, url: 'https://careers.example.com/jobs' }]; },
      async get() { return { id: 3, url: 'https://careers.example.com/jobs' }; },
      async sendMessage(tabId, message, options) {
        messages.push([message.type, options && options.frameId]);
        if (options && options.frameId === 9) return frameResponse;
        return { counts: {}, fields: [] };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.func) return [{ result: [{ src: 'https://job-boards.greenhouse.io/embed/job_app', w: 900, h: 3000 }] }];
        return [{ frameId: 0 }, { frameId: 9 }];
      }
    },
    permissions: {
      async contains() { return false; },
      async request(query) { requested.push(query); return true; }
    }
  };
  const dom = await openUi('popup.html', { profile: example }, extra);
  const doc = dom.window.document;
  doc.getElementById('fill').click();
  await settle(120);
  assert.deepEqual(messages.filter(item => item[0] === 'fill'), [['fill', undefined], ['fill', 9]]);
  assert.match(doc.getElementById('results').textContent, /Filled \(1\)/);
  assert.match(doc.getElementById('results').textContent, /job-boards\.greenhouse\.io/);

  [...doc.querySelectorAll('button')].find(button => /^Allow /.test(button.textContent)).click();
  await settle(120);
  // The objects come from the page's realm, so they are compared as JSON.
  assert.equal(JSON.stringify(requested), JSON.stringify([{ origins: ['https://job-boards.greenhouse.io/*'] }]));
});
