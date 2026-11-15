(function (root) {
  const { normalize } = typeof require === 'function' ? require('../core/text') : root.JobAutofiller.text;

  const HOSTS = /(^|\.)(myworkdayjobs|myworkdaysite|wd\d+\.myworkday)\.com$|(^|\.)workday\.com$/i;

  const SECTION_PREFIXES = {
    workExperience: 'employment',
    education: 'education',
    certifications: 'certifications',
    websiteSection: 'websites',
    websites: 'websites'
  };
  const SECTION_ID = /^(workExperience|education|certifications|websiteSection|websites)-\d+$/;

  const DIRECT_IDS = {
    legalNameSection_firstName: 'personal.firstName',
    legalNameSection_middleName: 'personal.middleName',
    legalNameSection_lastName: 'personal.lastName',
    addressSection_addressLine1: 'address.line1',
    addressSection_addressLine2: 'address.line2',
    addressSection_city: 'address.city',
    addressSection_postalCode: 'address.postalCode',
    addressSection_countryRegion: 'address.region',
    countryDropdown: 'address.country',
    'phone-number': 'personal.phone',
    email: 'personal.email'
  };

  const SECTION_FIELDS = {
    employment: {
      jobtitle: 'title',
      'job title': 'title',
      title: 'title',
      company: 'employer',
      location: 'location',
      'role description': 'description',
      description: 'description',
      currentlyworkhere: 'current'
    },
    certifications: {
      certification: 'name',
      'certification name': 'name',
      certifications: 'name',
      'certification number': 'number',
      'certificate number': 'number',
      issuer: 'issuer'
    },
    websites: {
      url: 'url',
      website: 'url',
      'website url': 'url',
      'url address': 'url'
    },
    education: {
      school: 'school',
      'school or university': 'school',
      degree: 'degree',
      'field of study': 'fieldOfStudy',
      fieldofstudy: 'fieldOfStudy',
      gpa: 'gpa',
      'overall result gpa': 'gpa'
    }
  };

  function matchesHost(hostname) {
    return HOSTS.test(hostname || '');
  }

  function sectionOf(el) {
    const doc = el.ownerDocument;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const id = node.getAttribute('data-automation-id') || '';
      if (!SECTION_ID.test(id)) continue;
      const prefix = id.replace(/-\d+$/, '');
      const siblings = Array.from(doc.querySelectorAll(`[data-automation-id^="${prefix}-"]`))
        .filter(item => new RegExp(`^${prefix}-\\d+$`).test(item.getAttribute('data-automation-id')));
      return { type: SECTION_PREFIXES[prefix], index: siblings.indexOf(node), node };
    }
    return null;
  }

  function dateBoundary(el, section) {
    for (let node = el; node && node !== section.node; node = node.parentElement) {
      const id = (node.getAttribute('data-automation-id') || '').toLowerCase();
      if (id.includes('startdate') || id.includes('firstyear')) return 'startDate';
      if (id.includes('enddate') || id.includes('lastyear')) return 'endDate';
      if (id.includes('issue')) return 'issued';
      if (id.includes('expir')) return 'expires';
    }
    return null;
  }

  // The parent label ("From", "To", "Issued Date", "Expiration Date") says
  // which date the Month, Day and Year boxes belong to.
  function boundaryFromLabel(label, type) {
    const text = normalize(label);
    if (type === 'certifications') {
      if (/^(date )?issued?\b|\bissued? date\b|\bissue date\b/.test(text)) return 'issued';
      if (/\bexpir|^valid until/.test(text)) return 'expires';
      return null;
    }
    if (/^(from|start)\b/.test(text)) return 'startDate';
    if (/^(to|end)\b/.test(text)) return 'endDate';
    return null;
  }

  function keyFor(field) {
    const id = field.automationId;
    const section = sectionOf(field.el);

    if (section) {
      if (field.datePart) {
        const boundary = dateBoundary(field.el, section) || boundaryFromLabel(field.dateLabel, section.type);
        if (!boundary) return null;
        return `${section.type}.${section.index}.${boundary}.${field.datePart}`;
      }
      const names = SECTION_FIELDS[section.type];
      let name = names[id.toLowerCase()] || names[normalize(field.label)];
      if (!name && section.type === 'websites' && field.kind === 'text') name = 'url';
      return name ? `${section.type}.${section.index}.${name}` : null;
    }
    return DIRECT_IDS[id] || null;
  }

  const api = { matchesHost, keyFor, sectionOf, boundaryFromLabel };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).workday = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
