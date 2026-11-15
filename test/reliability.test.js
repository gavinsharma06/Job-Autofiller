const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../content/engine');
const reports = require('../core/reports');
const values = require('../core/values');
const { normalizeProfile } = require('../core/profile');
const { makeDom, sampleProfile, wireListboxes } = require('./helpers');

const TIMING = { timing: { timeout: 200, interval: 5 } };
const run = (doc, profile) => engine.fillPage(doc, profile || sampleProfile(), [], TIMING);
const byId = (result, id) => result.results.find(item => item.field.el.id === id);

// Sanitized shapes of the failures seen on real applications. All data is fictional.

test('Field of Study text box holding another subject is a conflict and stays untouched', async () => {
  const dom = makeDom('<label for="fos">Field of Study*</label><input id="fos" value="Information Technology">');
  const doc = dom.window.document;
  const result = await run(doc);
  const item = byId(result, 'fos');
  assert.equal(item.status, 'conflict');
  assert.equal(item.reason, 'conflicts_with_profile');
  assert.equal(item.existing, 'Information Technology');
  assert.equal(item.expected, 'Computer Science');
  assert.equal(doc.getElementById('fos').value, 'Information Technology');
  assert.equal(doc.getElementById('fos').getAttribute('data-jaf'), 'conflict');
});

test('Field of Study dropdown with a different selected option is a conflict, a matching one is present', async () => {
  const html = value => `<label for="f">Field of Study</label><select id="f">
    <option value="">Select</option><option value="bus">Business Administration</option>
    <option value="cs">Computer Science</option></select>`.replace(`value="${value}"`, `value="${value}" selected`);
  const wrong = makeDom(html('bus')).window.document;
  const conflict = byId(await run(wrong), 'f');
  assert.equal(conflict.status, 'conflict');
  assert.equal(wrong.getElementById('f').value, 'bus');

  const right = makeDom(html('cs')).window.document;
  assert.equal(byId(await run(right), 'f').status, 'existing');
});

test('City holding a different city is a conflict, formatting differences are not', async () => {
  const wrong = makeDom('<label for="c">City</label><input id="c" value="Fredericton">').window.document;
  const conflict = byId(await run(wrong), 'c');
  assert.equal(conflict.status, 'conflict');
  assert.equal(wrong.getElementById('c').value, 'Fredericton');

  for (const same of ['halifax', 'Halifax, NS', ' Halifax ']) {
    const doc = makeDom(`<label for="c">City</label><input id="c" value="${same}">`).window.document;
    assert.equal(byId(await run(doc), 'c').status, 'existing', same);
  }
});

test('a No answer default is not an answer: native select, custom dropdown and radio group', async () => {
  const dom = makeDom(`
    <label for="s">State of residence</label>
    <select id="s"><option value="0" selected>No answer</option><option value="ns">Nova Scotia</option><option value="on">Ontario</option></select>
    <label for="b">Province*</label>
    <button id="b" type="button" aria-haspopup="listbox" data-options='["Nova Scotia","Ontario"]'>No answer</button>`);
  const doc = dom.window.document;
  wireListboxes(doc);
  const result = await run(doc);
  assert.equal(byId(result, 's').status, 'filled');
  assert.equal(doc.getElementById('s').value, 'ns');
  assert.equal(byId(result, 'b').status, 'filled');
  assert.equal(doc.getElementById('b').textContent, 'Nova Scotia');
});

test('a No answer default stays unanswered when the profile has no value', async () => {
  const profile = sampleProfile();
  profile.address.region = '';
  const doc = makeDom(`<label for="s">State of residence</label>
    <select id="s"><option value="0" selected>No answer</option><option value="ns">Nova Scotia</option></select>`).window.document;
  const item = byId(await run(doc, profile), 's');
  assert.equal(item.status, 'review');
  assert.equal(item.reason, 'no_profile_value');
  assert.equal(doc.getElementById('s').value, '0');
});

test('a region code on the page agrees with the full province name', async () => {
  const doc = makeDom('<label for="p">Province</label><input id="p" value="NS">').window.document;
  assert.equal(byId(await run(doc), 'p').status, 'existing');
  const other = makeDom('<label for="p">Province</label><input id="p" value="ON">').window.document;
  assert.equal(byId(await run(other), 'p').status, 'conflict');
});

test('a Workday dropdown showing another province is a conflict', async () => {
  const dom = makeDom(`<label for="prov">Province*</label>
    <button id="prov" type="button" aria-haspopup="listbox" data-automation-id="addressSection_countryRegion">Ontario</button>`,
  'https://acme.wd3.myworkdayjobs.com/en-US/careers/apply');
  const item = byId(await run(dom.window.document), 'prov');
  assert.equal(item.status, 'conflict');
  assert.equal(item.expected, 'Nova Scotia');
});

test('a value the page resets is invalid, not filled', async () => {
  const dom = makeDom('<label for="e">Email</label><input id="e">');
  const doc = dom.window.document;
  doc.getElementById('e').addEventListener('input', event => { event.target.value = ''; });
  const item = byId(await run(doc), 'e');
  assert.equal(item.status, 'invalid');
  assert.equal(item.reason, 'rejected_by_page');
});

test('a value the page rewrites to something else is invalid', async () => {
  const dom = makeDom('<label for="e">Email</label><input id="e">');
  const doc = dom.window.document;
  doc.getElementById('e').addEventListener('input', event => { event.target.value = 'other@example.org'; });
  const item = byId(await run(doc), 'e');
  assert.equal(item.status, 'invalid');
  assert.equal(item.reason, 'value_mismatch');
});

