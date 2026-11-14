(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const quick = api.quicksetup;
  const $ = id => document.getElementById(id);

  const prompt = api.setupPrompt.buildSetupPrompt();
  $('qs-prompt').textContent = prompt;
  $('qs-privacy').textContent = api.setupPrompt.PRIVACY_NOTICE;

  function say(text, isError) {
    const el = $('qs-status');
    el.textContent = text;
    el.className = isError ? 'error' : 'muted';
  }

  function show(value) {
    if (value === true) return 'Yes';
    return value === '' || value === false || value == null ? '(empty)' : String(value);
  }

  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function hidePreview() {
    const area = $('qs-preview-area');
    area.hidden = true;
    area.replaceChildren();
  }

  function summarize(item) {
    return Object.entries(item)
      .filter(([, value]) => value === true || (typeof value === 'string' && value !== ''))
      .map(([, value]) => (value === true ? 'Yes' : value))
      .join(', ')
      .slice(0, 160);
  }

  function mergeTable(plan, accepted) {
    const table = element('table');
    let lastGroup = null;
    const addGroup = name => {
      if (name === lastGroup) return;
      lastGroup = name;
      const row = table.insertRow();
      row.className = 'group';
      const cell = row.insertCell();
      cell.colSpan = 4;
      cell.textContent = name;
    };
    const addRow = (id, label, before, after, note) => {
      const row = table.insertRow();
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = accepted.has(id);
      box.setAttribute('aria-label', `Apply ${label}`);
      box.addEventListener('change', () => (box.checked ? accepted.add(id) : accepted.delete(id)));
      row.insertCell().appendChild(box);
      row.insertCell().textContent = label;
      row.insertCell().textContent = before;
      const cell = row.insertCell();
      cell.textContent = after;
      if (note) cell.appendChild(element('span', note, 'tag'));
    };
    plan.changes.forEach(change => {
      addGroup(change.group);
      addRow(change.id, change.label, show(change.before), show(change.after),
        change.kind === 'change' ? 'Differs from your saved value. Tick to overwrite it.' : '');
    });
    plan.newEntries.forEach(entry => {
      addGroup(entry.group);
      addRow(entry.id, 'New entry', '(none)', summarize(entry.item), 'Added as a new entry.');
    });
    return table;
  }

  function renderPreview(result, current) {
    const area = $('qs-preview-area');
    const hasCurrent = quick.countFields(current) > 0;
    const plan = quick.planMerge(current, result.profile);
    const accepted = quick.defaultAccepted(plan);
    let mode = 'merge';

    function draw() {
      area.replaceChildren();
      area.hidden = false;
      area.appendChild(element('h3', 'Review before saving'));
      if (result.warnings.length) {
        area.appendChild(element('p', 'Notes about the pasted data:', 'muted'));
        const list = element('ul', undefined, 'warnings');
        result.warnings.forEach(text => list.appendChild(element('li', text)));
        area.appendChild(list);
      }

      if (hasCurrent) {
        const choices = element('div', undefined, 'row');
        [['merge', 'Merge with my current profile'], ['replace', 'Replace my current profile']].forEach(([value, text]) => {
          const label = element('label');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'qs-mode';
          radio.value = value;
          radio.checked = mode === value;
          radio.addEventListener('change', () => { mode = value; draw(); });
          label.append(radio, document.createTextNode(` ${text}`));
          choices.appendChild(label);
        });
        area.appendChild(choices);
      }

      let canSave = true;
      if (mode === 'merge') {
        const adds = plan.changes.filter(change => change.kind === 'add').length + plan.newEntries.length;
        const diffs = plan.changes.length - plan.changes.filter(change => change.kind === 'add').length;
        if (!plan.changes.length && !plan.newEntries.length) {
          area.appendChild(element('p', 'Nothing new. Everything you pasted already matches your saved profile.'));
          canSave = false;
        } else {
          area.appendChild(element('p', `${adds} new, ${diffs} different from saved, ${plan.unchanged} already the same. Your saved values stay as they are unless you tick them.`, 'muted'));
          area.appendChild(mergeTable(plan, accepted));
        }
      } else {
        area.appendChild(element('p', `This replaces everything saved (${quick.countFields(current)} values) with the pasted data (${result.fieldCount} values). Anything not in the paste is cleared.`));
      }

      const row = element('div', undefined, 'row');
      const save = element('button', mode === 'merge' ? 'Save approved changes' : 'Replace profile', 'primary');
      save.style.width = 'auto';
      save.disabled = !canSave;
      save.addEventListener('click', () => commit(result, mode, accepted, plan));
      const cancel = element('button', 'Cancel');
      cancel.addEventListener('click', () => { hidePreview(); say(''); });
      row.append(save, cancel);
      area.appendChild(row);
    }
    draw();
  }

  async function commit(result, mode, accepted, reviewedPlan) {
    if (api.optionsState && api.optionsState.dirty) {
      say('You have unsaved manual edits below. Save them first, then run Quick setup again.', true);
      return;
    }
    // Read the saved profile again so a change made meanwhile is never overwritten.
    const fresh = await store.getProfile();
    let next;
    let message;
    if (mode === 'replace') {
      if (!confirm('Replace your saved profile with the pasted data? Anything not in the paste will be cleared.')) return;
      next = result.profile;
      message = 'Profile replaced on this device.';
    } else {
      const plan = quick.planMerge(fresh, result.profile);
      // A value that only became a conflict after review was never shown as one, so it is not applied.
      const reviewedConflicts = new Set(reviewedPlan.changes.filter(change => change.kind === 'change').map(change => change.id));
      const approved = new Set([...accepted].filter(id => {
        const change = plan.changes.find(item => item.id === id);
        return !change || change.kind === 'add' || reviewedConflicts.has(id);
      }));
      const chosen = plan.changes.filter(change => approved.has(change.id)).length + plan.newEntries.filter(entry => approved.has(entry.id)).length;
      next = quick.applyPlan(fresh, plan, approved);
      message = `Saved ${chosen} approved ${chosen === 1 ? 'change' : 'changes'} on this device.`;
    }
    await store.saveProfile(next);
    $('qs-input').value = '';
    hidePreview();
    document.dispatchEvent(new CustomEvent('jobautofiller:profile-changed'));
    say(message);
  }

  async function review() {
    hidePreview();
    const result = quick.parseProfileText($('qs-input').value);
    if (!result.ok) {
      say(result.errors[0], true);
      return;
    }
    say('');
    renderPreview(result, await store.getProfile());
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      say('Prompt copied. It has no personal data in it. Paste it into an AI assistant of your choice, if you want to use one.');
    } catch (error) {
      say('Could not copy automatically. Open "Show the prompt that gets copied" and copy it by hand.', true);
    }
  }

  $('qs-review').addEventListener('click', review);
  $('qs-copy').addEventListener('click', copyPrompt);
  $('qs-reset').addEventListener('click', () => {
    $('qs-input').value = '';
    hidePreview();
    say('');
  });
})();
