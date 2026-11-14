const test = require('node:test');
const assert = require('node:assert/strict');
const answers = require('../core/answers');

test('answers are reused on exact normalized questions only', () => {
  const list = answers.upsertAnswer([], 'Are you legally authorized to work in Canada? *', 'Yes');
  assert.equal(answers.findAnswer(list, 'are you legally authorized to work in canada?'), 'Yes');
  assert.equal(answers.findAnswer(list, 'Are you legally authorized to work in the United States?'), null);
  assert.equal(answers.findAnswer([], 'anything'), null);
});

test('upsert replaces an existing answer for the same question', () => {
  let list = answers.upsertAnswer([], 'Work arrangement', 'Remote');
  list = answers.upsertAnswer(list, 'Work arrangement *', 'Hybrid');
  assert.equal(list.length, 1);
  assert.equal(list[0].answer, 'Hybrid');
});

test('sensitive, consent and empty answers are never stored', () => {
  assert.equal(answers.upsertAnswer([], 'Gender', 'Female').length, 0);
  assert.equal(answers.upsertAnswer([], 'Date of birth', '2000-01-01').length, 0);
  assert.equal(answers.upsertAnswer([], 'I agree to the terms', 'yes').length, 0);
  assert.equal(answers.upsertAnswer([], 'Notice period', '   ').length, 0);
});

test('long answers are truncated', () => {
  const list = answers.upsertAnswer([], 'Tell us more', 'x'.repeat(5000));
  assert.equal(list[0].answer.length, 1000);
});

test('sanitizeAnswers filters corrupt and sensitive entries', () => {
  const clean = answers.sanitizeAnswers([
    { label: 'Notice period', answer: '2 weeks' },
    { label: 'Gender', answer: 'x' },
    { label: 5, answer: 'x' },
    null
  ]);
  assert.deepEqual(clean.map(item => item.label), ['Notice period']);
  assert.deepEqual(answers.sanitizeAnswers('nope'), []);
});

test('removeAnswer deletes by question key', () => {
  const list = answers.upsertAnswer([], 'Notice period', '2 weeks');
  assert.equal(answers.removeAnswer(list, list[0].question).length, 0);
});
