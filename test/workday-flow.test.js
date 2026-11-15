const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../content/engine');
const priv = require('../core/privatedata');
const { normalizeProfile } = require('../core/profile');
const { makeDom, sampleProfile, wireListboxes } = require('./helpers');

const URL_ = 'https://acme.wd3.myworkdayjobs.com/en-US/careers/apply';
const TIMING = { timing: { timeout: 300, interval: 5 } };

function profile(extra) {
  const base = sampleProfile();
  base.education[0].degree = 'Bachelor of Applied Computer Science';
  base.employment = [];
  return normalizeProfile(Object.assign({}, base, extra));
}

const byLabel = (run, label) => run.results.find(result => result.label === label);

// A searchable multi select: results appear after Enter and a click adds a pill.
// With `broken` the page ignores the click, like the false positive in the log.
function wireMultiselect(doc, catalog, broken) {
  doc.querySelectorAll('[data-automation-id="multiSelectContainer"]').forEach(box => {
    if (box.__wired) return;
    box.__wired = true;
    const input = box.querySelector('input');
    const pills = box.querySelector('ul');
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const term = input.value.toLowerCase();
      box.querySelectorAll('[data-automation-id="activeListContainer"]').forEach(node => node.remove());
      const list = doc.createElement('div');
      list.setAttribute('data-automation-id', 'activeListContainer');
      catalog.filter(text => text.toLowerCase().includes(term)).forEach(text => {
        const option = doc.createElement('div');
        option.setAttribute('data-automation-id', 'promptOption');
        option.textContent = text;
        option.addEventListener('click', () => {
          if (!broken) {
            const pill = doc.createElement('li');
            pill.setAttribute('data-automation-id', 'selectedItem');
            pill.textContent = text;
            pills.appendChild(pill);
          }
          list.remove();
        });
        list.appendChild(option);
      });
      box.appendChild(list);
    });
  });
}

const multiselect = (id, label) => `
  <label for="${id}">${label}</label>
  <div data-automation-id="multiSelectContainer"><input id="${id}" data-automation-id="searchBox"><ul data-automation-id="selectedItemList"></ul></div>`;

const dateGroup = (label, parts) => `
  <div role="group"><label>${label}</label><div>${parts.map(part =>
    `<input data-automation-id="dateSection${part}-input" placeholder="${part}">`).join('')}</div></div>`;

function wireAddButtons(doc, templates) {
  doc.querySelectorAll('button[data-automation-id="add-button"]').forEach(button => {
    button.addEventListener('click', () => {
      const type = button.getAttribute('data-type');
      const count = doc.querySelectorAll(`[data-automation-id^="${templates[type].prefix}-"]`).length + 1;
      const section = doc.createElement('div');
      section.setAttribute('data-automation-id', `${templates[type].prefix}-${count}`);
      section.innerHTML = templates[type].html(count);
      doc.getElementById(`${type}-area`).appendChild(section);
      wireMultiselect(doc, ['Example Cert - Example Org', 'Other Cert'], false);
    });
  });
}

const TEMPLATES = {
  work: {
    prefix: 'workExperience',
    html: n => `
      <label for="jt${n}">Job Title*</label><input id="jt${n}" data-automation-id="jobTitle">
      <label for="co${n}">Company*</label><input id="co${n}" data-automation-id="company">
      ${dateGroup('From*', ['Month', 'Year'])}
      ${dateGroup('To', ['Month', 'Year'])}
      <label for="rd${n}">Role Description</label><textarea id="rd${n}" data-automation-id="description"></textarea>`
  },
  cert: {
    prefix: 'certifications',
    html: n => `
      ${multiselect(`cn${n}`, 'Certification')}
      <label for="num${n}">Certification Number</label><input id="num${n}">
      ${dateGroup('Issued Date*', ['Month', 'Day', 'Year'])}
      ${dateGroup('Expiration Date', ['Month', 'Day', 'Year'])}`
  },
  web: {
    prefix: 'websiteSection',
    html: n => `<label for="url${n}">URL*</label><input id="url${n}">`
  }
};

