const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../content/engine');
const answersApi = require('../core/answers');
const reports = require('../core/reports');
const { normalizeProfile } = require('../core/profile');
const { makeDom, sampleProfile, wireListboxes } = require('./helpers');

const read = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const TIMING = { timing: { timeout: 300, interval: 5 } };

function statusOf(run, label) {
  return run.results.find(result => result.label === label);
}

test('generic form: fills confident fields and flags the rest', async () => {
  const dom = makeDom(read('generic.html'));
  const doc = dom.window.document;
  const run = await engine.fillPage(doc, sampleProfile(), [], TIMING);

  assert.equal(run.ats, 'generic');
  assert.equal(doc.getElementById('first_name').value, 'Jane');
  assert.equal(doc.getElementById('last_name').value, 'Sample');
  assert.equal(doc.getElementById('email').value, 'jane.sample@example.com');
  assert.equal(doc.getElementById('phone').value, '902 555 0100');
  assert.equal(doc.querySelector('input[name="linkedin"]').value, 'https://www.linkedin.com/in/example');
  assert.equal(doc.getElementById('country').value, 'CA');

  assert.equal(statusOf(run, 'First Name *').status, 'filled');
  assert.equal(statusOf(run, 'LinkedIn Profile').status, 'verify');
  assert.equal(statusOf(run, 'Why do you want to work here?').reason, 'no_match');
  assert.equal(statusOf(run, 'Salary expectations').reason, 'no_match');
  assert.equal(statusOf(run, 'Resume').reason, 'manual_upload');
  assert.equal(doc.getElementById('why').getAttribute('data-jaf'), 'review');
});

test('never submits, never ticks consent boxes, never answers sensitive fields', async () => {
  const dom = makeDom(read('generic.html'));
  const doc = dom.window.document;
  let submits = 0;
  let submitClicks = 0;
  doc.getElementById('app').addEventListener('submit', event => { submits += 1; event.preventDefault(); });
  doc.getElementById('submit').addEventListener('click', () => { submitClicks += 1; });

  const answers = answersApi.upsertAnswer([], 'Gender', 'Female');
  const forced = [{ question: 'gender', label: 'Gender', answer: 'Female' }].concat(answers);
  const run = await engine.fillPage(doc, sampleProfile(), forced, TIMING);

  assert.equal(submits, 0);
  assert.equal(submitClicks, 0);
  assert.equal(doc.getElementById('terms').checked, false);
  assert.equal(statusOf(run, 'I agree to the privacy policy').reason, 'consent');
  assert.equal(doc.getElementById('gender').value, '');
  assert.equal(statusOf(run, 'Gender').reason, 'sensitive');
});

test('existing values are never overwritten, a differing one is a conflict and a matching one is present', async () => {
  const dom = makeDom(read('generic.html'));
  const doc = dom.window.document;
  doc.getElementById('first_name').value = 'Keep';
  doc.getElementById('last_name').value = 'sample';
  const run = await engine.fillPage(doc, sampleProfile(), [], TIMING);
  assert.equal(doc.getElementById('first_name').value, 'Keep');
  assert.equal(statusOf(run, 'First Name *').status, 'conflict');
  assert.equal(doc.getElementById('last_name').value, 'sample');
  assert.equal(statusOf(run, 'Last Name *').status, 'existing');
});

test('events are dispatched so framework listeners see the change', async () => {
  const dom = makeDom(read('generic.html'));
  const doc = dom.window.document;
  const seen = [];
  const input = doc.getElementById('email');
  ['input', 'change', 'blur'].forEach(type => input.addEventListener(type, event => seen.push([event.type, event.target.value])));
  await engine.fillPage(doc, sampleProfile(), [], TIMING);
  assert.deepEqual(seen, [
    ['input', 'jane.sample@example.com'],
    ['change', 'jane.sample@example.com'],
    ['blur', 'jane.sample@example.com']
  ]);
});

test('approved answers fill text, radio and select questions', async () => {
  const dom = makeDom(read('generic.html'));
  const doc = dom.window.document;
  let saved = [];
  saved = answersApi.upsertAnswer(saved, 'Why do you want to work here?', 'The team and the product.');
  saved = answersApi.upsertAnswer(saved, 'Are you legally authorized to work in Canada?', 'Yes');
  const run = await engine.fillPage(doc, sampleProfile(), saved, TIMING);
  assert.equal(doc.getElementById('why').value, 'The team and the product.');
  assert.equal(doc.querySelector('input[name="auth"][value="yes"]').checked, true);
  assert.equal(statusOf(run, 'Why do you want to work here?').via, 'saved answer');
});

