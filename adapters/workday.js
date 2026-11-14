(function (root) {
  const { normalize } = typeof require === 'function' ? require('../core/text') : root.JobAutofiller.text;

  const HOSTS = /(^|\.)(myworkdayjobs|myworkdaysite|wd\d+\.myworkday)\.com$|(^|\.)workday\.com$/i;

  const SECTION_PREFIXES = { workExperience: 'employment', education: 'education' };

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
      const match = /^(workExperience|education)-\d+$/.exec(id);
      if (!match) continue;
      const prefix = match[1];
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
    }
    return null;
  }

  function keyFor(field) {
    const id = field.automationId;
    const section = sectionOf(field.el);

    if (section) {
      const part = /dateSection(Month|Year)-input/.exec(id);
      if (part) {
        const boundary = dateBoundary(field.el, section);
        if (!boundary) return null;
        return `${section.type}.${section.index}.${boundary}.${part[1].toLowerCase()}`;
      }
      const names = SECTION_FIELDS[section.type];
      const name = names[id.toLowerCase()] || names[normalize(field.label)];
      return name ? `${section.type}.${section.index}.${name}` : null;
    }
    return DIRECT_IDS[id] || null;
  }

  const api = { matchesHost, keyFor, sectionOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).workday = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