const PAGE = `
  <label for="pc">Postal Code*</label><input id="pc" data-automation-id="addressSection_postalCode">
  <label for="li">LinkedIn URL</label><input id="li">
  <label for="ext">Phone Extension</label><input id="ext" data-automation-id="phone-extension">
  <label for="sd">Earliest start date*</label><input id="sd">
  <label for="ai">Do you consent to the use of artificial intelligence?*</label><textarea id="ai"></textarea>
  ${multiselect('hear', 'How Did You Hear About Us?*')}
  <div data-automation-id="education-1">
    <label for="dg">Degree*</label>
    <button id="dg" type="button" aria-haspopup="listbox" data-options='["High School","BA","BS","MS"]'>Select One</button>
    ${multiselect('fos', 'Field of Study')}
    <div><label>From</label><input data-automation-id="dateSectionYear-input"></div>
    <div><label>To (Actual or Expected)</label><input data-automation-id="dateSectionYear-input"></div>
  </div>
  <div id="work-area"></div><button type="button" data-automation-id="add-button" data-type="work" aria-label="Add Work Experience">Add</button>
  <div id="cert-area"></div><button type="button" data-automation-id="add-button" data-type="cert" aria-label="Add Certifications">Add</button>
  <div id="web-area"></div><button type="button" data-automation-id="add-button" data-type="web" aria-label="Add Websites">Add</button>`;

function privateData() {
  let data = priv.emptyPrivate();
  data = priv.importFile(data, {
    role_picks: { support: ['b'], backend: ['a'] },
    projects: [
      { id: 'a', employment_entry: { employer: 'Alpha', title: 'Dev A', startDate: '2026-01', current: true, description: 'Did A.' } },
      { id: 'b', employment_entry: { employer: 'Beta', title: 'Dev B', startDate: '2025-01', endDate: '2025-04', description: 'Did B.' } }
    ]
  }).data;
  data = priv.importFile(data, { certifications: [{ name: 'Example Cert', certificationNumber: 'ABC123', issued: '2025-06-08', expires: '2028-06-08' }] }).data;
  data = priv.importFile(data, {
    websites: ['https://example.com/one', 'https://example.com/two'],
    library: [
      { match: ['how did you hear'], answer: ['LinkedIn', 'Job Board'] },
      { match: ['start date'], answer: '{today+7}' },
      { match: ['artificial intelligence'], ask: true }
    ]
  }).data;
  return data;
}

test('workday: searchable selects, repeaters, date parts, degree, formats and library in one run', async () => {
  const dom = makeDom(PAGE, URL_);
  const doc = dom.window.document;
  doc.title = 'IT Support Tech I';
  wireListboxes(doc);
  wireMultiselect(doc, ['Biology', 'Computer Science', 'Computer Engineering', 'Job Board', 'Referral'], false);
  wireAddButtons(doc, TEMPLATES);

  const data = profile({ address: { line1: '1 Example Street', city: 'Halifax', region: 'Nova Scotia', postalCode: 'a1a1a1', country: 'Canada' },
    links: { linkedin: 'linkedin.com/in/example' } });
  const run = await engine.fillPage(doc, data, [], Object.assign({ privateData: privateData() }, TIMING));

  assert.equal(run.role, 'support');
  assert.equal(doc.getElementById('pc').value, 'A1A 1A1');
  assert.equal(doc.getElementById('li').value, ['https:', '', 'www.linkedin.com', 'in', 'example'].join('/'));

  // Searchable multi selects end with a pill, never just typed text.
  const pill = id => Array.from(doc.getElementById(id).closest('[data-automation-id="multiSelectContainer"]').querySelectorAll('[data-automation-id="selectedItem"]')).map(node => node.textContent);
  assert.deepEqual(pill('fos'), ['Computer Science']);
  assert.deepEqual(pill('hear'), ['Job Board']);
  assert.equal(doc.getElementById('fos').value, '');
  assert.equal(byLabel(run, 'Field of Study').status, 'filled');
  assert.equal(byLabel(run, 'How Did You Hear About Us?*').via, 'answer library');

  // BA and BS list.
  assert.equal(doc.getElementById('dg').textContent, 'BS');
  // Education year boxes use the parent labels From and To.
  const years = Array.from(doc.querySelectorAll('[data-automation-id="education-1"] [data-automation-id="dateSectionYear-input"]')).map(input => input.value);
  assert.deepEqual(years, ['2022', '2026']);

  // Work Experience repeater created one section from the support role pick.
  assert.equal(doc.querySelectorAll('[data-automation-id^="workExperience-"]').length, 1);
  assert.equal(doc.getElementById('jt1').value, 'Dev B');
  assert.equal(doc.getElementById('co1').value, 'Beta');
  const work = Array.from(doc.querySelectorAll('[data-automation-id="workExperience-1"] input[data-automation-id^="dateSection"]')).map(input => input.value);
  assert.deepEqual(work, ['01', '2025', '04', '2025']);
  assert.equal(doc.getElementById('rd1').value, 'Did B.');

  // Certification repeater with day, month and year boxes.
  assert.equal(doc.querySelectorAll('[data-automation-id^="certifications-"]').length, 1);
  assert.deepEqual(pill('cn1'), ['Example Cert - Example Org']);
  assert.equal(doc.getElementById('num1').value, 'ABC123');
  const cert = Array.from(doc.querySelectorAll('[data-automation-id="certifications-1"] input[data-automation-id^="dateSection"]')).map(input => input.value);
  assert.deepEqual(cert, ['06', '08', '2025', '06', '08', '2028']);

  // Websites section gets one row per website.
  assert.deepEqual(Array.from(doc.querySelectorAll('[data-automation-id^="websiteSection-"] input')).map(input => input.value),
    ['https://example.com/one', 'https://example.com/two']);

  // Library answers: start date from the rule, AI consent left for approval.
  assert.equal(doc.getElementById('sd').value, priv.resolveAnswer('{today+7}'));
  assert.equal(byLabel(run, 'Do you consent to the use of artificial intelligence?*').reason, 'approval_required');
  assert.equal(doc.getElementById('ai').value, '');

  // The optional phone extension does not count as needing the person.
  assert.equal(byLabel(run, 'Phone Extension').status, 'optional');
  assert.equal(run.results.some(result => result.status === 'review' && result.label === 'Phone Extension'), false);

  // A second run adds no sections and fills nothing twice.
  const again = await engine.fillPage(doc, data, [], Object.assign({ privateData: privateData() }, TIMING));
  assert.equal(doc.querySelectorAll('[data-automation-id^="workExperience-"]').length, 1);
  assert.equal(doc.querySelectorAll('[data-automation-id^="certifications-"]').length, 1);
  assert.equal(doc.querySelectorAll('[data-automation-id^="websiteSection-"]').length, 2);
  assert.equal(again.results.filter(result => result.status === 'filled').length, 0);
});

