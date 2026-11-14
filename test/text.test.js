const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, pickOption } = require('../core/text');

test('normalize strips markers, accents and punctuation', () => {
  assert.equal(normalize('First Name *'), 'first name');
  assert.equal(normalize('Province/State (required)'), 'province state');
  assert.equal(normalize('Québec  Résumé'), 'quebec resume');
  assert.equal(normalize(null), '');
});

test('pickOption prefers exact matches', () => {
  assert.equal(pickOption(['Canada', 'Canada Dry'], 'Canada'), 0);
  assert.equal(pickOption(['Alberta', 'Nova Scotia'], 'nova scotia'), 1);
});

test('pickOption accepts a single unambiguous partial match', () => {
  assert.equal(pickOption(['United States', 'Canada'], 'United States of America'), 0);
  assert.equal(pickOption(['Canada (+1)', 'India (+91)'], 'Canada'), 0);
});

test('pickOption rejects ambiguous and missing matches', () => {
  assert.equal(pickOption(['Canada (+1)', 'United States (+1)'], '+1'), -1);
  assert.equal(pickOption(['Alberta', 'Ontario'], 'Manitoba'), -1);
  assert.equal(pickOption(['Yes, I do', 'No'], 'yes'), -1);
  assert.equal(pickOption(['Yes', 'No'], ''), -1);
});
