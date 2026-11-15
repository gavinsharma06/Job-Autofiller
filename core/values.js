(function (root) {
  const { normalize } = typeof require === 'function' ? require('./text') : root.JobAutofiller.text;
  const degree = typeof require === 'function' ? require('./degree') : root.JobAutofiller.degree;

  // Text that a page shows when nothing has really been chosen. A field that
  // only holds one of these is empty, however filled it looks.
  const PLACEHOLDERS = /^(select( an? )?( one| option| value| an option)?|select|choose( one| an option)?|please (select|choose)( one| an option)?|pick( one)?|no answer|no response|no selection|not selected|none selected|not specified|unanswered|unspecified)$/;

  function isPlaceholder(text) {
    const value = normalize(text);
    if (!value) return true;
    return PLACEHOLDERS.test(value) || /^(select|choose|please select|please choose)\b/.test(value);
  }

  const CA = { ab: 'alberta', bc: 'british columbia', mb: 'manitoba', nb: 'new brunswick', nl: 'newfoundland and labrador',
    ns: 'nova scotia', nt: 'northwest territories', nu: 'nunavut', on: 'ontario', pe: 'prince edward island',
    qc: 'quebec', sk: 'saskatchewan', yt: 'yukon' };
  const US = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
    de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
    ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
    mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
    nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
    or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
    tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming' };

  // Region codes are only expanded for region fields, so "ns" or "in" in other
  // fields keep their ordinary meaning.
  function expandRegion(text) {
    const value = normalize(text);
    return CA[value] || US[value] || value;
  }

  function words(text) {
    return normalize(text).split(' ').filter(Boolean);
  }

  function digits(text) {
    return String(text == null ? '' : text).replace(/\D/g, '');
  }

  function compact(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]/g, '');
  }

  function isPhoneKey(key) {
    return /\.phone$/.test(key || '');
  }

  // True when a value that is already on the page says the same thing as the
  // saved profile value. It tolerates formatting (spaces, case, masks, region
  // codes, a country name next to its dialing code) but not different content.
  function agrees(key, expected, actual) {
    if (expected == null || actual == null) return false;
    const want = String(expected);
    const have = String(actual);
    if (!normalize(want) || !normalize(have)) return false;
    if (/\.degree$/.test(key || '')) return degree.pickDegree([have], want) !== -1 || agrees('', want, have);
    if (isPhoneKey(key)) {
      const a = digits(want);
      const b = digits(have);
      return a.length >= 7 && b.length >= 7 && (a === b || a.endsWith(b) || b.endsWith(a));
    }
    if (compact(want) === compact(have)) return true;
    const numericWant = /^\d+$/.test(want.trim());
    if (numericWant && /^\d+$/.test(have.trim())) return Number(want) === Number(have);
    let left = words(want);
    let right = words(have);
    if (/\.region$/.test(key || '')) {
      left = words(expandRegion(want));
      right = words(expandRegion(have));
    }
    if (!left.length || !right.length) return false;
    const [short, long] = left.length <= right.length ? [left, right] : [right, left];
    return short.every(word => long.includes(word));
  }

  const api = { isPlaceholder, agrees, expandRegion };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).values = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
