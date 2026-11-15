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
    approval_required: 'Needs your approval each time, left for you',
    rejected_by_page: 'The page cleared the value',
    already_filled: 'Field already had a value',
    conflicts_with_profile: 'Page value differs from your saved profile, left unchanged',
    value_mismatch: 'The page shows a different value than the one entered',
    error: 'Unexpected error while filling'
  };

  function describeReason(reason) {
    return REASONS[reason] || reason || '';
  }

  function clip(value, length) {
    return String(value == null ? '' : value).slice(0, length);
  }

  function summarize(results) {
    const counts = { filled: 0, verify: 0, existing: 0, review: 0, optional: 0 };
    for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }

  // Contact details and links are the values most likely to leak through a
  // label, so any label containing one is redacted. Single names are left
  // alone because common words such as "Will" would hide real questions.
  function secretsFrom(profile) {
    if (!profile) return [];
    const { personal = {}, address = {}, links = {} } = profile;
    const values = [
      personal.email, personal.phone, [personal.firstName, personal.lastName].filter(Boolean).join(' '),
      address.line1, address.line2, address.postalCode, ...Object.values(links)
    ];
    return values.filter(value => typeof value === 'string' && value.length >= 5);
  }

  function scrub(text, secrets) {
    return secrets.reduce((out, secret) => out.split(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join('[redacted]'), text);
  }

  // Reports describe which fields were handled and why. They never contain
  // profile values or anything typed into the page.
  function buildReport({ host, ats, results, extensionVersion, profile }) {
    const secrets = secretsFrom(profile);
    const reasons = {};
    for (const result of results) {
      if (result.status !== 'review' && result.status !== 'conflict' && result.status !== 'invalid') continue;
      reasons[result.reason] = (reasons[result.reason] || 0) + 1;
    }
    return {
      generatedOn: new Date().toISOString().slice(0, 10),
      extensionVersion: extensionVersion || '',
      host: clip(host, 100),
      ats: ats || 'generic',
      counts: summarize(results),
      skipReasons: reasons,
      fields: results.map(result => ({
        label: scrub(clip(result.label, 120), secrets),
        kind: result.kind,
        inputType: result.type || '',
        automationId: clip(result.automationId, 80),
        autocomplete: clip(result.autocomplete, 40),
        status: result.status,
        reason: result.status === 'existing' ? 'already_filled' : result.reason || '',
        matchedKey: result.key || '',
        via: result.via || ''
      }))
    };
  }

  const api = { describeReason, summarize, buildReport };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).reports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