test('a searchable select that shows no pill is never reported as filled', async () => {
  const dom = makeDom(`<div data-automation-id="education-1">${multiselect('fos', 'Field of Study')}</div>`, URL_);
  const doc = dom.window.document;
  wireMultiselect(doc, ['Computer Science'], true);
  const run = await engine.fillPage(doc, profile(), [], TIMING);
  const result = byLabel(run, 'Field of Study');
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'rejected_by_page');
  assert.equal(doc.getElementById('fos').value, '');
});

test('a searchable select with no results is reported, not filled', async () => {
  const dom = makeDom(`<div data-automation-id="education-1">${multiselect('fos', 'Field of Study')}</div>`, URL_);
  const doc = dom.window.document;
  wireMultiselect(doc, ['Biology'], false);
  const run = await engine.fillPage(doc, profile(), [], TIMING);
  assert.notEqual(byLabel(run, 'Field of Study').status, 'filled');
  assert.equal(doc.getElementById('fos').value, '');
});

test('degree mapping works for tenants that list Bachelors', async () => {
  const dom = makeDom(`<div data-automation-id="education-1"><label for="dg">Degree*</label>
    <button id="dg" type="button" aria-haspopup="listbox" data-options='["Associates","Bachelors","Masters"]'>Select One</button></div>`, URL_);
  const doc = dom.window.document;
  wireListboxes(doc);
  const run = await engine.fillPage(doc, profile(), [], TIMING);
  assert.equal(byLabel(run, 'Degree*').status, 'filled');
  assert.equal(doc.getElementById('dg').textContent, 'Bachelors');
});

test('generic pages only treat unmarked fields as optional when the page marks required ones', async () => {
  const marked = makeDom('<label for="a">Middle Name</label><input id="a"><label for="c">Favourite colour</label><input id="c"><label for="b">Why us?*</label><input id="b">');
  const run = await engine.fillPage(marked.window.document, profile(), [], TIMING);
  assert.equal(byLabel(run, 'Middle Name').status, 'optional');
  assert.equal(byLabel(run, 'Favourite colour').status, 'review');
  assert.equal(byLabel(run, 'Why us?*').status, 'review');
  const unmarked = makeDom('<label for="a">Middle Name</label><input id="a">');
  const second = await engine.fillPage(unmarked.window.document, profile(), [], TIMING);
  assert.equal(byLabel(second, 'Middle Name').status, 'review');
});

test('a combobox that never opens a list is still reported as unsupported', async () => {
  const dom = makeDom('<label for="y">Country</label><input id="y" role="combobox">');
  const run = await engine.fillPage(dom.window.document, profile(), [], TIMING);
  assert.equal(run.results[0].reason, 'unsupported_control');
});
