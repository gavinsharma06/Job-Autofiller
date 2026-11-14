(function (root) {
  function normalize(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\(\s*required\s*\)|\*/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/ required$/, '');
  }

  // Returns the index of the option that matches `wanted`, or -1 when the
  // match is missing or ambiguous.
  function pickOption(optionTexts, wanted) {
    const target = normalize(wanted);
    if (!target) return -1;
    const options = optionTexts.map(normalize);
    const exact = options.indexOf(target);
    if (exact !== -1) return exact;
    if (target === 'yes' || target === 'no') return -1;
    const wantedPadded = ` ${target} `;
    const loose = [];
    options.forEach((text, i) => {
      if (!text) return;
      const padded = ` ${text} `;
      if (padded.includes(wantedPadded) || (text.length >= 3 && wantedPadded.includes(padded))) loose.push(i);
    });
    return loose.length === 1 ? loose[0] : -1;
  }

  const api = { normalize, pickOption };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).text = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
