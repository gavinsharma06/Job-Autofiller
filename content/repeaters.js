(function (root) {
  const { normalize } = typeof require === 'function' ? require('../core/text') : root.JobAutofiller.text;
  const scan = typeof require === 'function' ? require('./scan') : root.JobAutofiller.scan;

  // Workday adds a section for each entry only after its Add button is pressed.
  const TYPES = {
    employment: { section: /^workExperience-\d+$/, add: /\b(work experience|employment)\b/, area: /workexperience/ },
    certifications: { section: /^certifications-\d+$/, add: /\bcertification/, area: /certification/ },
    websites: { section: /^(websiteSection|websites)-\d+$/, add: /\bwebsite/, area: /website/ }
  };
  const MAX_SECTIONS = 6;

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function countSections(doc, type) {
    return Array.from(doc.querySelectorAll('[data-automation-id]'))
      .filter(node => TYPES[type].section.test(node.getAttribute('data-automation-id'))).length;
  }

  function findAddButton(doc, type) {
    return Array.from(doc.querySelectorAll('button')).find(button => {
      if (button.disabled || scan.isHidden(button)) return false;
      const name = normalize(button.getAttribute('aria-label') || button.textContent);
      if (!/^add\b/.test(name)) return false;
      if (TYPES[type].add.test(name)) return true;
      // A bare "Add" or "Add Another" button belongs to the section around it.
      for (let node = button.parentElement; node; node = node.parentElement) {
        const id = (node.getAttribute('data-automation-id') || '').toLowerCase();
        if (/^(workexperience|education|certifications|website|language|skills)/.test(id)) return TYPES[type].area.test(id);
      }
      return false;
    }) || null;
  }

  async function waitForCount(doc, type, above, timeout, interval) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (countSections(doc, type) > above) return true;
      await wait(interval);
    }
    return countSections(doc, type) > above;
  }

  // Presses Add until `wanted` sections exist. Existing sections are never
  // removed or counted twice, so running Fill again adds nothing.
  async function ensureSections(doc, type, wanted, timing) {
    const target = Math.min(wanted, MAX_SECTIONS);
    let added = 0;
    while (countSections(doc, type) < target) {
      const button = findAddButton(doc, type);
      if (!button) break;
      const before = countSections(doc, type);
      button.click();
      if (!(await waitForCount(doc, type, before, timing.timeout, timing.interval))) break;
      added += 1;
    }
    return added;
  }

  const api = { ensureSections, countSections, findAddButton };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).repeaters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
