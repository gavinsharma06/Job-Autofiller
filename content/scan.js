(function (root) {
  const values = typeof require === 'function' ? require('../core/values') : root.JobAutofiller.values;
  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search', 'range', 'color']);
  const SELECTOR = 'input, select, textarea, button[aria-haspopup="listbox"]';

  function isHidden(el) {
    const view = el.ownerDocument.defaultView;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return true;
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    return false;
  }

  function textOf(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('input, select, textarea, button, script, style').forEach(child => child.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  }

  function labelIndex(doc) {
    const map = new Map();
    doc.querySelectorAll('label[for]').forEach(label => {
      const id = label.getAttribute('for');
      if (!map.has(id)) map.set(id, label);
    });
    return map;
  }

  function describeLabel(el, labels) {
    const doc = el.ownerDocument;
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    if (ids.length) {
      const text = ids.map(id => doc.getElementById(id)).filter(Boolean).map(textOf).join(' ').trim();
      if (text) return { text, source: 'aria-labelledby' };
    }
    if (el.id && labels.has(el.id)) {
      const text = textOf(labels.get(el.id));
      if (text) return { text, source: 'label' };
    }
    const wrapper = el.closest('label');
    if (wrapper) {
      const text = textOf(wrapper);
      if (text) return { text, source: 'label' };
    }
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return { text: aria, source: 'aria-label' };
    const placeholder = (el.getAttribute('placeholder') || '').trim();
    if (placeholder) return { text: placeholder, source: 'placeholder' };
    return { text: '', source: '' };
  }

  function groupLabel(el) {
    const doc = el.ownerDocument;
    const fieldset = el.closest('fieldset');
    const legend = fieldset && fieldset.querySelector('legend');
    if (legend && textOf(legend)) return textOf(legend);
    const group = el.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const ids = (group.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      const text = ids.map(id => doc.getElementById(id)).filter(Boolean).map(textOf).join(' ').trim();
      if (text) return text;
      const aria = (group.getAttribute('aria-label') || '').trim();
      if (aria) return aria;
    }
    return '';
  }

  function selectOptions(select) {
    return Array.from(select.options)
      .filter(option => option.value !== '' && !option.disabled)
      .map(option => ({ text: option.textContent.trim(), value: option.value }));
  }

  // A placeholder such as "Select One" or "No answer" is not a chosen value.
  function isPlaceholderText(text) {
    return values.isPlaceholder(text);
  }

  const MULTISELECT = '[data-automation-id="multiSelectContainer"], [data-uxi-widget-type="multiselect"]';
  const PILL = '[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] li, [data-automation-id="DELETE_charm"], [aria-label*="press delete to clear" i]';

  function isMultiselect(el) {
    return el.getAttribute('data-automation-id') === 'searchBox' || Boolean(el.closest(MULTISELECT));
  }

  // The box that holds the search input together with its selected pills.
  function containerOf(el) {
    return el.closest(MULTISELECT) || el.closest('[data-automation-id^="formField"]') || el.parentElement;
  }

  // Selected values show as pills. Several selectors can hit the same pill, so
  // each one is reduced to its outermost pill element.
  function pillsOf(container) {
    const found = [];
    container.querySelectorAll(PILL).forEach(node => {
      const pill = node.matches('[data-automation-id="DELETE_charm"]') ? node.parentElement : node;
      if (pill && !found.some(item => item === pill || item.contains(pill) || pill.contains(item))) found.push(pill);
    });
    return found;
  }

  function pillText(pill) {
    return (pill.getAttribute('data-automation-label') || pill.textContent || '').replace(/\s+/g, ' ').trim();
  }

  const DATE_PART_ID = /dateSection(Month|Day|Year)-input/i;
  const PART_WORDS = /^(month|day|year|mm|dd|yyyy)$/;

  function datePartOf(el) {
    const byId = DATE_PART_ID.exec(el.getAttribute('data-automation-id') || '');
    if (byId) return byId[1].toLowerCase();
    if (el.getAttribute('role') !== 'spinbutton') return '';
    const hint = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
    if (/\bmonth\b|\bmm\b/.test(hint)) return 'month';
    if (/\bday\b|\bdd\b/.test(hint)) return 'day';
    if (/\byear\b|\byyyy\b/.test(hint)) return 'year';
    return '';
  }

  // Month, Day and Year boxes are labelled only by their own part name, so the
  // question they belong to ("From", "Issued Date") is read from the parent.
  function dateGroupLabel(el, part) {
    const doc = el.ownerDocument;
    for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      const siblings = Array.from(node.querySelectorAll('input')).filter(input => datePartOf(input) === part);
      if (siblings.length > 1) return '';
      const ids = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      let found = ids.map(id => doc.getElementById(id)).filter(Boolean).map(textOf).join(' ').trim();
      if (!found && node.matches('[role="group"], fieldset')) found = (node.getAttribute('aria-label') || '').trim();
      if (!found) {
        const label = Array.from(node.querySelectorAll('label, legend')).find(item => {
          const own = textOf(item).toLowerCase().replace(/[^a-z]/g, '');
          return own && !PART_WORDS.test(own);
        });
        if (label) found = textOf(label);
      }
      if (found && !PART_WORDS.test(found.toLowerCase().replace(/[^a-z]/g, ''))) return found;
    }
    return '';
  }

  function isRequired(el, rawLabel) {
    return el.required === true || el.getAttribute('aria-required') === 'true' || /\*|\(required\)/i.test(rawLabel || '');
  }

  const SHOWN_VALUE = '[class*="single-value"], [class*="singleValue"], [class*="SingleValue"]';

  function shownSelection(el) {
    for (let node = el.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      const found = node.querySelector(SHOWN_VALUE);
      if (found) {
        const text = found.textContent.replace(/\s+/g, ' ').trim();
        return isPlaceholderText(text) ? '' : text;
      }
    }
    return '';
  }

  function selectedText(el) {
    return el.selectedIndex >= 0 ? el.options[el.selectedIndex].textContent.trim() : '';
  }

  // Only a real choice counts. An empty box, a placeholder option or a default
  // such as "No answer" is reported as no value.
  function readValue(field) {
    const el = field.el;
    switch (field.kind) {
      case 'select': {
        const text = selectedText(el);
        return el.value === '' || isPlaceholderText(text) ? '' : text;
      }
      case 'radio': {
        const checked = field.radios.find(radio => radio.el.checked);
        return checked && !isPlaceholderText(checked.text) ? checked.text : '';
      }
      case 'listbox': return isPlaceholderText(el.textContent) ? '' : el.textContent.replace(/\s+/g, ' ').trim();
      case 'checkbox': return el.checked ? 'checked' : '';
      case 'multiselect': return pillsOf(containerOf(el)).map(pillText).filter(text => !isPlaceholderText(text)).join(', ');
      case 'combobox': {
        // Searchable dropdowns keep the search box empty and show the chosen
        // value in a sibling element, so that is read as well.
        const typed = String(el.value || '').trim();
        return isPlaceholderText(typed) ? shownSelection(el) : typed;
      }
      default: {
        const text = String(el.value || '').trim();
        return isPlaceholderText(text) ? '' : text;
      }
    }
  }

  function hasValue(field) {
    return readValue(field) !== '';
  }

  function collectFields(doc) {
    const labels = labelIndex(doc);
    const fields = [];
    const radioGroups = new Map();

    doc.querySelectorAll(SELECTOR).forEach(el => {
      if (el.disabled || el.readOnly || isHidden(el)) return;
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
      if (tag === 'input' && SKIP_INPUT_TYPES.has(type)) return;

      const label = describeLabel(el, labels);
      const field = {
        el,
        tag,
        type,
        label: label.text,
        labelSource: label.source,
        automationId: el.getAttribute('data-automation-id') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        name: el.getAttribute('name') || ''
      };

      const part = tag === 'input' ? datePartOf(el) : '';
      if (part) {
        field.datePart = part;
        field.dateLabel = dateGroupLabel(el, part);
        if (field.dateLabel) field.label = field.dateLabel;
      }
      field.required = isRequired(el, part ? field.dateLabel : label.text);

      if (tag === 'select') {
        field.kind = 'select';
        field.options = selectOptions(el);
      } else if (tag === 'textarea') {
        field.kind = 'textarea';
      } else if (tag === 'button') {
        field.kind = 'listbox';
      } else if (type === 'radio') {
        const key = el.name || el.id;
        const text = label.text || el.value;
        let group = radioGroups.get(key);
        if (!group) {
          group = Object.assign(field, { kind: 'radio', label: groupLabel(el), labelSource: 'group', radios: [] });
          radioGroups.set(key, group);
          fields.push(group);
        }
        group.radios.push({ el, text });
        group.required = group.required || isRequired(el, group.label);
        return;
      } else if (type === 'checkbox') {
        field.kind = 'checkbox';
      } else if (type === 'file') {
        field.kind = 'file';
      } else if (isMultiselect(el)) {
        field.kind = 'multiselect';
      } else if (el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete')) {
        field.kind = 'combobox';
      } else {
        field.kind = 'text';
      }
      fields.push(field);
    });

    fields.forEach((field, index) => {
      field.index = index;
      field.hasValue = field.kind === 'file' ? false : hasValue(field);
    });
    return fields;
  }

  const api = { collectFields, hasValue, readValue, isPlaceholderText, isHidden, containerOf, pillsOf, pillText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).scan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
