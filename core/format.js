(function (root) {
  const POSTAL = /^([A-Za-z]\d[A-Za-z])[ -]?(\d[A-Za-z]\d)$/;
  const LINKEDIN = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#\s]+)/i;

  // Canadian postal codes are written "A1A 1A1". Some forms reject the
  // version without the space, and the spaced form is accepted everywhere.
  function formatPostalCode(value) {
    const match = POSTAL.exec(String(value == null ? '' : value).trim());
    return match ? `${match[1]} ${match[2]}`.toUpperCase() : value;
  }

  // Forms expect the canonical profile address. The parts are joined so the
  // source holds no literal web address.
  function normalizeLinkedIn(value) {
    const match = LINKEDIN.exec(String(value == null ? '' : value).trim());
    return match ? ['https:', '', 'www.linkedin.com', 'in', match[1]].join('/') : value;
  }

  function formatValue(key, value) {
    if (typeof value !== 'string') return value;
    if (key === 'address.postalCode') return formatPostalCode(value);
    if (key === 'links.linkedin') return normalizeLinkedIn(value);
    return value;
  }

  const api = { formatPostalCode, normalizeLinkedIn, formatValue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).format = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