test('answers the user typed are offered for approval, not stored', async () => {
  const dom = makeDom(read('generic.html'));
  const doc = dom.window.document;
  const run = await engine.fillPage(doc, sampleProfile(), [], TIMING);
  assert.deepEqual(engine.collectLearnable(run.results), []);

  doc.getElementById('why').value = 'Because.';
  doc.getElementById('salary').value = 'Negotiable';
  doc.getElementById('gender').value = 'Female';
  doc.querySelector('input[name="auth"][value="no"]').checked = true;
  const items = engine.collectLearnable(run.results).map(item => [item.label, item.value]);
  assert.deepEqual(items, [
    ['Are you legally authorized to work in Canada?', 'No'],
    ['Why do you want to work here?', 'Because.'],
    ['Salary expectations', 'Negotiable']
  ]);
});

test('empty profile values are reported, not guessed', async () => {
  const dom = makeDom('<label for="g">GitHub URL</label><input id="g">');
  const run = await engine.fillPage(dom.window.document, sampleProfile(), [], TIMING);
  assert.equal(run.results[0].reason, 'no_profile_value');
  assert.equal(dom.window.document.getElementById('g').value, '');
});

test('a bare name label is filled but flagged, and comboboxes are not touched', async () => {
  const dom = makeDom('<label for="x">Name</label><input id="x" autocomplete="off">');
  const run = await engine.fillPage(dom.window.document, sampleProfile(), [], TIMING);
  assert.equal(run.results[0].status, 'verify');

  const clash = makeDom('<label for="y">Country</label><input id="y" role="combobox">');
  const second = await engine.fillPage(clash.window.document, sampleProfile(), [], TIMING);
  assert.equal(second.results[0].reason, 'unsupported_control');
});

test('workday: my information, custom dropdowns and repeated sections', async () => {
  const dom = makeDom(read('workday.html'), 'https://acme.wd3.myworkdayjobs.com/en-US/careers/apply');
  const doc = dom.window.document;
  wireListboxes(doc);
  const run = await engine.fillPage(doc, sampleProfile(), [], TIMING);
  const value = id => doc.getElementById(id).value;
  const text = id => doc.getElementById(id).textContent;

  assert.equal(run.ats, 'workday');
  assert.equal(value('fn'), 'Jane');
  assert.equal(value('ln'), 'Sample');
  assert.equal(value('a1'), '1 Example Street');
  assert.equal(value('city'), 'Halifax');
  assert.equal(value('pc'), 'A1A 1A1');
  assert.equal(value('ph'), '902 555 0100');
  assert.equal(text('country-btn'), 'Canada');
  assert.equal(text('prov'), 'Nova Scotia');
  assert.equal(text('pcc'), 'Canada (+1)');

  assert.equal(value('jt1'), 'Server');
  assert.equal(value('co1'), 'Acme Cafe');
  assert.equal(value('lo1'), 'Halifax, NS');
  assert.equal(doc.getElementById('cw1').checked, true);
  assert.equal(value('sm1'), '06');
  assert.equal(value('sy1'), '2026');
  assert.equal(value('em1'), '');
  assert.equal(value('rd1'), 'Served customers.');

  assert.equal(value('jt2'), 'Cook');
  assert.equal(value('co2'), 'Beta Foods');
  assert.equal(value('sm2'), '05');
  assert.equal(value('sy2'), '2024');
  assert.equal(value('rd2'), '');
  assert.equal(run.results.find(result => result.field.el.id === 'rd2').reason, 'no_profile_value');

  assert.equal(value('sc1'), 'Example University');
  assert.equal(text('dg1'), "Bachelor's Degree");
  assert.equal(value('gp1'), '3.5');
  assert.equal(value('fy1'), '2022');
  assert.equal(value('ly1'), '2026');
  assert.equal(doc.querySelector('[role="listbox"]'), null);
});

