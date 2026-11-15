const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const profileApi = require('../core/profile');
const { sampleProfile } = require('./helpers');

const root = path.join(__dirname, '..');
const popupSource = fs.readFileSync(path.join(root, 'ui/popup.js'), 'utf8');
const files = /CONTENT_FILES = \[([\s\S]*?)\];/.exec(popupSource)[1].match(/'[^']+'/g).map(item => item.slice(1, -1))
  .concat(['content/launcher.js']);

function openPage(html, stored) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://careers.example.com/apply', runScripts: 'outside-only' });
  const data = Object.assign({}, stored);
  const shadows = [];
  const original = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (init) {
    const shadow = original.call(this, init);
    shadows.push(shadow);
    return shadow;
  };
  dom.window.chrome = {
    runtime: { getManifest: () => ({ version: '0.2.0' }), onMessage: { addListener: () => {} } },
    storage: { local: {
      async get(key) { return key in data ? { [key]: data[key] } : {}; },
      async set(items) { Object.assign(data, items); }
    } }
  };
  dom.window.Element.prototype.scrollIntoView = () => {};
  files.forEach(file => dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8')));
  const host = dom.window.document.querySelector('[data-job-autofiller="launcher"]');
  return { dom, data, host, shadow: shadows[0], doc: dom.window.document };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const report = host => JSON.parse(host.getAttribute('data-report'));

test('describeProfile reports missing, incomplete and ready profiles', () => {
  assert.deepEqual(profileApi.describeProfile(profileApi.emptyProfile()), { state: 'missing', missing: [] });
  const partial = profileApi.normalizeProfile({ personal: { firstName: 'Jane', lastName: 'Sample', email: 'j@example.com', phone: '1' }, address: { city: 'Halifax', country: 'Canada' } });
  assert.deepEqual(profileApi.describeProfile(partial), { state: 'incomplete', missing: ['Address line 1', 'Province or state', 'Postal code'] });
  assert.equal(profileApi.describeProfile(sampleProfile()).state, 'ready');
});

test('launcher is added to the page and says when no profile is saved', async () => {
  const { host, shadow } = openPage('<label for="e">Email</label><input id="e" type="email">', {});
  await settle();
  assert.ok(host);
  assert.match(shadow.textContent, /No profile saved/);
  assert.equal(report(host).error, 'no_profile');
});

test('launcher names the essential fields an incomplete profile lacks', async () => {
  const profile = sampleProfile();
  profile.address.line1 = '';
  profile.address.postalCode = '';
  const { host } = openPage('<input>', { profile });
  await settle();
  assert.deepEqual(report(host).missingProfile, ['Address line 1', 'Postal code']);
});

test('a real click fills the form and publishes a value free summary', async () => {
  const { dom, doc, host, shadow, data } = openPage(
    '<label for="e">Email</label><input id="e" type="email"><label for="q">Favourite colour</label><input id="q">',
    { profile: sampleProfile() }
  );
  await settle();
  dom.window.JobAutofiller.trust = () => true;
  shadow.querySelector('button').click();
  await settle();
  assert.equal(doc.getElementById('e').value, 'jane.sample@example.com');
  const summary = report(host);
  assert.equal(summary.counts.filled, 1);
  assert.equal(summary.counts.review, 1);
  assert.equal(host.getAttribute('data-report').includes('jane.sample'), false);
  assert.equal(data.reports.length, 1);
});

test('scripted events from the page cannot start a fill', async () => {
  const { dom, doc, shadow } = openPage('<label for="e">Email</label><input id="e" type="email">', { profile: sampleProfile() });
  await settle();
  shadow.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyF', altKey: true, shiftKey: true, bubbles: true }));
  await settle();
  assert.equal(doc.getElementById('e').value, '');

  dom.window.JobAutofiller.trust = () => true;
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyF', altKey: true, shiftKey: true, bubbles: true }));
  await settle();
  assert.equal(doc.getElementById('e').value, 'jane.sample@example.com');
});

test('filling never clicks a submit button or submits the form', async () => {
  const { dom, doc, shadow } = openPage(
    '<form id="f"><label for="e">Email</label><input id="e" type="email"><button id="go" type="submit">Submit application</button></form>',
    { profile: sampleProfile() }
  );
  let submitted = 0;
  let clicked = 0;
  doc.getElementById('f').addEventListener('submit', event => { submitted += 1; event.preventDefault(); });
  doc.getElementById('go').addEventListener('click', () => { clicked += 1; });
  await settle();
  dom.window.JobAutofiller.trust = () => true;
  shadow.querySelector('button').click();
  await settle();
  assert.equal(doc.getElementById('e').value, 'jane.sample@example.com');
  assert.equal(submitted, 0);
  assert.equal(clicked, 0);
});

test('after the extension reloads the launcher says to refresh the page', async () => {
  const { dom, shadow, host } = openPage('<label for="e">Email</label><input id="e" type="email">', { profile: sampleProfile() });
  await settle();
  dom.window.chrome.storage.local.get = async () => { throw new Error('Extension context invalidated.'); };
  dom.window.JobAutofiller.trust = () => true;
  shadow.querySelector('button').click();
  await settle();
  assert.match(shadow.textContent, /Refresh this page/);
  assert.equal(host.getAttribute('data-report').includes('Refresh this page'), true);
});

test('optional fields are counted apart from fields that need you', async () => {
  const { dom, shadow, host } = openPage(
    '<label for="e">Email*</label><input id="e" type="email"><label for="q">Middle Name</label><input id="q"><label for="w">Why us?*</label><input id="w">',
    { profile: sampleProfile() }
  );
  await settle();
  dom.window.JobAutofiller.trust = () => true;
  shadow.querySelector('button').click();
  await settle();
  const { counts } = report(host);
  assert.equal(counts.review, 1);
  assert.equal(counts.optional, 1);
  assert.match(shadow.textContent, /Optional, left blank 1/);
});
