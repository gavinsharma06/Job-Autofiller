(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const { SECTIONS, LISTS } = api.profile;
  const $ = id => document.getElementById(id);

  let profile = api.profile.emptyProfile();
  // Quick Setup reads this so it never replaces manual edits that are not saved yet.
  const state = (api.optionsState = { dirty: false });
  const markDirty = () => { state.dirty = true; };

  function say(text) {
    $('status').textContent = text;
  }

  function fieldRow(field, value, dataset) {
    const label = document.createElement('label');
    label.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = field.hint ? `${field.label} (${field.hint})` : field.label;
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
      box.appendChild(legend);
      section.fields.forEach(field => box.appendChild(fieldRow(field, profile[section.id][field.key], { section: section.id })));
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
        list.fields.forEach(field => card.appendChild(fieldRow(field, item[field.key], { list: list.id, index: String(index) })));
        const remove = document.createElement('button');
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          profile = collect();
          profile[list.id].splice(index, 1);
          markDirty();
          render();
        });
        card.appendChild(remove);
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

  async function renderAnswers() {
    const table = $('answers');
    table.replaceChildren();
    const answers = await store.getAnswers();
    if (!answers.length) {
      const row = table.insertRow();
      row.insertCell().textContent = 'No saved answers yet.';
      return;
    }
    for (const item of answers) {
      const row = table.insertRow();
      row.insertCell().textContent = item.label;
      row.insertCell().textContent = item.answer;
      const cell = row.insertCell();
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        await store.saveAnswers(api.answers.removeAnswer(await store.getAnswers(), item.question));
        renderAnswers();
      });
      cell.appendChild(remove);
    }
  }

  $('save').addEventListener('click', async () => {
    await store.saveProfile(collect());
    profile = await store.getProfile();
    state.dirty = false;
    render();
    say('Saved on this device.');
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
      say('That file is not a valid profile.');
    }
    event.target.value = '';
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm('Delete your profile, saved answers and fill reports from this browser?')) return;
    await store.clearAll();
    profile = api.profile.emptyProfile();
    state.dirty = false;
    render();
    renderAnswers();
    say('All stored data deleted.');
  });

  $('form').addEventListener('input', markDirty);
  $('form').addEventListener('change', markDirty);

  // Quick Setup saves through the same store, then asks this page to reload it.
  document.addEventListener('jobautofiller:profile-changed', async () => {
    profile = await store.getProfile();
    state.dirty = false;
    render();
  });

  (async () => {
    profile = await store.getProfile();
    render();
    renderAnswers();
  })();
})();
