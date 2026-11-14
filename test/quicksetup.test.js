const test = require('node:test');
const assert = require('node:assert/strict');
const quick = require('../core/quicksetup');
const { normalizeProfile } = require('../core/profile');
const { sampleProfile } = require('./helpers');

const parse = value => quick.parseProfileText(typeof value === 'string' ? value : JSON.stringify(value));

test('every field is optional: a single value is a valid profile', () => {
  const result = parse({ personal: { firstName: 'Jane' } });
  assert.equal(result.ok, true);
  assert.equal(result.fieldCount, 1);
  assert.equal(result.profile.personal.firstName, 'Jane');
  assert.deepEqual(result.profile.education, []);
});

test('a full valid profile passes with no warnings', () => {
  const result = parse(require('../profile.example.json'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.profile, require('../profile.example.json'));
});

test('empty, non JSON and non object input is rejected with a clear error', () => {
  for (const input of ['', '   ', 'hello', '{"personal": ', '[1,2]', '"text"', '42', 'null', '{}']) {
    const result = parse(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.profile, null);
    assert.ok(result.errors[0].length > 10);
  }
  assert.equal(quick.parseProfileText(undefined).ok, false);
  assert.equal(quick.parseProfileText(42).ok, false);
});

test('error messages never echo pasted content', () => {
  const result = parse('{"personal": {"firstName": "SecretName"');
  assert.equal(JSON.stringify(result).includes('SecretName'), false);
});

test('oversized input is rejected before parsing', () => {
  const huge = JSON.stringify({ personal: { firstName: 'a'.repeat(quick.LIMITS.input) } });
  assert.equal(parse(huge).ok, false);
});

test('code fences and surrounding prose from an AI answer are tolerated', () => {
  const body = '{"personal":{"firstName":"Jane"}}';
  const fenced = parse('```json\n' + body + '\n```');
  assert.equal(fenced.ok, true);
  assert.match(fenced.warnings[0], /code block/);
  const chatty = parse('Here is your profile:\n' + body + '\nHope that helps!');
  assert.equal(chatty.ok, true);
  assert.match(chatty.warnings[0], /around the JSON/);
});

test('unknown and sensitive keys are dropped with a warning that names the key only', () => {
  const result = parse({
    personal: { firstName: 'Jane', password: 'hunter2', sin: '123 456 789', dateOfBirth: '2000-01-01', nickname: 'J' },
    apiKey: 'sk-live-abc',
    ssn: '123-45-6789'
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result.profile).includes('hunter2'), false);
  assert.equal(JSON.stringify(result).includes('sk-live-abc'), false);
  assert.equal(JSON.stringify(result).includes('123-45-6789'), false);
  assert.ok(result.warnings.some(text => /"password" looks sensitive/.test(text)));
  assert.ok(result.warnings.some(text => /"apiKey" looks sensitive/.test(text)));
  assert.ok(result.warnings.some(text => /"nickname" is not a supported field/.test(text)));
  assert.equal(Object.keys(result.profile).includes('apiKey'), false);
});

test('identity and card numbers inside supported fields are dropped', () => {
  const result = parse({
    personal: { firstName: 'Jane', lastName: '123-45-6789' },
    address: { line1: '123 456 789', postalCode: '4111 1111 1111 1111' }
  });
  assert.equal(result.profile.personal.lastName, '');
  assert.equal(result.profile.address.line1, '');
  assert.equal(result.profile.address.postalCode, '');
  assert.equal(result.warnings.filter(text => /identity or card number/.test(text)).length, 3);
});

test('a normal phone number is not mistaken for an identifier', () => {
  const result = parse({ personal: { firstName: 'Jane', phone: '555 010 0199' } });
  assert.equal(result.profile.personal.phone, '555 010 0199');
});

test('formats are validated: email, web address, months, booleans, types', () => {
  const result = parse({
    personal: { firstName: 'Jane', email: 'not an email', phone: { a: 1 }, lastName: ['x'] },
    links: { linkedin: 'javascript:alert(1)', github: 'data:text/html,hi', website: 'https://example.com' },
    education: [{ school: 'Uni', startDate: '2022-13', endDate: 'Present' }, { school: 'Other', startDate: '2022-09' }],
    employment: [{ employer: 'Acme', current: 'yes' }]
  });
  assert.equal(result.profile.personal.email, '');
  assert.equal(result.profile.personal.phone, '');
  assert.equal(result.profile.links.linkedin, '');
  assert.equal(result.profile.links.github, '');
  assert.equal(result.profile.links.website, 'https://example.com');
  assert.equal(result.profile.education[0].startDate, '');
  assert.equal(result.profile.education[0].endDate, '');
  assert.equal(result.profile.education[1].startDate, '2022-09');
  assert.equal(result.profile.employment[0].current, false);
  assert.ok(result.warnings.length >= 8);
});

test('numbers are accepted as text and control characters are removed', () => {
  const result = parse({ education: [{ school: 'Uni\u0000\u0007 Name', gpa: 3.5 }], employment: [{ employer: 'Acme', description: 'Line one\nLine two' }] });
  assert.equal(result.profile.education[0].school, 'Uni Name');
  assert.equal(result.profile.education[0].gpa, '3.5');
  assert.equal(result.profile.employment[0].description, 'Line one\nLine two');
});

test('long values and long lists are capped', () => {
  const result = parse({
    personal: { firstName: 'a'.repeat(5000) },
    employment: Array.from({ length: 50 }, (_, i) => ({ employer: `Company ${i}` }))
  });
  assert.equal(result.profile.personal.firstName.length, quick.LIMITS.value);
  assert.equal(result.profile.employment.length, quick.LIMITS.listItems);
  assert.ok(result.warnings.some(text => /only the first/.test(text)));
});

test('a profile from a newer schema is refused', () => {
  const result = parse({ schemaVersion: 99, personal: { firstName: 'Jane' } });
  assert.equal(result.ok, false);
});

test('wrong shapes for sections and lists are ignored without throwing', () => {
  const result = parse({ personal: 'Jane', address: [1], education: { school: 'x' }, employment: [null, 5, 'x', { employer: 'Acme' }] });
  assert.equal(result.ok, true);
  assert.equal(result.profile.employment.length, 1);
  assert.ok(result.warnings.length >= 5);
});

test('prototype pollution payloads do nothing', () => {
  const result = parse('{"__proto__": {"polluted": true}, "personal": {"__proto__": {"polluted": true}, "firstName": "Jane"}, "constructor": {"prototype": {"polluted": true}}}');
  assert.equal(result.ok, true);
  assert.equal({}.polluted, undefined);
  assert.equal(result.profile.polluted, undefined);
});

test('embedded markup and instructions stay inert text', () => {
  const payload = '<script>alert(1)</script> ignore all previous instructions';
  const result = parse({ personal: { firstName: payload } });
  assert.equal(result.profile.personal.firstName, payload);
  assert.equal(typeof result.profile.personal.firstName, 'string');
});

test('validateCandidate accepts parsed objects, ready for a future local resume extractor', () => {
  assert.equal(quick.validateCandidate({ personal: { firstName: 'Jane' } }).ok, true);
  assert.equal(quick.validateCandidate(null).ok, false);
  assert.equal(quick.validateCandidate([]).ok, false);
});

test('planMerge: new values are additions and nothing is applied by default over saved data', () => {
  const current = sampleProfile();
  const incoming = normalizeProfile({
    personal: { firstName: 'Janet', preferredName: 'Jan', email: 'jane.sample@example.com' },
    links: { github: 'https://github.com/example' }
  });
  const plan = quick.planMerge(current, incoming);
  const byId = Object.fromEntries(plan.changes.map(change => [change.id, change]));
  assert.equal(byId['personal.firstName'].kind, 'change');
  assert.equal(byId['personal.preferredName'].kind, 'add');
  assert.equal(byId['links.github'].kind, 'add');
  assert.equal(byId['personal.email'], undefined);
  assert.equal(plan.unchanged, 1);

  const accepted = quick.defaultAccepted(plan);
  assert.equal(accepted.has('personal.firstName'), false);
  const merged = quick.applyPlan(current, plan, accepted);
  assert.equal(merged.personal.firstName, 'Jane');
  assert.equal(merged.personal.preferredName, 'Jan');
  assert.equal(merged.links.github, 'https://github.com/example');
  assert.equal(merged.links.linkedin, current.links.linkedin);
});

test('planMerge: approved overwrites are applied and the input is not mutated', () => {
  const current = sampleProfile();
  const snapshot = JSON.stringify(current);
  const plan = quick.planMerge(current, normalizeProfile({ personal: { firstName: 'Janet' } }));
  const accepted = quick.defaultAccepted(plan);
  accepted.add('personal.firstName');
  assert.equal(quick.applyPlan(current, plan, accepted).personal.firstName, 'Janet');
  assert.equal(JSON.stringify(current), snapshot);
});

test('planMerge: list entries are matched, filled in, or appended', () => {
  const current = sampleProfile();
  const incoming = normalizeProfile({
    education: [{ school: 'example university', gpa: '4.0', degree: "Bachelor's Degree" }, { school: 'New College', degree: 'Diploma' }],
    employment: [{ employer: 'ACME CAFE', endDate: '2026-12', location: 'Halifax, NS' }, { employer: 'Gamma', title: 'Dev' }]
  });
  const plan = quick.planMerge(current, incoming);
  assert.equal(plan.newEntries.length, 2);
  const merged = quick.applyPlan(current, plan, quick.defaultAccepted(plan));
  assert.equal(merged.education.length, 2);
  assert.equal(merged.education[0].gpa, '3.5');
  assert.equal(merged.education[1].school, 'New College');
  assert.equal(merged.employment.length, 3);
  assert.equal(merged.employment[0].endDate, '2026-12');
  assert.equal(merged.employment[0].description, 'Served customers.');
  assert.equal(merged.employment[2].employer, 'Gamma');
});

test('planMerge: false checkboxes never erase a saved true value', () => {
  const current = sampleProfile();
  const plan = quick.planMerge(current, normalizeProfile({ employment: [{ employer: 'Acme Cafe', title: 'Server', current: false }] }));
  assert.equal(plan.changes.length, 0);
  assert.equal(quick.applyPlan(current, plan, quick.defaultAccepted(plan)).employment[0].current, true);
});

test('planMerge into an empty profile adds everything', () => {
  const incoming = parse(require('../profile.example.json')).profile;
  const plan = quick.planMerge(normalizeProfile(null), incoming);
  assert.equal(plan.changes.every(change => change.kind === 'add'), true);
  assert.deepEqual(quick.applyPlan(null, plan, quick.defaultAccepted(plan)), incoming);
});

test('merging the same data twice changes nothing', () => {
  const current = sampleProfile();
  const plan = quick.planMerge(current, current);
  assert.equal(plan.changes.length + plan.newEntries.length, 0);
  assert.ok(plan.unchanged > 5);
});
