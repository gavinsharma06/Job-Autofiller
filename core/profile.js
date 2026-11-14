(function (root) {
  const SCHEMA_VERSION = 1;

  const SECTIONS = [
    {
      id: 'personal',
      title: 'Personal',
      fields: [
        { key: 'firstName', label: 'First name' },
        { key: 'middleName', label: 'Middle name' },
        { key: 'lastName', label: 'Last name' },
        { key: 'preferredName', label: 'Preferred name' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phoneCountryCode', label: 'Phone country code', hint: 'As shown in dropdowns, for example Canada (+1)' },
        { key: 'phone', label: 'Phone', type: 'tel', hint: 'Number without the country code' }
      ]
    },
    {
      id: 'address',
      title: 'Address',
      fields: [
        { key: 'line1', label: 'Address line 1' },
        { key: 'line2', label: 'Address line 2' },
        { key: 'city', label: 'City' },
        { key: 'region', label: 'Province or state', hint: 'Full name as shown in dropdowns' },
        { key: 'postalCode', label: 'Postal code' },
        { key: 'country', label: 'Country' }
      ]
    },
    {
      id: 'links',
      title: 'Links',
      fields: [
        { key: 'linkedin', label: 'LinkedIn URL', type: 'url' },
        { key: 'github', label: 'GitHub URL', type: 'url' },
        { key: 'website', label: 'Website URL', type: 'url' }
      ]
    }
  ];

  const LISTS = [
    {
      id: 'education',
      title: 'Education',
      itemLabel: 'Education entry',
      fields: [
        { key: 'school', label: 'School' },
        { key: 'degree', label: 'Degree', hint: 'Use the wording dropdowns show, for example Bachelor\'s Degree' },
        { key: 'fieldOfStudy', label: 'Field of study' },
        { key: 'startDate', label: 'Start', type: 'month' },
        { key: 'endDate', label: 'End', type: 'month' },
        { key: 'gpa', label: 'GPA' }
      ]
    },
    {
      id: 'employment',
      title: 'Employment history',
      itemLabel: 'Job',
      fields: [
        { key: 'employer', label: 'Employer' },
        { key: 'title', label: 'Job title' },
        { key: 'location', label: 'Location' },
        { key: 'startDate', label: 'Start', type: 'month' },
        { key: 'endDate', label: 'End', type: 'month' },
        { key: 'current', label: 'Currently works here', type: 'checkbox' },
        { key: 'description', label: 'Description', type: 'textarea' }
      ]
    }
  ];

  function toText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return '';
  }

  function readFields(source, fields) {
    const out = {};
    for (const field of fields) {
      out[field.key] = field.type === 'checkbox' ? source[field.key] === true : toText(source[field.key]);
    }
    return out;
  }

  function hasAny(item) {
    return Object.values(item).some(value => value === true || (typeof value === 'string' && value !== ''));
  }

  function normalizeProfile(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const profile = { schemaVersion: SCHEMA_VERSION };
    for (const section of SECTIONS) {
      const data = source[section.id] && typeof source[section.id] === 'object' ? source[section.id] : {};
      profile[section.id] = readFields(data, section.fields);
    }
    for (const list of LISTS) {
      const items = Array.isArray(source[list.id]) ? source[list.id] : [];
      profile[list.id] = items
        .filter(item => item && typeof item === 'object')
        .map(item => readFields(item, list.fields))
        .filter(hasAny);
    }
    return profile;
  }

  function emptyProfile() {
    return normalizeProfile({});
  }

  function hasProfileData(profile) {
    const p = profile && profile.personal;
    return Boolean(p && (p.firstName || p.lastName || p.email));
  }

  // Paths look like personal.email, employment.0.title or employment.0.startDate.month.
  function getValue(profile, path) {
    if (!profile) return '';
    if (path === 'fullName') {
      return [profile.personal.firstName, profile.personal.lastName].filter(Boolean).join(' ');
    }
    const parts = path.split('.');
    let node = profile;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof node === 'string' && (part === 'month' || part === 'year')) {
        const match = /^(\d{4})-(\d{2})$/.exec(node);
        if (!match) return '';
        return part === 'year' ? match[1] : match[2];
      }
      if (node == null || typeof node !== 'object') return '';
      node = node[part];
    }
    if (typeof node === 'boolean') return node;
    return typeof node === 'string' ? node : '';
  }

  const api = { SCHEMA_VERSION, SECTIONS, LISTS, normalizeProfile, emptyProfile, hasProfileData, getValue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).profile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
