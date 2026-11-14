(function (root) {
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

  function isPlaceholderText(text) {
    return !text || /^(select|choose|please select)\b/i.test(text.trim());
  }

  function hasValue(field) {
    const el = field.el;
    switch (field.kind) {
      case 'select': return el.value !== '';
      case 'radio': return field.radios.some(radio => radio.el.checked);
      case 'checkbox': return el.checked;
      case 'listbox': return !isPlaceholderText(el.textContent);
      default: return String(el.value || '').trim() !== '';
    }
  }

  function readValue(field) {
    const el = field.el;
    switch (field.kind) {
      case 'select': return el.selectedIndex >= 0 ? el.options[el.selectedIndex].textContent.trim() : '';
      case 'radio': {
        const checked = field.radios.find(radio => radio.el.checked);
        return checked ? checked.text : '';
      }
      case 'listbox': return isPlaceholderText(el.textContent) ? '' : el.textContent.trim();
      case 'checkbox': return el.checked ? 'checked' : '';
      default: return String(el.value || '').trim();
    }
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
        return;
      } else if (type === 'checkbox') {
        field.kind = 'checkbox';
      } else if (type === 'file') {
        field.kind = 'file';
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

  const api = { collectFields, hasValue, readValue, isPlaceholderText, isHidden };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.JobAutofiller = root.JobAutofiller || {}).scan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
