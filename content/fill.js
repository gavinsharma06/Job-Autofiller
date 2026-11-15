(function (root) {
  const { pickOption } = typeof require === 'function' ? require('../core/text') : root.JobAutofiller.text;
  const scan = typeof require === 'function' ? require('./scan') : root.JobAutofiller.scan;

  function fire(el, type) {
    el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
  }

  // Frameworks such as React track the value setter on the prototype, so a
  // plain assignment is ignored. Calling the native setter keeps them in sync.
  function setNativeValue(el, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    descriptor.set.call(el, value);
  }

  function fillText(el, value) {
    el.focus();
    setNativeValue(el, value);
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    return el.value === '' ? { ok: false, reason: 'rejected_by_page' } : { ok: true };
  }

  function fillSelect(field, value) {
    const options = field.options;
    let index = pickOption(options.map(option => option.text), value);
    if (index === -1) index = pickOption(options.map(option => option.value), value);
    if (index === -1) return { ok: false, reason: 'option_not_found' };
    field.el.value = options[index].value;
    fire(field.el, 'input');
    fire(field.el, 'change');
    return { ok: true };
  }

  function fillRadio(field, value) {
    const index = pickOption(field.radios.map(radio => radio.text), value);
    if (index === -1) return { ok: false, reason: 'option_not_found' };
    field.radios[index].el.click();
    return { ok: true };
  }

  function fillCheckbox(field, wanted) {
    if (field.el.checked !== wanted) field.el.click();
    return { ok: true };
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  async function fillListbox(field, value, timing) {
    const { timeout, interval } = timing;
    const button = field.el;
    const doc = button.ownerDocument;
    button.click();
    const options = await waitFor(() => findOptions(button), timeout, interval);
    if (!options) {
      closeList(button);
      return { ok: false, reason: 'unsupported_control' };
    }
    const index = pickOption(options.map(option => option.textContent), value);
    if (index === -1) {
      closeList(button);
      return { ok: false, reason: 'option_not_found' };
    }
    options[index].click();
    const changed = await waitFor(() => !scan.isPlaceholderText(button.textContent), timeout, interval);
    return changed ? { ok: true } : { ok: false, reason: 'rejected_by_page' };
  }

  async function fillField(field, value, timing) {
    switch (field.kind) {
      case 'text':
      case 'textarea': return fillText(field.el, String(value));
      case 'select': return fillSelect(field, String(value));
      case 'radio': return fillRadio(field, String(value));
      case 'checkbox': return fillCheckbox(field, value === true);
      case 'listbox': return fillListbox(field, String(value), timing);
      default: return { ok: false, reason: 'unsupported_control' };
    }
  }

  const api = { fillField, setNativeValue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).fill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
