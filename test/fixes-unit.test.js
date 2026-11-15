const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../core/format');
const degree = require('../core/degree');
const priv = require('../core/privatedata');
const { describeError } = require('../core/text');
const { getValue } = require('../core/profile');
const reports = require('../core/reports');
const workday = require('../adapters/workday');

test('Canadian postal codes get a space and upper case, other values are untouched', () => {
  assert.equal(format.formatPostalCode('a1a1a1'), 'A1A 1A1');
  assert.equal(format.formatPostalCode('A1A-1A1'), 'A1A 1A1');
  assert.equal(format.formatPostalCode('A1A 1A1'), 'A1A 1A1');
  assert.equal(format.formatPostalCode('90210'), '90210');
  assert.equal(format.formatValue('address.postalCode', 'a1a1a1'), 'A1A 1A1');
});

test('LinkedIn URLs are normalized to the www form', () => {
  const want = ['https:', '', 'www.linkedin.com', 'in', 'example'].join('/');
  for (const input of ['linkedin.com/in/example', 'www.linkedin.com/in/example/', 'http://linkedin.com/in/example?x=1', 'https://ca.linkedin.com/in/example']) {
    assert.equal(format.normalizeLinkedIn(input), want, input);
  }
  assert.equal(format.formatValue('links.linkedin', 'linkedin.com/in/example'), want);
  assert.equal(format.normalizeLinkedIn('not a url'), 'not a url');
  assert.equal(format.formatValue('links.github', 'example.com/x'), 'example.com/x');
});

test('degree mapping follows the tenant wording', () => {
  const wanted = 'Bachelor of Applied Computer Science';
  assert.equal(degree.pickDegree(['High School', 'BA', 'BS', 'MS'], wanted), 2);
  assert.equal(degree.pickDegree(['High School', 'Bachelors', 'Masters'], wanted), 1);
  assert.equal(degree.pickDegree(["Bachelor's Degree", "Master's Degree"], wanted), 0);
  assert.equal(degree.pickDegree(['Bachelor of Arts', 'Bachelor of Science'], wanted), 1);
  assert.equal(degree.pickDegree(['BA', 'BS'], 'Bachelor of Arts in History'), 0);
  assert.equal(degree.pickDegree(['High School', 'Diploma'], wanted), -1);
  assert.equal(degree.pickDegree(['BA', 'BS'], "Bachelor's Degree"), -1);
});

test('describeError tells the person to refresh after the extension reloads', () => {
  assert.match(describeError(new Error('Extension context invalidated.')), /Refresh this page/);
  assert.equal(describeError(new Error('boom')), 'boom');
});

test('dates give month, day and year parts', () => {
  const profile = { cert: { issued: '2025-06-08' }, job: { start: '2026-11' } };
  assert.equal(getValue(profile, 'cert.issued.day'), '08');
  assert.equal(getValue(profile, 'cert.issued.month'), '06');
  assert.equal(getValue(profile, 'cert.issued.year'), '2025');
  assert.equal(getValue(profile, 'job.start.day'), '');
  assert.equal(getValue(profile, 'job.start.month'), '11');
});

test('workday maps date labels to the right boundary', () => {
  assert.equal(workday.boundaryFromLabel('From*', 'employment'), 'startDate');
  assert.equal(workday.boundaryFromLabel('To (Actual or Expected)', 'education'), 'endDate');
  assert.equal(workday.boundaryFromLabel('Issued Date', 'certifications'), 'issued');
  assert.equal(workday.boundaryFromLabel('Expiration Date', 'certifications'), 'expires');
});

const projects = {
  role_picks: { backend: ['a', 'b'], support: ['b'] },
  projects: [
    { id: 'a', employment_entry: { employer: 'Alpha', title: 'Dev', location: 'Town', startDate: '2026-01', endDate: '', current: true, description: 'Did things.' } },
    { id: 'b', employment_entry: { employer: 'Beta', title: 'Dev', startDate: '2025-01', endDate: '2025-04', current: false, description: 'More.' } },
    { id: 'c', employment_entry: null }
  ]
};
const certs = { certifications: [{ name: 'Example Cert', certificationNumber: 'ABC123', issued: '2025-06-08', expires: '2028-06-08', extra: 'dropped' }] };
const library = {
  websites: ['https://example.com/me', 'javascript:alert(1)'],
  library: [
    { match: ['how did you hear'], answer: ['LinkedIn', 'Job Board'] },
    { match: ['artificial intelligence'], ask: true },
    { match: ['start date'], answer: '{today+7}' },
    { match: ['previously worked'], answer: 'No', hosts: ['acme'] },
    { match: ['previously worked'], answer: 'Maybe' },
    { match: [], answer: 'x' }
  ]
};

