const test = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../core/profile');
const { sampleProfile } = require('./helpers');

test('empty profile has no personal data and a schema version', () => {
  const empty = profile.emptyProfile();
  assert.equal(empty.schemaVersion, profile.SCHEMA_VERSION);
  assert.equal(profile.hasProfileData(empty), false);
  assert.deepEqual(empty.education, []);
});

test('normalizeProfile drops unknown keys and coerces types', () => {
  const result = profile.normalizeProfile({
    personal: { firstName: '  Jane ', email: 5, extra: 'x' },
    secret: 'nope',
    employment: [{ employer: 'Acme', current: 'yes' }, null, {}]
  });
  assert.equal(result.personal.firstName, 'Jane');
  assert.equal(result.personal.email, '5');
  assert.equal('extra' in result.personal, false);
  assert.equal('secret' in result, false);
  assert.equal(result.employment.length, 1);
  assert.equal(result.employment[0].current, false);
});

test('normalizeProfile tolerates garbage input', () => {
  assert.doesNotThrow(() => profile.normalizeProfile('text'));
  assert.doesNotThrow(() => profile.normalizeProfile({ education: 'x', personal: 3 }));
});

test('getValue resolves paths, dates and the derived full name', () => {
  const p = sampleProfile();
  assert.equal(profile.getValue(p, 'personal.email'), 'jane.sample@example.com');
  assert.equal(profile.getValue(p, 'fullName'), 'Jane Sample');
  assert.equal(profile.getValue(p, 'employment.1.title'), 'Cook');
  assert.equal(profile.getValue(p, 'employment.0.startDate.month'), '06');
  assert.equal(profile.getValue(p, 'employment.0.startDate.year'), '2026');
  assert.equal(profile.getValue(p, 'employment.0.current'), true);
});

test('getValue returns empty for missing entries', () => {
  const p = sampleProfile();
  assert.equal(profile.getValue(p, 'employment.5.title'), '');
  assert.equal(profile.getValue(p, 'employment.1.endDate.month'), '10');
  assert.equal(profile.getValue(p, 'employment.1.description'), '');
  assert.equal(profile.getValue(p, 'links.github'), '');
});
