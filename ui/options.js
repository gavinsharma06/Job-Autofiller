(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const { SECTIONS, LISTS } = api.profile;
  const $ = id => document.getElementById(id);

  let profile = api.profile.emptyProfile();
  // Quick Setup reads this so it never replaces manual edits that are not saved yet.
  const state = (api.optionsState = { dirty: false });
  const essentialPaths = new Set(api.profile.ESSENTIAL.map(([path]) => path));

  function refreshDirty() {
    $('unsaved').hidden = !state.dirty;
  }

  const markDirty = () => {
    state.dirty = true;
    refreshDirty();
  };

  function say(text, isError) {
    const el = $('status');
    el.textContent = text;
    el.className = isError ? 'error' : 'muted';
  }

  function fieldRow(field, value, dataset, essential) {
    const label = document.createElement('label');
    label.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = field.hint ? `${field.label} (${field.hint})` : field.label;
    if (essential) {
      const star = document.createElement('b');
      star.className = 'req';
      star.textContent = ' *';
      star.setAttribute('title', 'Needed by most application forms');
      caption.appendChild(star);
    }
    let input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
      input.value = value;
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      if (field.type === 'checkbox') input.checked = value === true;
      else input.value = value;
    }
    Object.assign(input.dataset, dataset, { key: field.key });
    if (essential) input.dataset.essential = essential;
    if (field.type === 'checkbox') label.append(input, document.createTextNode(` ${field.label}`));
    else label.append(caption, input);
    return label;
  }

  function render() {
    const form = $('form');
    form.replaceChildren();
    for (const section of SECTIONS) {
      const box = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = section.title;
      const grid = document.createElement('div');
      grid.className = 'grid';
      section.fields.forEach(field => {
        const path = `${section.id}.${field.key}`;
        grid.appendChild(fieldRow(field, profile[section.id][field.key], { section: section.id }, essentialPaths.has(path) ? path : ''));
      });
      box.append(legend, grid);
      form.appendChild(box);
    }
    for (const list of LISTS) {
      const box = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = list.title;
      box.appendChild(legend);
      profile[list.id].forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        const grid = document.createElement('div');
        grid.className = 'grid';
        list.fields.forEach(field => grid.appendChild(fieldRow(field, item[field.key], { list: list.id, index: String(index) }, '')));
        const remove = document.createElement('button');
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          profile = collect();
          profile[list.id].splice(index, 1);
          markDirty();
          render();
        });
        card.append(grid, remove);
        box.appendChild(card);
      });
      const add = document.createElement('button');
      add.textContent = `Add ${list.itemLabel.toLowerCase()}`;
      add.addEventListener('click', () => {
        profile = collect();
        profile[list.id].push(Object.fromEntries(list.fields.map(field => [field.key, field.type === 'checkbox' ? false : ''])));
        markDirty();
        render();
      });
      box.appendChild(add);
      form.appendChild(box);
    }
    highlightMissing();
  }

  // Blank cards are kept while editing; normalizeProfile drops them on save.
  function collect() {
    const draft = { schemaVersion: api.profile.SCHEMA_VERSION, personal: {}, address: {}, links: {}, education: [], employment: [] };
    document.querySelectorAll('#form [data-key]').forEach(input => {
      const value = input.type === 'checkbox' ? input.checked : input.value;
      const { section, list, index, key } = input.dataset;
      if (section) {
        draft[section][key] = value;
      } else {
        const position = Number(index);
        draft[list][position] = draft[list][position] || {};
        draft[list][position][key] = value;
      }
    });
    return draft;
  }

  // Outlines the required fields that are still empty in the form as you see it.
  function highlightMissing() {
    document.querySelectorAll('#form [data-essential]').forEach(input => {
      input.closest('label').classList.toggle('is-missing', input.value.trim() === '');
    });
  }

  function jumpTo(path) {
    const input = document.querySelector(`#form [data-essential="${path}"]`);
    if (!input) return;
    input.scrollIntoView({ block: 'center' });
    input.focus();
  }

  // Says what the saved profile can and cannot do, from storage, not from the form.
  function showBanner(saved) {
    const box = $('profile-banner');
    const text = $('profile-banner-text');
    const described = api.profile.describeProfile(saved);
    text.replaceChildren();
    const line = document.createElement('div');
    if (described.state === 'missing') {
      box.className = 'missing';
      line.textContent = 'No profile saved yet. Use Quick setup below, or fill in the Profile section and press Save profile.';
      text.appendChild(line);
      return;
    }
    const name = api.profile.getValue(saved, 'fullName') || saved.personal.email;
    if (described.state === 'ready') {
      box.className = 'ready';
      line.textContent = `Profile ready for ${name}: all essential fields are saved.`;
    } else {
      box.className = 'incomplete';
      line.textContent = `Profile saved for ${name}, but ${described.missing.length} essential ${described.missing.length === 1 ? 'field is' : 'fields are'} empty. Forms will leave these for you:`;
    }
    text.appendChild(line);
    if (described.state === 'incomplete') {
      const row = document.createElement('div');
      api.profile.ESSENTIAL.filter(([, label]) => described.missing.includes(label))
        .forEach(([path, label]) => {
          const jump = document.createElement('button');
          jump.type = 'button';
          jump.textContent = label;
          jump.addEventListener('click', () => jumpTo(path));
          row.append(jump, document.createTextNode(' '));
        });
      text.appendChild(row);
    }
    const notes = [];
    if (!saved.education.length) notes.push('No education entry is saved, so education sections stay empty.');
    if (!saved.employment.length) notes.push('No employment entries in the profile. Workday work experience comes from imported private data.');
    notes.forEach(note => {
      const small = document.createElement('div');
      small.className = 'muted';
      small.textContent = note;
      text.appendChild(small);
    });
  }

  async function renderAnswers() {
    const table = $('answers');
    const filter = $('answers-filter');
    const needle = filter.value.trim().toLowerCase();
    table.replaceChildren();
    const answers = await store.getAnswers();
    filter.hidden = answers.length < 6;
    if (!answers.length) {
      const row = table.insertRow();
      row.insertCell().textContent = 'No saved answers yet. Approve answers from the popup after a fill and they appear here.';
      return;
    }
    const shown = answers.filter(item => !needle || item.label.toLowerCase().includes(needle) || item.answer.toLowerCase().includes(needle));
    if (!shown.length) {
      table.insertRow().insertCell().textContent = 'No saved answer matches that filter.';
      return;
    }
    for (const item of shown) {
      const row = table.insertRow();
      row.insertCell().textContent = item.label;
      const edit = document.createElement('textarea');
      edit.value = item.answer;
      edit.setAttribute('aria-label', `Answer for ${item.label}`);
      row.insertCell().appendChild(edit);
      const cell = row.insertCell();
      const save = document.createElement('button');
      save.textContent = 'Save';
      save.disabled = true;
      edit.addEventListener('input', () => { save.disabled = edit.value.trim() === '' || edit.value.trim() === item.answer; });
      save.addEventListener('click', async () => {
        await store.saveAnswers(api.answers.upsertAnswer(await store.getAnswers(), item.label, edit.value));
        $('answers-status').textContent = `Saved the answer for ${item.label}.`;
        renderAnswers();
      });
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        await store.saveAnswers(api.answers.removeAnswer(await store.getAnswers(), item.question));
        $('answers-status').textContent = `Deleted the answer for ${item.label}.`;
        renderAnswers();
      });
      cell.append(save, remove);
    }
  }

  function countFilled(profileData) {
    let filled = 0;
    let total = 0;
    SECTIONS.forEach(section => section.fields.forEach(field => {
      total += 1;
      if (profileData[section.id][field.key] !== '') filled += 1;
    }));
    return { filled, total };
  }

  // Reads everything back from chrome.storage.local, so the report shows what
  // is really persisted for this extension and not what the page remembers.
  async function storageReport() {
    const saved = await store.getProfile();
    const answers = await store.getAnswers();
    const priv = api.privatedata ? api.privatedata.summarize(await store.getPrivate()) : null;
    const reports = await store.getReports();
    const { filled, total } = countFilled(saved);
    const lines = [
      `Profile fields saved: ${filled} of ${total}`,
      `Education entries: ${saved.education.length}`,
      `Employment entries: ${saved.employment.length}`,
      `Saved answers: ${answers.length}`,
      `Fill reports: ${reports.length}`
    ];
    if (priv) lines.push(`Private data: ${priv.entries} work entries, ${priv.certifications} certifications, ${priv.library} answer rules, ${priv.websites} websites`);
    const area = chrome.storage && chrome.storage.local;
    if (area && typeof area.getBytesInUse === 'function') lines.push(`Space used: ${await area.getBytesInUse(null)} bytes`);
    const id = chrome.runtime && chrome.runtime.id;
    if (id) lines.push(`Extension id: ${id}`);
    lines.push('', 'Storage belongs to the extension id. If you load the unpacked folder from a different location or a different Chrome profile, Chrome treats it as a new extension and it starts empty. Export your profile first if you plan to move it.');
    return { saved, text: lines.join('\n') };
  }

  async function showStorage(visible) {
    const { saved, text } = await storageReport();
    showBanner(saved);
    const report = $('storage-report');
    report.textContent = text;
    report.hidden = !visible;
  }

  $('save').addEventListener('click', async () => {
    const draft = api.profile.normalizeProfile(collect());
    await store.saveProfile(draft);
    // Read it back so a save that did not persist is never reported as saved.
    const stored = await store.getProfile();
    profile = stored;
    const persisted = JSON.stringify(stored) === JSON.stringify(draft);
    state.dirty = !persisted;
    refreshDirty();
    render();
    showBanner(stored);
    say(persisted ? 'Saved on this device.' : 'The browser did not keep the saved profile. Try again, and check Storage and data.', !persisted);
  });

  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(api.profile.normalizeProfile(collect()), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'job-autofiller-profile.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });

  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async event => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      profile = api.profile.normalizeProfile(JSON.parse(await file.text()));
      markDirty();
      render();
      say('Imported. Press Save profile to keep it.');
    } catch (error) {
      say('That file is not a valid profile.', true);
    }
    event.target.value = '';
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm('Delete your profile, saved answers and fill reports from this browser?')) return;
    await store.clearAll();
    profile = api.profile.emptyProfile();
    state.dirty = false;
    refreshDirty();
    render();
    renderAnswers();
    showBanner(profile);
    say('All stored data deleted.');
  });

  $('verify-storage').addEventListener('click', () => showStorage(true));
  $('answers-filter').addEventListener('input', renderAnswers);

  $('form').addEventListener('input', () => {
    markDirty();
    highlightMissing();
  });
  $('form').addEventListener('change', markDirty);

  // Edits that were never saved would be lost silently when the tab closes.
  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Quick Setup saves through the same store, then asks this page to reload it.
  document.addEventListener('jobautofiller:profile-changed', async () => {
    profile = await store.getProfile();
    state.dirty = false;
    refreshDirty();
    render();
    showBanner(profile);
  });

  (async () => {
    profile = await store.getProfile();
    render();
    showBanner(profile);
    renderAnswers();
  })().catch(error => {
    $('profile-banner-text').textContent = `Could not read stored data: ${api.text.describeError(error)}`;
  });
})();
