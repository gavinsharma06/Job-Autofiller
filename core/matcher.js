(function (root) {
  const { normalize } = typeof require === 'function' ? require('./text') : root.JobAutofiller.text;

  const HIGH = 'high';
  const MEDIUM = 'medium';

  const LABEL_RULES = [
    ['personal.firstName', /^(legal |given |your )?first name$|^given name(s| s)?$|^forename$/, HIGH],
    ['personal.middleName', /^(legal |your )?middle (name|initial)s?$/, HIGH],
    ['personal.lastName', /^(legal |family |your )?(last name|surname)$|^family name$/, HIGH],
    ['personal.preferredName', /^preferred (first )?name$|^nickname$/, HIGH],
    ['fullName', /^(full|legal|your full|complete) name$/, HIGH],
    ['fullName', /^name$/, MEDIUM],
    ['personal.email', /^(your |primary |contact |preferred )?e ?mail( address)?$|^(confirm|verify|re enter) (your )?e ?mail( address)?$/, HIGH],
    ['personal.phoneCountryCode', /^(country )?(phone|dialing|calling) code$|^country phone code$/, HIGH],
    ['personal.phone', /^(mobile |cell |cellphone |primary |contact |your )?(phone|telephone|mobile)( number| no)?$/, HIGH],
    ['address.line1', /^(street |mailing |home |current )?address( line)?( 1| one)?$|^street( address)?$/, HIGH],
    ['address.line2', /^address( line)? (2|two)$|^(apt|apartment|suite|unit)( |$)/, HIGH],
    ['address.city', /^(city|town|municipality)( of residence)?$|^city (town|municipality)$/, HIGH],
    ['address.region', /^(your )?(state|province|region|territory)( (or )?(state|province|region|territory))*( of residence)?$/, HIGH],
    ['address.postalCode', /^(zip|postal|post) ?code$|^(zip|postal)$|^(zip postal|postal zip)( code)?$/, HIGH],
    ['address.country', /^(your )?country( region| of residence)?$|^country of residence$/, HIGH],
    ['links.linkedin', /linkedin/, MEDIUM],
    ['links.github', /github/, MEDIUM],
    ['links.website', /^(personal |portfolio |your )?(website|web site|portfolio|homepage)( url| link| address)?$/, HIGH],
    ['education.0.school', /^(school|university|college|institution)( or (university|college))?( name)?$|^name of (school|university|institution)$|^school university$/, HIGH],
    ['education.0.degree', /^(degree|degree type|level of education|education level)$/, HIGH],
    ['education.0.fieldOfStudy', /^(field of study|major|area of study|discipline)$/, HIGH],
    ['education.0.gpa', /^(gpa|grade point average|cumulative gpa|overall result gpa)$/, HIGH],
    ['employment.0.employer', /^(current|most recent|latest) (company|employer)( name)?$/, HIGH],
    ['employment.0.title', /^(current|most recent|latest) (job )?title$|^current position$/, HIGH]
  ];

  const AUTOCOMPLETE = {
    'given-name': 'personal.firstName',
    'additional-name': 'personal.middleName',
    'family-name': 'personal.lastName',
    name: 'fullName',
    email: 'personal.email',
    tel: 'personal.phone',
    'tel-national': 'personal.phone',
    'street-address': 'address.line1',
    'address-line1': 'address.line1',
    'address-line2': 'address.line2',
    'address-level2': 'address.city',
    'address-level1': 'address.region',
    'postal-code': 'address.postalCode',
    country: 'address.country',
    'country-name': 'address.country'
  };

  const SENSITIVE = /\b(password|passcode|ssn|sin|social (security|insurance)|birth|dob|gender|sex|race|racial|ethnic|ethnicity|veteran|disabled|sexual orientation|pronouns?|indigenous|aboriginal|visible minority|credit card|card number|cvv|bank|account number|routing|passport|national id|driver s licen[cs]e)\b|\b(disabilit|religio)/;
  const CONSENT = /\b(agree|consent|terms|privacy policy|acknowledge|certify|i accept|declaration|attest)\b/;

  function matchLabel(label) {
    const text = normalize(label);
    if (!text) return null;
    const hits = LABEL_RULES.filter(rule => rule[1].test(text));
    if (!hits.length) return null;
    const keys = new Set(hits.map(rule => rule[0]));
    if (keys.size > 1) return { ambiguous: true };
    const confidence = hits.some(rule => rule[2] === HIGH) ? HIGH : MEDIUM;
    return { key: hits[0][0], confidence, via: 'label' };
  }

  function matchAutocomplete(value) {
    const tokens = String(value || '').toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (AUTOCOMPLETE[tokens[i]]) return { key: AUTOCOMPLETE[tokens[i]], confidence: HIGH, via: 'autocomplete' };
    }
    return null;
  }

  function matchInputType(type) {
    if (type === 'email') return { key: 'personal.email', confidence: MEDIUM, via: 'input type' };
    if (type === 'tel') return { key: 'personal.phone', confidence: MEDIUM, via: 'input type' };
    return null;
  }

  function isSensitive(label) {
    return SENSITIVE.test(normalize(label));
  }

  function isConsent(label) {
    return CONSENT.test(normalize(label));
  }

  const api = { HIGH, MEDIUM, matchLabel, matchAutocomplete, matchInputType, isSensitive, isConsent };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).matcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