test('workday: a selected value pill listbox is not mistaken for the opened dropdown', async () => {
  const html = `
    <label for="fn">First Name*</label><input id="fn" data-automation-id="legalNameSection_firstName">
    <ul role="listbox" aria-label="items selected"><div role="option" aria-label="Canada (+1), press delete to clear value.">Canada (+1)</div></ul>
    <label for="prov">Province or Territory*</label>
    <button id="prov" type="button" aria-haspopup="listbox"
      data-options='["Select One","Alberta","Nova Scotia","Ontario"]'>Select One</button>`;
  const dom = makeDom(html, 'https://acme.wd3.myworkdayjobs.com/en-US/careers/apply');
  const doc = dom.window.document;
  wireListboxes(doc);
  const run = await engine.fillPage(doc, sampleProfile(), [], TIMING);
  assert.equal(doc.getElementById('prov').textContent, 'Nova Scotia');
  assert.equal(statusOf(run, 'Province or Territory*').status, 'filled');
});

test('workday: dropdown without a matching option is flagged and closed', async () => {
  const dom = makeDom(read('workday.html'), 'https://acme.wd3.myworkdayjobs.com/en-US/careers/apply');
  const doc = dom.window.document;
  wireListboxes(doc);
  const profile = sampleProfile();
  profile.address.region = 'Manitoba';
  const run = await engine.fillPage(doc, profile, [], TIMING);
  assert.equal(statusOf(run, 'Province*').reason, 'option_not_found');
  assert.equal(doc.getElementById('prov').textContent, 'Select One');
});

test('workday: a dropdown that never opens is reported as unsupported', async () => {
  const dom = makeDom(read('workday.html'), 'https://acme.wd3.myworkdayjobs.com/en-US/careers/apply');
  const doc = dom.window.document;
  const run = await engine.fillPage(doc, sampleProfile(), [], { timing: { timeout: 40, interval: 5 } });
  assert.equal(statusOf(run, 'Country/Region*').reason, 'unsupported_control');
  assert.equal(doc.getElementById('fn').value, 'Jane');
});

test('workday fields are not touched when the host is not workday', async () => {
  const dom = makeDom(read('workday.html'), 'https://example.com/apply');
  wireListboxes(dom.window.document);
  const run = await engine.fillPage(dom.window.document, sampleProfile(), [], TIMING);
  assert.equal(run.ats, 'generic');
  assert.equal(dom.window.document.getElementById('jt1').value, '');
});

test('fill reports never contain profile values or typed answers', async () => {
  const sentinel = normalizeProfile(JSON.parse(JSON.stringify(sampleProfile(), (key, value) =>
    (typeof value === 'string' && key !== '' && !/^\d{4}-\d{2}$/.test(value) ? `Zq${key}Vx9` : value))));
  const dom = makeDom(read('generic.html'));
  const doc = dom.window.document;
  doc.getElementById('why').value = 'TypedAnswerQw7';
  const run = await engine.fillPage(doc, sentinel, [], TIMING);
  assert.equal(doc.getElementById('first_name').value, 'ZqfirstNameVx9');

  const report = reports.buildReport({ host: 'careers.example.com', ats: run.ats, results: run.results, extensionVersion: '0.2.0' });
  const serialized = JSON.stringify(report);
  assert.equal(/Zq\w+Vx9/.test(serialized), false);
  assert.equal(serialized.includes('TypedAnswerQw7'), false);
  assert.ok(report.fields.some(item => item.reason === 'no_match'));
  assert.equal(report.counts.filled > 0, true);
});

test('reports list skipped fields with reasons and redact contact details found in labels', async () => {
  const dom = makeDom(`${read('generic.html')}<label for="conf">Confirm jane.sample@example.com is correct</label><input id="conf">`);
  const profile = sampleProfile();
  dom.window.document.getElementById('first_name').value = 'Jane';
  const run = await engine.fillPage(dom.window.document, profile, [], TIMING);
  const report = reports.buildReport({ host: 'careers.example.com', ats: run.ats, results: run.results, profile });

  assert.equal(report.counts.existing, 1);
  assert.equal(report.fields.find(item => item.label === 'First Name *').reason, 'already_filled');
  assert.ok(report.skipReasons.no_match >= 1);
  assert.equal(report.skipReasons.manual_upload, 1);
  assert.equal(JSON.stringify(report).includes('jane.sample'), false);
  assert.ok(report.fields.some(item => item.label === 'Confirm [redacted] is correct'));
});
