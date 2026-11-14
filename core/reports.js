(function (root) {
  const REASONS = {
    no_match: 'No matching profile field',
    ambiguous: 'Label matches more than one profile field',
    no_profile_value: 'Profile has no value for this field',
    option_not_found: 'No dropdown option matches the profile value',
    unsupported_control: 'Control type is not supported',
    manual_upload: 'File uploads must be attached manually',
    manual_checkbox: 'Checkboxes are left for you to confirm',
    consent: 'Consent and agreement fields are left for you',
    sensitive: 'Sensitive field, left for you',
    rejected_by_page: 'The page cleared the value',
    error: 'Unexpected error while filling'
  };

  function describeReason(reason) {
    return REASONS[reason] || reason || '';
  }

  function clip(value, length) {
    return String(value == null ? '' : value).slice(0, length);
  }

  function summarize(results) {
    const counts = { filled: 0, verify: 0, existing: 0, review: 0 };
    for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }

  // Reports describe which fields were handled and why. They never contain
  // profile values or anything typed into the page.
  function buildReport({ host, ats, results, extensionVersion }) {
    return {
      generatedOn: new Date().toISOString().slice(0, 10),
      extensionVersion: extensionVersion || '',
      host: clip(host, 100),
      ats: ats || 'generic',
      counts: summarize(results),
      fields: results
        .filter(result => result.status !== 'existing')
        .map(result => ({
          label: clip(result.label, 120),
          kind: result.kind,
          inputType: result.type || '',
          automationId: clip(result.automationId, 80),
          autocomplete: clip(result.autocomplete, 40),
          status: result.status,
          reason: result.reason || '',
          matchedKey: result.key || '',
          via: result.via || ''
        }))
    };
  }

  const api = { describeReason, summarize, buildReport };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).reports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
