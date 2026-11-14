const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { buildSetupPrompt } = require('../core/setupPrompt');

const root = path.join(__dirname, '..');
const example = JSON.parse(fs.readFileSync(path.join(root, 'profile.example.json'), 'utf8'));
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

function fakeChrome(data) {
  return {
    storage: {
      local: {
        async get(key) { return key in data ? { [key]: data[key] } : {}; },
        async set(items) { Object.assign(data, JSON.parse(JSON.stringify(items))); },
        async clear() { Object.keys(data).forEach(key => delete data[key]); }
      }
    }
  };
}

async function openOptions(data, prepare) {
  const dom = await JSDOM.fromFile(path.join(root, 'ui/options.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) {
      window.chrome = fakeChrome(data);
      window.confirm = () => true;
      if (prepare) prepare(window);
    }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  await settle();
  return dom;
}

const byId = (dom, id) => dom.window.document.getElementById(id);
const buttonText = (dom, text) => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === text);

async function paste(dom, value) {
  byId(dom, 'qs-input').value = typeof value === 'string' ? value : JSON.stringify(value);
  byId(dom, 'qs-review').click();
  await settle();
}

test('quick setup: paste, review, save in one pass; nothing is stored before approval', async () => {
  const data = {};
  const dom = await openOptions(data);
  await paste(dom, example);
  assert.equal(data.profile, undefined);
  const preview = byId(dom, 'qs-preview-area');
  assert.equal(preview.hidden, false);
  assert.match(preview.textContent, /Review before saving/);
  assert.ok(preview.textContent.includes('Jane'));

  buttonText(dom, 'Save approved changes').click();
  await settle();
  assert.deepEqual(data.profile, example);
  assert.equal(byId(dom, 'qs-input').value, '');
  assert.equal(byId(dom, 'qs-preview-area').hidden, true);
  assert.match(byId(dom, 'qs-status').textContent, /^Saved \d+ approved changes on this device\.$/);
  const form = dom.window.document.querySelector('[data-section="personal"][data-key="email"]');
  assert.equal(form.value, 'jane.sample@example.com');
});

test('quick setup: a partial paste works because every field is optional', async () => {
  const data = {};
  const dom = await openOptions(data);
  await paste(dom, { links: { github: 'https://github.com/example' } });
  buttonText(dom, 'Save approved changes').click();
  await settle();
  assert.equal(data.profile.links.github, 'https://github.com/example');
  assert.equal(data.profile.personal.firstName, '');
});

test('quick setup: merge keeps saved values and only adds new ones unless a change is ticked', async () => {
  const data = { profile: JSON.parse(JSON.stringify(example)) };
  const dom = await openOptions(data);
  await paste(dom, { personal: { firstName: 'Janet', preferredName: 'Jan' } });
  const boxes = [...byId(dom, 'qs-preview-area').querySelectorAll('input[type="checkbox"]')];
  assert.deepEqual(boxes.map(box => box.checked), [false, true]);
  assert.match(byId(dom, 'qs-preview-area').textContent, /Differs from your saved value/);
  buttonText(dom, 'Save approved changes').click();
  await settle();
  assert.equal(data.profile.personal.firstName, 'Jane');
  assert.equal(data.profile.personal.preferredName, 'Jan');
  assert.equal(data.profile.address.city, 'Halifax');

  await paste(dom, { personal: { firstName: 'Janet' } });
  byId(dom, 'qs-preview-area').querySelector('input[type="checkbox"]').click();
  buttonText(dom, 'Save approved changes').click();
  await settle();
  assert.equal(data.profile.personal.firstName, 'Janet');
});

test('quick setup: pasting data that already matches offers nothing to save', async () => {
  const data = { profile: JSON.parse(JSON.stringify(example)) };
  const dom = await openOptions(data);
  await paste(dom, example);
  assert.match(byId(dom, 'qs-preview-area').textContent, /Nothing new/);
  assert.equal(buttonText(dom, 'Save approved changes').disabled, true);
});

test('quick setup: replace needs a choice and a confirmation', async () => {
  const data = { profile: JSON.parse(JSON.stringify(example)) };
  let allow = false;
  const dom = await openOptions(data, window => { window.confirm = () => allow; });
  await paste(dom, { personal: { firstName: 'Only' } });
  const radio = dom.window.document.querySelector('input[name="qs-mode"][value="replace"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change'));
  assert.match(byId(dom, 'qs-preview-area').textContent, /Anything not in the paste is cleared/);

  buttonText(dom, 'Replace profile').click();
  await settle();
  assert.equal(data.profile.personal.firstName, 'Jane');

  allow = true;
  buttonText(dom, 'Replace profile').click();
  await settle();
  assert.equal(data.profile.personal.firstName, 'Only');
  assert.equal(data.profile.address.city, '');
});

