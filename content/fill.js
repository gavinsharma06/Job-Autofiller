(function (root) {
  const { pickOption } = typeof require === 'function' ? require('../core/text') : root.JobAutofiller.text;
  const scan = typeof require === 'function' ? require('./scan') : root.JobAutofiller.scan;
  const multiselect = typeof require === 'function' ? require('./multiselect') : root.JobAutofiller.multiselect;
  const values = typeof require === 'function' ? require('../core/values') : root.JobAutofiller.values;

  // A page-specific matcher (for example degree wording) can replace the
  // default option matching through context.pick.
  const picker = context => (context && context.pick) || pickOption;

  function fire(el, type) {
    el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
  }

  // Frameworks such as React track the value setter on the prototype, so a
  // plain assignment is ignored. Calling the native setter keeps them in sync.
  function setNativeValue(el, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    descriptor.set.call(el, value);
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // An input event proves nothing: pages can reset or reformat the value on the
  // next tick. Every fill is therefore read back from the page after one tick,
  // and it only counts when the page holds what was meant to be entered.
  async function settle() {
    await wait(0);
  }

  async function fillText(el, value, context) {
    el.focus();
    setNativeValue(el, value);
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    await settle();
    if (String(el.value).trim() === '') return { ok: false, reason: 'rejected_by_page' };
    const key = context && context.key;
    return values.agrees(key, value, el.value) ? { ok: true } : { ok: false, reason: 'value_mismatch' };
  }

  async function fillSelect(field, value, context) {
    const options = field.options;
    let index = picker(context)(options.map(option => option.text), value);
    if (index === -1) index = pickOption(options.map(option => option.value), value);
    if (index === -1) return { ok: false, reason: 'option_not_found' };
    field.el.value = options[index].value;
    fire(field.el, 'input');
    fire(field.el, 'change');
    await settle();
    const chosen = field.el.selectedIndex >= 0 ? field.el.options[field.el.selectedIndex] : null;
    if (!chosen || chosen.value === '' || values.isPlaceholder(chosen.textContent)) return { ok: false, reason: 'rejected_by_page' };
    if (chosen.value !== options[index].value) return { ok: false, reason: 'value_mismatch' };
    return { ok: true, selected: options[index].text };
  }

  async function fillRadio(field, value, context) {
    const index = picker(context)(field.radios.map(radio => radio.text), value);
    if (index === -1) return { ok: false, reason: 'option_not_found' };
    field.radios[index].el.click();
    await settle();
    return field.radios[index].el.checked ? { ok: true, selected: field.radios[index].text } : { ok: false, reason: 'rejected_by_page' };
  }

  async function fillCheckbox(field, wanted) {
    if (field.el.checked !== wanted) field.el.click();
    await settle();
    return field.el.checked === wanted ? { ok: true } : { ok: false, reason: 'rejected_by_page' };
  }

  async function waitFor(check, timeout, interval) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = check();
      if (found) return found;
      if (Date.now() >= deadline) return null;
      await wait(interval);
    }
  }

  function closeList(button) {
    const view = button.ownerDocument.defaultView;
    button.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  // Workday also renders the current selection of other fields (for example
  // "Canada (+1)") as a listbox holding one pill option. Those must never be
  // mistaken for the list that the clicked button opened.
  function findOptions(button) {
    const doc = button.ownerDocument;
    const controlled = button.getAttribute('aria-controls');
    if (controlled) {
      const list = doc.getElementById(controlled);
      const found = list ? Array.from(list.querySelectorAll('[role="option"]')) : [];
      if (found.length) return found;
    }
    const candidates = Array.from(doc.querySelectorAll('[role="listbox"]'))
      .map(list => Array.from(list.querySelectorAll('[role="option"]'))
        .filter(option => !/press delete to clear/i.test(option.getAttribute('aria-label') || '')))
      .filter(found => found.length);
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || null;
  }

  async function fillListbox(field, value, timing, context) {
    const { timeout, interval } = timing;
    const button = field.el;
    button.click();
    const options = await waitFor(() => findOptions(button), timeout, interval);
    if (!options) {
      closeList(button);
      return { ok: false, reason: 'unsupported_control' };
    }
    const index = picker(context)(options.map(option => option.textContent), value);
    if (index === -1) {
      closeList(button);
      return { ok: false, reason: 'option_not_found' };
    }
    const chosen = options[index].textContent.replace(/\s+/g, ' ').trim();
    options[index].click();
    const changed = await waitFor(() => !scan.isPlaceholderText(button.textContent), timeout, interval);
    if (!changed) return { ok: false, reason: 'rejected_by_page' };
    await settle();
    // The box must now show the option that was clicked, not just any value.
    const shown = button.textContent.replace(/\s+/g, ' ').trim();
    return values.agrees('', chosen, shown) ? { ok: true, selected: chosen } : { ok: false, reason: 'value_mismatch' };
  }

  async function fillOne(field, value, timing, context) {
    switch (field.kind) {
      case 'text':
      case 'textarea': return fillText(field.el, String(value), context);
      case 'select': return fillSelect(field, String(value), context);
      case 'radio': return fillRadio(field, String(value), context);
      case 'checkbox': return fillCheckbox(field, value === true);
      case 'listbox': return fillListbox(field, String(value), timing, context);
      case 'multiselect':
      case 'combobox': return multiselect.fillMultiselect(field, String(value), timing, context);
      default: return { ok: false, reason: 'unsupported_control' };
    }
  }

  // A value can be a list of alternatives, tried in order while the page has
  // no option for the earlier ones (for example "LinkedIn", then "Job Board").
  async function fillField(field, value, timing, context) {
    const choices = Array.isArray(value) ? value : [value];
    let outcome = { ok: false, reason: 'option_not_found' };
    for (const choice of choices) {
      outcome = await fillOne(field, choice, timing, context);
      if (outcome.ok || (outcome.reason !== 'option_not_found' && outcome.reason !== 'unsupported_control')) return outcome;
    }
    return outcome;
  }

  const api = { fillField, setNativeValue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).fill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
