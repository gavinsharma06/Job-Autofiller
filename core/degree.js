(function (root) {
  const { normalize, pickOption } = typeof require === 'function' ? require('./text') : root.JobAutofiller.text;

  // Workday tenants word the degree list differently ("Bachelors", "BA", "BS",
  // "Bachelor's Degree"), so the wanted degree is matched by level first and
  // by stream (science or arts) only when several options share the level.
  const LEVELS = [
    ['doctorate', /\b(doctor|doctorate|doctoral|phd|ph d)\b/],
    ['master', /\bmasters?\b|^(ms|msc|ma|mba|meng|m s|m a|m sc|m eng)( |$)/],
    ['bachelor', /\bbachelors?\b|\bundergraduate\b|^(bs|bsc|ba|beng|btech|bcs|b s|b a|b sc|b eng|b tech)( |$)/],
    ['associate', /\bassociates?\b|^(as|aa|aas)$/],
    ['diploma', /\bdiploma\b/],
    ['certificate', /\bcertificate\b/],
    ['highschool', /\b(high school|secondary school|ged)\b/]
  ];

  const ARTS = /\barts?\b|^(ba|b a)( |$)/;
  const SCIENCE = /\bscience|\bengineering|\bcomputer|\btechnology|\bmath|\bapplied|^(bs|bsc|b s|b sc|beng|b eng)( |$)/;

  function levelOf(text) {
    const value = normalize(text);
    const hit = LEVELS.find(([, pattern]) => pattern.test(value));
    return hit ? hit[0] : '';
  }

  function streamOf(text) {
    const value = normalize(text);
    if (ARTS.test(value)) return 'arts';
    if (SCIENCE.test(value)) return 'science';
    return '';
  }

  // Returns the index of the best option for `wanted`, or -1 when the match
  // is missing or ambiguous.
  function pickDegree(optionTexts, wanted) {
    const exact = pickOption(optionTexts, wanted);
    if (exact !== -1) return exact;
    const level = levelOf(wanted);
    if (!level) return -1;
    let candidates = optionTexts.map((text, index) => ({ text, index })).filter(item => levelOf(item.text) === level);
    if (candidates.length === 1) return candidates[0].index;
    const stream = streamOf(wanted);
    if (candidates.length > 1 && stream) {
      candidates = candidates.filter(item => streamOf(item.text) === stream);
      if (candidates.length === 1) return candidates[0].index;
    }
    return -1;
  }

  const api = { levelOf, streamOf, pickDegree };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).degree = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