test('private files import by shape and are sanitized', () => {
  let data = priv.emptyPrivate();
  data = priv.importFile(data, projects).data;
  data = priv.importFile(data, certs).data;
  data = priv.importFile(data, library).data;
  assert.deepEqual(Object.keys(data.entries), ['a', 'b']);
  assert.deepEqual(data.certifications, [{ name: 'Example Cert', issuer: '', number: 'ABC123', issued: '2025-06-08', expires: '2028-06-08' }]);
  assert.deepEqual(data.websites, ['https://example.com/me']);
  assert.equal(data.library.length, 3 + 2);
  assert.equal(priv.importFile(data, { nothing: true }), null);
  assert.deepEqual(priv.summarize(data), { entries: 2, certifications: 1, library: 5, websites: 1 });
});

test('work entries follow role picks and the role is detected from the page', () => {
  const data = priv.importFile(priv.emptyPrivate(), projects).data;
  assert.deepEqual(priv.workEntries(data, 'backend').map(item => item.employer), ['Alpha', 'Beta']);
  assert.deepEqual(priv.workEntries(data, 'support').map(item => item.employer), ['Beta']);
  assert.deepEqual(priv.workEntries(data, 'nonsense').map(item => item.employer), ['Alpha', 'Beta']);
  assert.equal(priv.detectRole('IT Support Tech I'), 'support');
  assert.equal(priv.detectRole('Associate Support Analyst'), 'support');
  assert.equal(priv.detectRole('AI Application QA Specialist'), 'ai_ml');
  assert.equal(priv.detectRole('Cloud Engineer'), 'devops');
  assert.equal(priv.detectRole('ServiceNow Associate Software Engineer'), 'backend');
  assert.equal(priv.detectRole('Accountant'), '');
});

test('answer library matches by phrase, prefers employer rules and resolves dates', () => {
  const data = priv.importFile(priv.emptyPrivate(), library).data;
  assert.deepEqual(priv.findRule(data.library, 'How Did You Hear About Us?*', 'x.example.com').answer, ['LinkedIn', 'Job Board']);
  assert.equal(priv.findRule(data.library, 'Have you previously worked here?', 'acme.example.com').answer[0], 'No');
  assert.equal(priv.findRule(data.library, 'What is your name?', 'acme.example.com'), null);
  assert.equal(priv.findRule(data.library, 'Have you previously worked for Acme?', 'acme.example.com').answer[0], 'No');
  assert.equal(priv.findRule(data.library, 'Have you previously worked for Acme?', 'other.example.com').answer[0], 'Maybe');
  assert.equal(priv.findRule(data.library, 'Do you consent to artificial intelligence screening?', 'x').ask, true);
  assert.equal(priv.resolveAnswer('{today+7}', new Date(2026, 10, 15, 12).getTime()), '2026-11-22');
  assert.equal(priv.resolveAnswer('{today}', new Date(2026, 11, 28, 12).getTime()), '2026-12-28');
});

test('websites come from private data first, then profile links, without duplicates', () => {
  const data = priv.sanitizePrivate({ websites: ['https://example.com/a'] });
  const profile = { links: { github: 'https://example.com/a', website: 'https://example.com/b' } };
  assert.deepEqual(priv.websiteList(data, profile), ['https://example.com/a', 'https://example.com/b']);
});

test('reports count optional fields and describe the approval reason', () => {
  const counts = reports.summarize([{ status: 'optional' }, { status: 'review' }, { status: 'filled' }]);
  assert.deepEqual(counts, { filled: 1, verify: 0, existing: 0, review: 1, optional: 1 });
  assert.match(reports.describeReason('approval_required'), /approval/);
});
