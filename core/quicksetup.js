(function (root) {
  const profileApi = typeof require === 'function' ? require('./profile') : root.JobAutofiller.profile;
  const matcher = typeof require === 'function' ? require('./matcher') : root.JobAutofiller.matcher;
  const { normalize } = typeof require === 'function' ? require('./text') : root.JobAutofiller.text;
  const { SCHEMA_VERSION, SECTIONS, LISTS } = profileApi;

  const LIMITS = { input: 200000, value: 2000, longValue: 5000, listItems: 30 };

  // Key names that must never be stored, whatever they hold.
  const SECRET_KEY = /password|passcode|secret|token|apikey|credential|privatekey|ssn|passport|licen[cs]e|socialsecurity|socialinsurance|nationalid|governmentid|taxid|cardnumber|cvv|dateofbirth|birthdate|dob$/;
  // Values shaped like a government identifier or a payment card number.
  const GOV_ID = /^\d{3}[- ]\d{2}[- ]\d{4}$|^\d{3}[- ]\d{3}[- ]\d{3}$|^\d{9}$/;
  const CARD = /^\d(?:[ -]?\d){12,18}$/;
  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isEmpty = value => value === '' || value === false || value == null;
  const shortKey = key => String(key).slice(0, 40);

  function isSensitiveKey(key) {
    const compact = normalize(key).replace(/ /g, '');
    return matcher.isSensitive(key) || SECRET_KEY.test(compact);
  }

  function isWebUrl(text) {
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function stripControls(text) {
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  // Returns a cleaned value, or undefined when the value must be dropped.
  // Messages name the field only, never the value.
  function checkField(field, value, where, warnings) {
    if (value === undefined || value === null) return undefined;
    if (field.type === 'checkbox') {
      if (typeof value === 'boolean') return value;
      warnings.push(`${where}: expected true or false, so it was ignored.`);
      return undefined;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      warnings.push(`${where}: expected text, so it was ignored.`);
      return undefined;
    }
    let text = String(value);
    text = field.type === 'textarea' ? stripControls(text).trim() : stripControls(text.replace(/\s+/g, ' ')).trim();
    if (!text) return undefined;
    if (/^<[^<>]*>$/.test(text)) {
      warnings.push(`${where}: looks like template text, so it was ignored.`);
      return undefined;
    }
    if (field.key !== 'phone' && (GOV_ID.test(text) || CARD.test(text))) {
      warnings.push(`${where}: looks like an identity or card number, so it was ignored.`);
      return undefined;
    }
    const max = field.type === 'textarea' ? LIMITS.longValue : LIMITS.value;
    if (text.length > max) {
      warnings.push(`${where}: shortened to ${max} characters.`);
      text = text.slice(0, max);
    }
    if (field.type === 'email' && !EMAIL.test(text)) {
      warnings.push(`${where}: not a valid email address, so it was ignored.`);
      return undefined;
    }
    if (field.type === 'url' && !isWebUrl(text)) {
      warnings.push(`${where}: needs a full web address starting with http or https, so it was ignored.`);
      return undefined;
    }
    if (field.type === 'month' && !MONTH.test(text)) {
      warnings.push(`${where}: expected YYYY-MM, so it was ignored.`);
      return undefined;
    }
    return text;
  }

  function reportUnknownKeys(source, knownKeys, where, warnings) {
    for (const key of Object.keys(source)) {
      if (knownKeys.includes(key)) continue;
      warnings.push(isSensitiveKey(key)
        ? `${where}: "${shortKey(key)}" looks sensitive. Job Autofiller never stores it, so it was ignored.`
        : `${where}: "${shortKey(key)}" is not a supported field and was ignored.`);
    }
  }

  function countFields(profile) {
    let total = 0;
    const count = item => Object.values(item).forEach(value => { if (value === true || (typeof value === 'string' && value !== '')) total++; });
    SECTIONS.forEach(section => count(profile[section.id] || {}));
    LISTS.forEach(list => (profile[list.id] || []).forEach(count));
    return total;
  }

  // Validates already parsed data. A future local resume extractor can hand its
  // output to this function and reuse the same preview and merge flow.
  function validateCandidate(raw) {
    const warnings = [];
    if (!isPlainObject(raw)) {
      return { ok: false, errors: ['The profile must be a JSON object, for example { "personal": { "firstName": "Jane" } }.'], warnings, profile: null, fieldCount: 0 };
    }
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, errors: ['This profile was made for a newer version of Job Autofiller.'], warnings, profile: null, fieldCount: 0 };
    }
    reportUnknownKeys(raw, ['schemaVersion'].concat(SECTIONS.map(s => s.id), LISTS.map(l => l.id)), 'Top level', warnings);

    const clean = {};
    for (const section of SECTIONS) {
      const source = raw[section.id];
      if (source === undefined) continue;
      if (!isPlainObject(source)) {
        warnings.push(`${section.title}: expected an object, so it was ignored.`);
        continue;
      }
      reportUnknownKeys(source, section.fields.map(f => f.key), section.title, warnings);
      clean[section.id] = {};
      for (const field of section.fields) {
        const value = checkField(field, source[field.key], `${section.title} / ${field.label}`, warnings);
        if (value !== undefined) clean[section.id][field.key] = value;
      }
    }
    for (const list of LISTS) {
      let items = raw[list.id];
      if (items === undefined) continue;
      if (!Array.isArray(items)) {
        warnings.push(`${list.title}: expected a list, so it was ignored.`);
        continue;
      }
      if (items.length > LIMITS.listItems) {
        warnings.push(`${list.title}: only the first ${LIMITS.listItems} entries were read.`);
        items = items.slice(0, LIMITS.listItems);
      }
      clean[list.id] = [];
      items.forEach((item, index) => {
        const where = `${list.itemLabel} ${index + 1}`;
        if (!isPlainObject(item)) {
          warnings.push(`${where}: expected an object, so it was ignored.`);
          return;
        }
        reportUnknownKeys(item, list.fields.map(f => f.key), where, warnings);
        const entry = {};
        for (const field of list.fields) {
          const value = checkField(field, item[field.key], `${where} / ${field.label}`, warnings);
          if (value !== undefined) entry[field.key] = value;
        }
        clean[list.id].push(entry);
      });
    }

    const profile = profileApi.normalizeProfile(clean);
    const fieldCount = countFields(profile);
    if (!fieldCount) {
      return { ok: false, errors: ['No usable values were found. Every field is optional, but at least one valid value is needed.'], warnings, profile: null, fieldCount: 0 };
    }
    return { ok: true, errors: [], warnings, profile, fieldCount };
  }

  // Turns pasted text into a validated candidate. The text is only ever parsed
  // as JSON and is never evaluated.
  function parseProfileText(text) {
    const fail = message => ({ ok: false, errors: [message], warnings: [], profile: null, fieldCount: 0 });
    if (typeof text !== 'string' || !text.trim()) return fail('Paste your profile JSON first.');
    if (text.length > LIMITS.input) return fail('That is too large to be a profile. The limit is 200,000 characters.');
    let body = text.replace(/^﻿/, '').trim();
    const extra = [];
    const fenced = /^```[A-Za-z]*\s*\r?\n([\s\S]*?)\r?\n?```$/.exec(body);
    if (fenced) {
      body = fenced[1].trim();
      extra.push('Removed the code block markers around the JSON.');
    } else if (!body.startsWith('{') && body.includes('{') && body.includes('}')) {
      body = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
      extra.push('Ignored text around the JSON.');
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      return fail('That is not valid JSON. Ask the AI to return only the JSON object.');
    }
    const result = validateCandidate(parsed);
    result.warnings = extra.concat(result.warnings);
    return result;
  }

  const LIST_ID = Object.fromEntries(LISTS.map(list => [list.id, list]));

  function sameEntry(listId, a, b) {
    const same = key => Boolean(a[key]) && normalize(a[key]) === normalize(b[key]);
    if (listId === 'education') return same('school');
    if (listId === 'employment') {
      return same('employer') && (!a.title || !b.title || normalize(a.title) === normalize(b.title));
    }
    return false;
  }

  function fieldLabel(fields, key) {
    return fields.find(field => field.key === key).label;
  }

  // Compares pasted data with the current profile. Nothing is applied here.
  function planMerge(current, incoming) {
    const cur = profileApi.normalizeProfile(current);
    const inc = profileApi.normalizeProfile(incoming);
    const changes = [];
    const newEntries = [];
    let unchanged = 0;

    const consider = (id, group, field, target, before, after) => {
      if (isEmpty(after)) return;
      if (before === after) {
        unchanged++;
        return;
      }
      changes.push({ id, group, label: field.label, target, before: isEmpty(before) ? '' : before, after, kind: isEmpty(before) ? 'add' : 'change' });
    };

    for (const section of SECTIONS) {
      for (const field of section.fields) {
        consider(`${section.id}.${field.key}`, section.title, field,
          { section: section.id, key: field.key }, cur[section.id][field.key], inc[section.id][field.key]);
      }
    }
    for (const list of LISTS) {
      inc[list.id].forEach((item, incomingIndex) => {
        const index = cur[list.id].findIndex(existing => sameEntry(list.id, item, existing));
        if (index === -1) {
          const name = item.school || [item.employer, item.title].filter(Boolean).join(', ') || list.itemLabel;
          newEntries.push({ id: `${list.id}.in${incomingIndex}`, kind: 'add', list: list.id, group: list.title, label: name, item });
          return;
        }
        for (const field of list.fields) {
          consider(`${list.id}.in${incomingIndex}.${field.key}`, `${list.itemLabel} ${index + 1}`, field,
            { list: list.id, index, key: field.key }, cur[list.id][index][field.key], item[field.key]);
        }
      });
    }
    return { changes, newEntries, unchanged };
  }

  // Additions are approved by default. Values that differ from what is already
  // saved are never approved unless the user ticks them.
  function defaultAccepted(plan) {
    const ids = plan.changes.filter(change => change.kind === 'add').map(change => change.id);
    return new Set(ids.concat(plan.newEntries.map(entry => entry.id)));
  }

  function applyPlan(current, plan, accepted) {
    const next = JSON.parse(JSON.stringify(profileApi.normalizeProfile(current)));
    for (const change of plan.changes) {
      if (!accepted.has(change.id)) continue;
      const { section, list, index, key } = change.target;
      if (section) next[section][key] = change.after;
      else next[list][index][key] = change.after;
    }
    for (const entry of plan.newEntries) {
      if (accepted.has(entry.id)) next[entry.list].push(Object.assign({}, entry.item));
    }
    return profileApi.normalizeProfile(next);
  }

  const api = { LIMITS, isSensitiveKey, validateCandidate, parseProfileText, planMerge, defaultAccepted, applyPlan, countFields };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).quicksetup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