test('quick setup: cancel leaves storage untouched', async () => {
  const data = { profile: JSON.parse(JSON.stringify(example)) };
  const dom = await openOptions(data);
  await paste(dom, { personal: { preferredName: 'Jan' } });
  buttonText(dom, 'Cancel').click();
  assert.equal(byId(dom, 'qs-preview-area').hidden, true);
  assert.equal(data.profile.personal.preferredName, '');
});

test('quick setup: invalid input shows a plain error and saves nothing', async () => {
  const data = {};
  const dom = await openOptions(data);
  await paste(dom, 'this is not json');
  assert.match(byId(dom, 'qs-status').textContent, /not valid JSON/);
  assert.equal(byId(dom, 'qs-status').className, 'error');
  assert.equal(byId(dom, 'qs-preview-area').hidden, true);
  await paste(dom, '');
  assert.match(byId(dom, 'qs-status').textContent, /Paste your profile/);
  assert.deepEqual(data, {});
});

test('quick setup: secrets in the paste are reported and never stored', async () => {
  const data = {};
  const dom = await openOptions(data);
  await paste(dom, { personal: { firstName: 'Jane', password: 'hunter2' }, apiKey: 'sk-test-123', links: { github: 'javascript:alert(1)' } });
  const text = byId(dom, 'qs-preview-area').textContent;
  assert.match(text, /"password" looks sensitive/);
  assert.equal(text.includes('hunter2'), false);
  buttonText(dom, 'Save approved changes').click();
  await settle();
  const stored = JSON.stringify(data);
  for (const secret of ['hunter2', 'sk-test-123', 'javascript:']) assert.equal(stored.includes(secret), false);
});

test('quick setup: pasted markup is shown as text and never becomes elements', async () => {
  const data = {};
  const dom = await openOptions(data);
  const payload = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';
  await paste(dom, { personal: { firstName: payload } });
  const preview = byId(dom, 'qs-preview-area');
  assert.equal(preview.querySelector('img, script'), null);
  assert.ok(preview.textContent.includes(payload));
  assert.equal(dom.window.pwned, undefined);
});

test('quick setup: unsaved manual edits block the save instead of being lost', async () => {
  const data = {};
  const dom = await openOptions(data);
  const first = dom.window.document.querySelector('[data-section="personal"][data-key="firstName"]');
  first.value = 'Typing';
  first.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await paste(dom, { personal: { lastName: 'Sample' } });
  buttonText(dom, 'Save approved changes').click();
  await settle();
  assert.equal(data.profile, undefined);
  assert.match(byId(dom, 'qs-status').textContent, /unsaved manual edits/);
  assert.equal(first.value, 'Typing');
});

test('quick setup: a change saved elsewhere meanwhile is not overwritten', async () => {
  const data = {};
  const dom = await openOptions(data);
  await paste(dom, { personal: { firstName: 'Jane' } });
  data.profile = { personal: { firstName: 'Changed', lastName: 'Elsewhere' } };
  buttonText(dom, 'Save approved changes').click();
  await settle();
  assert.equal(data.profile.personal.firstName, 'Changed');
  assert.equal(data.profile.personal.lastName, 'Elsewhere');
});

test('copy prompt: writes the schema prompt to the clipboard and sends no requests', async () => {
  const data = { profile: JSON.parse(JSON.stringify(example)) };
  let copied = null;
  let requests = 0;
  const dom = await openOptions(data, window => {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
    window.fetch = () => { requests++; return Promise.reject(new Error('blocked')); };
    window.XMLHttpRequest = function () { requests++; };
  });
  buttonText(dom, 'Copy AI setup prompt').click();
  await settle();
  assert.equal(copied, buildSetupPrompt());
  assert.equal(byId(dom, 'qs-prompt').textContent, copied);
  assert.equal(requests, 0);
  assert.equal(copied.includes('jane.sample@example.com'), false);
  assert.match(byId(dom, 'qs-privacy').textContent, /optional/);
  assert.match(byId(dom, 'qs-privacy').textContent, /provider's own privacy practices/);
  assert.match(byId(dom, 'qs-status').textContent, /Prompt copied/);
});

test('copy prompt: a clipboard failure points to the visible prompt', async () => {
  const dom = await openOptions({}, window => {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } });
  });
  buttonText(dom, 'Copy AI setup prompt').click();
  await settle();
  assert.match(byId(dom, 'qs-status').textContent, /Could not copy/);
});

test('manual editing, file import and export remain available', async () => {
  const dom = await openOptions({});
  for (const id of ['save', 'export', 'import', 'import-file', 'form', 'clear']) assert.ok(byId(dom, id), id);
  assert.ok(dom.window.document.querySelectorAll('#form [data-key]').length >= 16);
});