test('a select that snaps back after the change is invalid', async () => {
  const dom = makeDom(`<label for="s">Country</label><select id="s"><option value="">Select</option>
    <option value="CA">Canada</option><option value="US">United States</option></select>`);
  const doc = dom.window.document;
  doc.getElementById('s').addEventListener('change', event => { event.target.value = ''; });
  const item = byId(await run(doc), 's');
  assert.equal(item.status, 'invalid');
});

test('a radio the page unchecks is invalid', async () => {
  const dom = makeDom(`<fieldset><legend>Country</legend>
    <label><input type="radio" name="c" id="r1" value="Canada"> Canada</label>
    <label><input type="radio" name="c" id="r2" value="Other"> Other</label></fieldset>`);
  const doc = dom.window.document;
  doc.querySelectorAll('input[type="radio"]').forEach(radio => radio.addEventListener('click', () => { radio.checked = false; }));
  const item = run(doc).then(result => result.results.find(entry => entry.kind === 'radio'));
  assert.equal((await item).status, 'invalid');
});

test('a custom dropdown that shows a different option than the one clicked is invalid', async () => {
  const dom = makeDom(`<label for="b">Country*</label>
    <button id="b" type="button" aria-haspopup="listbox" data-options='["Canada","India"]'>Select One</button>`);
  const doc = dom.window.document;
  wireListboxes(doc);
  const button = doc.getElementById('b');
  button.addEventListener('click', () => {
    const option = doc.querySelector('[role="option"]');
    option.addEventListener('click', () => { setTimeout(() => { button.textContent = 'India'; }, 0); });
  });
  const item = byId(await run(doc), 'b');
  assert.equal(item.status, 'invalid');
  assert.equal(item.reason, 'value_mismatch');
});

test('applying a conflict is explicit and verified, and Fill itself never overwrites', async () => {
  const dom = makeDom('<label for="c">City</label><input id="c" value="Fredericton">');
  const doc = dom.window.document;
  const result = await run(doc);
  const item = byId(result, 'c');
  assert.equal(doc.getElementById('c').value, 'Fredericton');
  const outcome = await engine.applyConflict(item, TIMING.timing);
  assert.equal(outcome.ok, true);
  assert.equal(doc.getElementById('c').value, 'Halifax');
  assert.equal(item.status, 'filled');
});

test('reports count conflicts and invalid fields and never hold the values', async () => {
  const dom = makeDom(`<label for="c">City</label><input id="c" value="Fredericton">
    <label for="e">Email</label><input id="e">`);
  const doc = dom.window.document;
  doc.getElementById('e').addEventListener('input', event => { event.target.value = ''; });
  const result = await run(doc);
  const report = reports.buildReport({ host: 'careers.example.com', ats: 'generic', results: result.results, profile: sampleProfile() });
  assert.equal(report.counts.conflict, 1);
  assert.equal(report.counts.invalid, 1);
  const text = JSON.stringify(report);
  assert.equal(text.includes('Fredericton'), false);
  assert.equal(text.includes('Halifax'), false);
  assert.equal(report.skipReasons.conflicts_with_profile, 1);
});

test('values: placeholders are recognised and real answers are not', () => {
  for (const text of ['', ' ', 'No answer', 'no response', '-- Select --', 'Select One', 'Please select', '--']) {
    assert.equal(values.isPlaceholder(text), true, text);
  }
  for (const text of ['Canada', 'None', 'N/A', 'Prefer not to answer', 'Nova Scotia']) {
    assert.equal(values.isPlaceholder(text), false, text);
  }
});

test('values: agreement tolerates formatting but not different content', () => {
  assert.equal(values.agrees('personal.phone', '902 555 0100', '(902) 555-0100'), true);
  assert.equal(values.agrees('address.postalCode', 'A1A 1A1', 'a1a1a1'), true);
  assert.equal(values.agrees('education.0.fieldOfStudy', 'Applied Computer Science', 'Computer Science'), true);
  assert.equal(values.agrees('education.0.fieldOfStudy', 'Computer Science', 'Information Technology'), false);
  assert.equal(values.agrees('education.0.degree', "Bachelor's Degree", 'Bachelors'), true);
  assert.equal(values.agrees('address.region', 'Nova Scotia', 'NS'), true);
  assert.equal(values.agrees('address.city', 'Halifax', 'Fredericton'), false);
  assert.equal(values.agrees('personal.phoneCountryCode', 'Canada (+1)', 'Canada'), true);
  assert.equal(values.agrees('x', '05', '5'), true);
  assert.equal(values.agrees('x', '', 'Anything'), false);
});

// Searchable dropdown whose choice is shown beside an empty search box.
const comboHtml = shown => `<div class="select__control"><label for="cc">Country*</label>
  <div class="select__value-container">${shown ? `<div class="select__single-value">${shown}</div>` : ''}
  <input id="cc" role="combobox" aria-autocomplete="list" value=""></div></div>`;

test('a searchable dropdown that already shows the profile value is present, not needing you', async () => {
  const doc = makeDom(comboHtml('Canada (+1)')).window.document;
  const profile = sampleProfile();
  profile.personal.phoneCountryCode = 'Canada (+1)';
  const item = (await run(doc, profile)).results.find(entry => entry.field.el.id === 'cc');
  assert.notEqual(item.status, 'review');
});

test('a searchable dropdown showing nothing chosen stays unanswered', async () => {
  const doc = makeDom(comboHtml('')).window.document;
  const item = (await run(doc)).results.find(entry => entry.field.el.id === 'cc');
  assert.equal(item.status, 'review');
});
