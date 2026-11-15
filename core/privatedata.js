(function (root) {
  const { normalize } = typeof require === 'function' ? require('./text') : root.JobAutofiller.text;

  // Private data (work history chunks, certifications, standing answers) is
  // imported by the user into chrome.storage.local. It is never part of the
  // repository, so nothing in this file contains real values.
  const ROLES = ['backend', 'fullstack', 'devops', 'ai_ml', 'support'];
  const LIMITS = { short: 300, long: 5000, entries: 40, library: 80, websites: 10, certs: 20 };
  const ID = /^[a-z0-9][a-z0-9_-]{0,60}$/i;
  const DATE = /^\d{4}-\d{2}(-\d{2})?$/;
  const MONTH = /^\d{4}-\d{2}$/;

  const text = (value, max) => (typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)
    : '');

  function emptyPrivate() {
    return { rolePicks: {}, entries: {}, certifications: [], library: [], websites: [] };
  }

  function isWebUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const entry = {
      employer: text(raw.employer, LIMITS.short),
      title: text(raw.title, LIMITS.short),
      location: text(raw.location, LIMITS.short),
      startDate: MONTH.test(text(raw.startDate, 10)) ? raw.startDate : '',
      endDate: MONTH.test(text(raw.endDate, 10)) ? raw.endDate : '',
      current: raw.current === true,
      description: text(raw.description, LIMITS.long)
    };
    return entry.employer || entry.title ? entry : null;
  }

  function sanitizeCertification(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const cert = {
      name: text(raw.name, LIMITS.short),
      issuer: text(raw.issuer, LIMITS.short),
      number: text(raw.number !== undefined ? raw.number : raw.certificationNumber, 100),
      issued: DATE.test(text(raw.issued, 10)) ? raw.issued : '',
      expires: DATE.test(text(raw.expires, 10)) ? raw.expires : ''
    };
    return cert.name ? cert : null;
  }

  function sanitizeRule(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const match = (Array.isArray(raw.match) ? raw.match : [raw.match]).map(item => text(item, 200)).filter(Boolean);
    const answers = (Array.isArray(raw.answer) ? raw.answer : [raw.answer]).map(item => text(item, 1000)).filter(Boolean);
    const ask = raw.ask === true;
    if (!match.length || (!answers.length && !ask)) return null;
    const hosts = (Array.isArray(raw.hosts) ? raw.hosts : []).map(item => text(item, 100).toLowerCase()).filter(Boolean);
    return { match, answer: answers, ask, hosts };
  }

  function sanitizePrivate(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const data = emptyPrivate();
    const entries = source.entries && typeof source.entries === 'object' ? source.entries : {};
    Object.keys(entries).filter(id => ID.test(id)).slice(0, LIMITS.entries).forEach(id => {
      const entry = sanitizeEntry(entries[id]);
      if (entry) data.entries[id] = entry;
    });
    const picks = source.rolePicks && typeof source.rolePicks === 'object' ? source.rolePicks : {};
    Object.keys(picks).filter(role => /^[a-z_]{2,20}$/.test(role)).forEach(role => {
      if (Array.isArray(picks[role])) data.rolePicks[role] = picks[role].filter(id => typeof id === 'string' && ID.test(id)).slice(0, 10);
    });
    if (Array.isArray(source.certifications)) {
      data.certifications = source.certifications.map(sanitizeCertification).filter(Boolean).slice(0, LIMITS.certs);
    }
    if (Array.isArray(source.library)) {
      data.library = source.library.map(sanitizeRule).filter(Boolean).slice(0, LIMITS.library);
    }
    if (Array.isArray(source.websites)) {
      data.websites = source.websites.map(item => text(item, 300)).filter(isWebUrl).slice(0, LIMITS.websites);
    }
    return data;
  }

  // Source files keep the shapes the job hunt notes already use.
  function classify(json) {
    if (!json || typeof json !== 'object') return '';
    if (Array.isArray(json.projects) && json.role_picks && typeof json.role_picks === 'object') return 'projects';
    if (Array.isArray(json.certifications)) return 'certifications';
    if (Array.isArray(json.library) || Array.isArray(json.websites)) return 'library';
    return '';
  }

  // Returns { data, kind, count } or null when the file is not recognised.
  function importFile(existing, json) {
    const kind = classify(json);
    if (!kind) return null;
    const data = sanitizePrivate(existing);
    if (kind === 'projects') {
      data.rolePicks = json.role_picks;
      data.entries = {};
      json.projects.forEach(project => {
        if (project && typeof project.id === 'string' && project.employment_entry) data.entries[project.id] = project.employment_entry;
      });
    } else if (kind === 'certifications') {
      data.certifications = json.certifications.map(item => (item && typeof item === 'object' ? {
        name: item.name, issuer: item.issuer, number: item.certificationNumber !== undefined ? item.certificationNumber : item.number,
        issued: item.issued, expires: item.expires
      } : null));
    } else {
      if (Array.isArray(json.library)) data.library = json.library;
      if (Array.isArray(json.websites)) data.websites = json.websites;
    }
    const clean = sanitizePrivate(data);
    const count = { projects: Object.keys(clean.entries).length, certifications: clean.certifications.length, library: clean.library.length }[kind];
    return { data: clean, kind, count };
  }

  function summarize(data) {
    const clean = sanitizePrivate(data);
    return {
      entries: Object.keys(clean.entries).length,
      certifications: clean.certifications.length,
      library: clean.library.length,
      websites: clean.websites.length
    };
  }

  const ROLE_RULES = [
    ['support', /\b(support|help ?desk|service desk|technical analyst|it technician|desktop)\b/],
    ['devops', /\b(devops|sre|site reliability|cloud|infrastructure|platform engineer)\b/],
    ['ai_ml', /\b(ai|machine learning|ml|data scientist|artificial intelligence)\b/],
    ['fullstack', /\b(full ?stack|front ?end|web developer)\b/],
    ['backend', /\b(back ?end|software|developer|engineer|java|python)\b/]
  ];

  function detectRole(pageText) {
    const value = normalize(pageText);
    const hit = ROLE_RULES.find(([, pattern]) => pattern.test(value));
    return hit ? hit[0] : '';
  }

  function workEntries(data, role, max) {
    const clean = data || emptyPrivate();
    const wanted = ROLES.includes(role) ? role : 'backend';
    return (clean.rolePicks[wanted] || [])
      .map(id => clean.entries[id])
      .filter(Boolean)
      .slice(0, max || 3);
  }

  function websiteList(data, profile) {
    const own = data && data.websites && data.websites.length ? data.websites : [];
    const links = profile && profile.links ? [profile.links.github, profile.links.website] : [];
    const seen = new Set();
    return own.concat(links).filter(url => typeof url === 'string' && url && !seen.has(url) && seen.add(url));
  }

  function hostMatches(rule, host) {
    if (!rule.hosts.length) return true;
    const name = String(host || '').toLowerCase();
    return rule.hosts.some(item => name.includes(item));
  }

  // The longest matching phrase wins, so a specific rule beats a general one.
  function findRule(library, label, host) {
    const question = ` ${normalize(label)} `;
    if (question.trim() === '' || !Array.isArray(library)) return null;
    let best = null;
    let bestScore = 0;
    for (const rule of library) {
      if (!hostMatches(rule, host)) continue;
      for (const phrase of rule.match) {
        const needle = normalize(phrase);
        if (!needle || !question.includes(` ${needle} `)) continue;
        const score = needle.length + (rule.hosts.length ? 1000 : 0);
        if (score > bestScore) {
          best = rule;
          bestScore = score;
        }
      }
    }
    return best;
  }

  function isoDate(date) {
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // {today} and {today+7} become an ISO date, for example a start date one
  // week after the application date.
  function resolveAnswer(answer, now) {
    return String(answer).replace(/\{today(?:\+(\d{1,3}))?\}/g, (whole, days) => {
      const date = new Date(now || Date.now());
      date.setDate(date.getDate() + Number(days || 0));
      return isoDate(date);
    });
  }

  const api = {
    ROLES, emptyPrivate, sanitizePrivate, classify, importFile, summarize, detectRole,
    workEntries, websiteList, findRule, resolveAnswer
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).privatedata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
