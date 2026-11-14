(function (root) {
  const { normalize } = typeof require === 'function' ? require('./text') : root.JobAutofiller.text;
  const matcher = typeof require === 'function' ? require('./matcher') : root.JobAutofiller.matcher;

  const MAX_ANSWER_LENGTH = 1000;

  function canLearn(label) {
    const text = normalize(label);
    return Boolean(text) && !matcher.isSensitive(text) && !matcher.isConsent(text);
  }

  // Answers are reused only on an exact match of the normalized question.
  function findAnswer(answers, label) {
    const question = normalize(label);
    if (!question || !Array.isArray(answers)) return null;
    const hit = answers.find(item => item.question === question);
    return hit ? hit.answer : null;
  }

  function upsertAnswer(answers, label, answer) {
    const question = normalize(label);
    const value = String(answer == null ? '' : answer).trim().slice(0, MAX_ANSWER_LENGTH);
    if (!canLearn(label) || !value) return answers;
    const entry = { question, label: String(label).trim().slice(0, 200), answer: value };
    const index = answers.findIndex(item => item.question === question);
    if (index === -1) return answers.concat(entry);
    const next = answers.slice();
    next[index] = entry;
    return next;
  }

  function removeAnswer(answers, question) {
    return answers.filter(item => item.question !== question);
  }

  function sanitizeAnswers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(item => item && typeof item.label === 'string' && typeof item.answer === 'string')
      .reduce((list, item) => upsertAnswer(list, item.label, item.answer), []);
  }

  const api = { canLearn, findAnswer, upsertAnswer, removeAnswer, sanitizeAnswers };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).answers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
