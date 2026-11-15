(function (root) {
  const { normalize, pickOption } = typeof require === 'function' ? require('../core/text') : root.JobAutofiller.text;
  const scan = typeof require === 'function' ? require('./scan') : root.JobAutofiller.scan;

  const OPTION = '[data-automation-id="promptOption"], [role="option"]';

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

  function fire(el, type) {
    el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
  }

  function key(el, type, name) {
    el.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent(type, { key: name, code: name, bubbles: true, cancelable: true }));
  }

  function setValue(el, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    descriptor.set.call(el, value);
  }

  function optionText(option) {
    return (option.getAttribute('data-automation-label') || option.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Selected pills are also exposed as options ("press delete to clear"), and
  // they sit inside the box. Neither is a search result.
  function resultOptions(input, container) {
    const doc = input.ownerDocument;
    const pills = scan.pillsOf(container);
    const ids = [input.getAttribute('aria-controls'), input.getAttribute('aria-owns')].filter(Boolean);
    let nodes = [];
    for (const id of ids) {
      const list = doc.getElementById(id);
      if (list) nodes = nodes.concat(Array.from(list.querySelectorAll(OPTION)));
    }
    if (!nodes.length) nodes = Array.from(doc.querySelectorAll(OPTION));
    return nodes.filter(node => {
      if (/press delete to clear/i.test(node.getAttribute('aria-label') || '')) return false;
      if (pills.some(pill => pill === node || pill.contains(node) || node.contains(pill))) return false;
      return !scan.isHidden(node) && optionText(node) !== '';
    });
  }

  // Search terms from most to least specific: "Applied Computer Science" also
  // tries "Computer Science". Single words are never produced from a longer
  // phrase because they are too broad to pick safely.
  function searchTerms(value) {
    const words = String(value).trim().split(/\s+/).filter(Boolean);
    const terms = [words.join(' ')];
    for (let i = 1; i < words.length - 1; i++) terms.push(words.slice(i).join(' '));
    return terms.filter(Boolean);
  }

  // Picks the option for a search. An exact match wins, then a single loose
  // match, then the shortest option that holds every word that was searched.
  function chooseOption(texts, term, original) {
    let index = pickOption(texts, original);
    if (index !== -1) return index;
    index = pickOption(texts, term);
    if (index !== -1) return index;
    const words = normalize(term).split(' ').filter(Boolean);
    if (!words.length) return -1;
    const hits = texts.map((text, i) => ({ i, norm: normalize(text) }))
      .filter(item => words.every(word => ` ${item.norm} `.includes(` ${word} `)))
      .sort((a, b) => a.norm.length - b.norm.length);
    if (!hits.length) return -1;
    if (hits.length > 1 && hits[0].norm.length === hits[1].norm.length) return -1;
    return hits[0].i;
  }

  function clickOption(option) {
    const view = option.ownerDocument.defaultView;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      option.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true }));
    });
  }

  function clearSearch(input) {
    setValue(input, '');
    fire(input, 'input');
    key(input, 'keydown', 'Escape');
  }

  function containerText(container) {
    const copy = container.cloneNode(true);
    copy.querySelectorAll(`${OPTION}, input, script, style`).forEach(node => node.remove());
    return normalize(copy.textContent);
  }

  // The value only counts as filled once the page shows it: a new pill for a
  // multi select, or the chosen text in the box for a single value combobox.
  function selectionShown(input, container, chosen, pillsBefore) {
    const pills = scan.pillsOf(container);
    const wanted = normalize(chosen);
    if (pills.some(pill => normalize(scan.pillText(pill)).includes(wanted) || wanted.includes(normalize(scan.pillText(pill))))) return true;
    if (pills.length > pillsBefore) return true;
    if (pills.length === 0 && pillsBefore === 0 && input.getAttribute('data-automation-id') !== 'searchBox') {
      return normalize(input.value).includes(wanted) || containerText(container).includes(wanted);
    }
    return false;
  }

  async function fillMultiselect(field, value, timing, context) {
    const { timeout, interval } = timing;
    const input = field.el;
    const container = scan.containerOf(input);
    const pillsBefore = scan.pillsOf(container).length;
    const enterToSearch = Boolean(context && context.enterToSearch);
    let sawOptions = false;

    for (const term of searchTerms(value)) {
      input.focus();
      setValue(input, term);
      fire(input, 'input');
      let options = await waitFor(() => { const found = resultOptions(input, container); return found.length ? found : null; }, Math.max(interval * 2, timeout / 3), interval);
      if (!options && enterToSearch) {
        key(input, 'keydown', 'Enter');
        key(input, 'keyup', 'Enter');
        options = await waitFor(() => { const found = resultOptions(input, container); return found.length ? found : null; }, timeout, interval);
      }
      if (!options) continue;
      sawOptions = true;
      const texts = options.map(optionText);
      const index = chooseOption(texts, term, value);
      if (index === -1) continue;
      const chosen = texts[index];
      clickOption(options[index]);
      const shown = await waitFor(() => selectionShown(input, container, chosen, pillsBefore), timeout, interval);
      if (!shown) {
        clearSearch(input);
        return { ok: false, reason: 'rejected_by_page' };
      }
      if (input.value !== '' && input.getAttribute('data-automation-id') === 'searchBox') clearSearch(input);
      return { ok: true, selected: chosen };
    }
    clearSearch(input);
    return { ok: false, reason: sawOptions ? 'option_not_found' : 'unsupported_control' };
  }

  const api = { fillMultiselect, searchTerms, chooseOption };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).multiselect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
