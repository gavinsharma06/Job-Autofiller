const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ui = file => path.join(__dirname, '../ui', file);
const example = fs.readFileSync(path.join(__dirname, '../profile.example.json'), 'utf8');

function sharedChrome(data, extra) {
  return Object.assign({
    storage: {
      local: {
        async get(key) { return key in data ? { [key]: data[key] } : {}; },
        async set(items) { Object.assign(data, JSON.parse(JSON.stringify(items))); },
        async clear() { Object.keys(data).forEach(key => delete data[key]); }
      }
    }
  }, extra);
}

async function openPage(file, chromeApi, prepare) {
  const dom = await JSDOM.fromFile(ui(file), {
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) {
      window.chrome = chromeApi;
      if (prepare) prepare(window);
    }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  await settle();
  return dom;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

function field(doc, selector) {
  return doc.querySelector(selector);
}

function type(el, value) {
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true }));
}

function importFile(dom, text) {
  const input = dom.window.document.getElementById('import-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => text }] });
  input.dispatchEvent(new dom.window.Event('change'));
}

test('options page: manual edits are saved to chrome.storage.local and survive a reload', async () => {
  const data = {};
  const first = await openPage('options.html', sharedChrome(data));
  const doc = first.window.document;
  type(field(doc, '[data-section="personal"][data-key="firstName"]'), 'Jane');
  type(field(doc, '[data-section="personal"][data-key="email"]'), 'jane.sample@example.com');
  [...doc.querySelectorAll('button')].find(button => button.textContent === 'Add education entry').click();
  type(field(doc, '[data-list="education"][data-index="0"][data-key="school"]'), 'Example University');
  doc.getElementById('save').click();
  await settle();

  assert.equal(data.profile.personal.firstName, 'Jane');
  assert.equal(data.profile.education[0].school, 'Example University');
  assert.equal(doc.getElementById('status').textContent, 'Saved on this device.');
  first.window.close();

  const second = await openPage('options.html', sharedChrome(data));
  const reloaded = second.window.document;
  assert.equal(field(reloaded, '[data-section="personal"][data-key="email"]').value, 'jane.sample@example.com');
  assert.equal(field(reloaded, '[data-list="education"][data-index="0"][data-key="school"]').value, 'Example University');
});

test('options page: blank cards are dropped on save and entries can be removed', async () => {
  const data = {};
  const dom = await openPage('options.html', sharedChrome(data));
  const doc = dom.window.document;
  const addJob = () => [...doc.querySelectorAll('button')].find(button => button.textContent === 'Add job').click();
  addJob();
  addJob();
  type(field(doc, '[data-list="employment"][data-index="1"][data-key="employer"]'), 'Acme Cafe');
  [...doc.querySelectorAll('.card button')].find(button => button.textContent === 'Remove').click();
  doc.getElementById('save').click();
  await settle();
  assert.deepEqual(data.profile.employment.map(job => job.employer), ['Acme Cafe']);
});

test('options page: importing a JSON profile fills the form and persists on save', async () => {
  const data = {};
  const dom = await openPage('options.html', sharedChrome(data));
  const doc = dom.window.document;
  importFile(dom, example);
  await settle();
  assert.equal(field(doc, '[data-section="address"][data-key="city"]').value, 'Halifax');
  assert.equal(field(doc, '[data-list="employment"][data-index="0"][data-key="employer"]').value, 'Example Cafe');
  assert.equal(data.profile, undefined);

  doc.getElementById('save').click();
  await settle();
  assert.equal(data.profile.personal.lastName, 'Sample');
  assert.equal(data.profile.education[0].gpa, '3.5');
});

test('options page: unknown keys in an import are dropped and bad files are rejected', async () => {
  const data = {};
  const dom = await openPage('options.html', sharedChrome(data));
  const doc = dom.window.document;
  importFile(dom, JSON.stringify({ personal: { firstName: 'Jane', password: 'hunter2' }, token: 'abc' }));
  await settle();
  doc.getElementById('save').click();
  await settle();
  assert.equal(data.profile.personal.firstName, 'Jane');
  assert.equal(JSON.stringify(data).includes('hunter2'), false);
  assert.equal('token' in data.profile, false);

  importFile(dom, 'not json');
  await settle();
  assert.equal(doc.getElementById('status').textContent, 'That file is not a valid profile.');
  assert.equal(field(doc, '[data-section="personal"][data-key="firstName"]').value, 'Jane');
});

test('options page: delete all data clears storage', async () => {
  const data = { profile: JSON.parse(example), answers: [{ question: 'x', label: 'Notice period', answer: '2 weeks' }] };
  const dom = await openPage('options.html', sharedChrome(data), window => { window.confirm = () => true; });
  dom.window.document.getElementById('clear').click();
  await settle();
  assert.deepEqual(data, {});
});

function popupChrome(data, response) {
  const sent = [];
  return {
    sent,
    api: sharedChrome(data, {
      runtime: { openOptionsPage() {} },
      tabs: {
        async query() { return [{ id: 7 }]; },
        async sendMessage(tabId, message) { sent.push(message.type); return response; }
      },
      scripting: { async executeScript() {} }
    })
  };
}

const FILL_RESPONSE = {
  counts: { filled: 2, verify: 1, existing: 1, review: 1 },
  fields: [
    { index: 0, label: 'First Name', status: 'filled', reason: '', via: 'label' },
    { index: 1, label: 'Email', status: 'filled', reason: '', via: 'label' },
    { index: 2, label: 'LinkedIn', status: 'verify', reason: '', via: 'label' },
    { index: 3, label: 'Salary expectations', status: 'review', reason: 'no_match', via: '' },
    { index: 4, label: 'Phone', status: 'existing', reason: '', via: '' }
  ]
};

test('popup: summarises filled and skipped fields with reasons', async () => {
  const data = { profile: JSON.parse(example) };
  const { api, sent } = popupChrome(data, FILL_RESPONSE);
  const dom = await openPage('popup.html', api);
  const doc = dom.window.document;
  doc.getElementById('fill').click();
  await settle();
  assert.deepEqual(sent, ['fill']);
  assert.match(doc.getElementById('message').textContent, /Filled 3, needs you 1, already filled 1/);
  assert.match(doc.getElementById('results').textContent, /Salary expectations/);
  assert.match(doc.getElementById('results').textContent, /No matching profile field/);
  assert.match(doc.querySelector('details summary').textContent, /Filled \(2\)/);
});

test('popup: copy and download produce the same sanitized report', async () => {
  const report = {
    generatedOn: '2026-11-14', host: 'careers.example.com', ats: 'workday',
    counts: { filled: 1, verify: 0, existing: 0, review: 1 },
    fields: [{ label: 'Salary expectations', status: 'review', reason: 'no_match' }]
  };
  const data = { profile: JSON.parse(example), reports: [report] };
  const { api } = popupChrome(data, {});
  let copied = null;
  let download = null;
  const dom = await openPage('popup.html', api, window => {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
    window.URL.createObjectURL = () => 'blob:test';
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function click() { download = this.download; };
  });
  const doc = dom.window.document;
  doc.getElementById('copy-report').click();
  await settle();
  assert.deepEqual(JSON.parse(copied), report);
  assert.equal(copied.includes('jane.sample'), false);

  doc.getElementById('download-report').click();
  await settle();
  assert.equal(download, 'fill-report-careers.example.com-2026-11-14.json');
});

test('popup: asks for a profile before filling', async () => {
  const { api } = popupChrome({}, { error: 'no_profile' });
  const dom = await openPage('popup.html', api);
  const doc = dom.window.document;
  doc.getElementById('fill').click();
  await settle();
  assert.match(doc.getElementById('message').textContent, /Add your details in Settings/);
});
