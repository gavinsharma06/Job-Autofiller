const test = require('node:test');
const assert = require('node:assert/strict');
const matcher = require('../core/matcher');

const CASES = [
  ['First Name *', 'personal.firstName'],
  ['Legal First Name', 'personal.firstName'],
  ['Given Name(s)', 'personal.firstName'],
  ['Last Name', 'personal.lastName'],
  ['Family Name', 'personal.lastName'],
  ['Surname', 'personal.lastName'],
  ['Full Name', 'fullName'],
  ['Preferred First Name', 'personal.preferredName'],
  ['Email Address', 'personal.email'],
  ['E-mail', 'personal.email'],
  ['Confirm Email', 'personal.email'],
  ['Phone Number', 'personal.phone'],
  ['Mobile', 'personal.phone'],
  ['Country Phone Code', 'personal.phoneCountryCode'],
  ['Address Line 1', 'address.line1'],
  ['Street Address', 'address.line1'],
  ['Address Line 2', 'address.line2'],
  ['Apartment / Suite', 'address.line2'],
  ['City', 'address.city'],
  ['Province/State', 'address.region'],
  ['State or Province', 'address.region'],
  ['Postal Code', 'address.postalCode'],
  ['ZIP / Postal Code', 'address.postalCode'],
  ['Country/Region', 'address.country'],
  ['LinkedIn Profile URL', 'links.linkedin'],
  ['GitHub', 'links.github'],
  ['Portfolio Website', 'links.website'],
  ['School or University', 'education.0.school'],
  ['Field of Study', 'education.0.fieldOfStudy'],
  ['Overall Result (GPA)', 'education.0.gpa'],
  ['Current Company', 'employment.0.employer']
];

for (const [label, key] of CASES) {
  test(`label "${label}" maps to ${key}`, () => {
    const match = matcher.matchLabel(label);
    assert.ok(match && !match.ambiguous, 'expected a match');
    assert.equal(match.key, key);
  });
}

test('questions that merely mention a field do not match', () => {
  for (const label of [
    'Why do you want to work here?',
    'Are you legally authorized to work in Canada?',
    'Salary expectations',
    'Reference email address of your manager',
    'Please describe your experience with the city of Halifax',
    'Phone Device Type',
    ''
  ]) {
    assert.equal(matcher.matchLabel(label), null, label);
  }
});

test('a bare name label is only a medium confidence match', () => {
  assert.equal(matcher.matchLabel('Name').confidence, matcher.MEDIUM);
  assert.equal(matcher.matchLabel('LinkedIn').confidence, matcher.MEDIUM);
});

test('autocomplete tokens map with high confidence', () => {
  assert.equal(matcher.matchAutocomplete('given-name').key, 'personal.firstName');
  assert.equal(matcher.matchAutocomplete('section-x shipping postal-code').key, 'address.postalCode');
  assert.equal(matcher.matchAutocomplete('off'), null);
  assert.equal(matcher.matchAutocomplete(''), null);
});

test('input type is a medium confidence fallback', () => {
  assert.equal(matcher.matchInputType('email').confidence, matcher.MEDIUM);
  assert.equal(matcher.matchInputType('text'), null);
});

test('sensitive and consent labels are detected', () => {
  for (const label of ['Gender', 'Veteran Status', 'Date of Birth', 'Social Insurance Number (SIN)',
    'Are you a person with a disability?', 'Race/Ethnicity', 'Password', 'Passport number']) {
    assert.equal(matcher.isSensitive(label), true, label);
  }
  assert.equal(matcher.isSensitive('Why do you want to work here?'), false);
  assert.equal(matcher.isConsent('I agree to the privacy policy'), true);
  assert.equal(matcher.isConsent('Do you require accommodation?'), false);
});
