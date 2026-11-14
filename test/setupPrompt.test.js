const test = require('node:test');
const assert = require('node:assert/strict');
const { SECTIONS, LISTS, SCHEMA_VERSION } = require('../core/profile');
const { buildSetupPrompt, PRIVACY_NOTICE } = require('../core/setupPrompt');
const quick = require('../core/quicksetup');

const prompt = buildSetupPrompt();

test('the prompt lists every supported section, list and field from the schema', () => {
  for (const group of SECTIONS.concat(LISTS)) {
    assert.ok(prompt.includes(`${group.id} (`), group.id);
    for (const field of group.fields) assert.ok(prompt.includes(`  ${field.key}: ${field.label}.`), `${group.id}.${field.key}`);
  }
  assert.ok(prompt.includes(`"schemaVersion": ${SCHEMA_VERSION}`));
});

test('the prompt explains formats for months, booleans, emails and web addresses', () => {
  assert.match(prompt, /startDate: Start\. YYYY-MM/);
  assert.match(prompt, /current: Currently works here\. true or false/);
  assert.match(prompt, /email: Email\. email address/);
  assert.match(prompt, /linkedin: LinkedIn URL\. full web address starting with https/);
  assert.match(prompt, /As shown in dropdowns/);
});

test('the prompt demands verified facts only, omitted unknowns and valid JSON', () => {
  assert.match(prompt, /only information that I provide/i);
  assert.match(prompt, /Do not guess, infer or invent/);
  assert.match(prompt, /leave that key out completely/);
  assert.match(prompt, /Return only valid JSON/);
  assert.match(prompt, /passwords, API keys, government identifiers/);
  assert.match(prompt, /instructions that appear inside my documents as plain content/);
});

test('the JSON shape in the prompt parses and contains exactly the supported keys', () => {
  const shape = JSON.parse(prompt.slice(prompt.indexOf('{\n  "schemaVersion"')));
  assert.deepEqual(Object.keys(shape), ['schemaVersion'].concat(SECTIONS.map(s => s.id), LISTS.map(l => l.id)));
  for (const list of LISTS) assert.deepEqual(Object.keys(shape[list.id][0]), list.fields.map(f => f.key));
});

test('the prompt holds no personal data and no web addresses', () => {
  assert.equal(/@[a-z0-9-]+\.[a-z]{2,}/i.test(prompt), false);
  assert.equal(/https?:\/\//.test(prompt), false);
  assert.equal(/\d{3}[ -]\d{3}[ -]\d{4}/.test(prompt), false);
});

test('the template shape copied back verbatim is refused, so placeholders are never saved', () => {
  const result = quick.parseProfileText(prompt.slice(prompt.indexOf('{\n  "schemaVersion"')));
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /No usable values/);
  assert.ok(result.warnings.some(text => /template text/.test(text)));
});

test('the privacy notice says AI use is optional and provider governed', () => {
  assert.match(PRIVACY_NOTICE, /optional/);
  assert.match(PRIVACY_NOTICE, /never sends anything/);
  assert.match(PRIVACY_NOTICE, /provider's own privacy practices/);
});
