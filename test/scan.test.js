const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scan = require('../content/scan');
const { makeDom } = require('./helpers');

const generic = fs.readFileSync(path.join(__dirname, 'fixtures/generic.html'), 'utf8');

function byLabel(fields, label) {
  return fields.find(field => field.label === label);
}

test('labels are found through for, wrapping label, aria and placeholder', () => {
  const dom = makeDom(`
    <label for="a">Alpha</label><input id="a">
    <label>Beta <input id="b"></label>
    <span id="gamma-label">Gamma</span><input id="c" aria-labelledby="gamma-label">
    <input id="d" aria-label="Delta">
    <input id="e" placeholder="Epsilon">
  `);
  const fields = scan.collectFields(dom.window.document);
  assert.deepEqual(fields.map(field => [field.label, field.labelSource]), [
    ['Alpha', 'label'],
    ['Beta', 'label'],
    ['Gamma', 'aria-labelledby'],
    ['Delta', 'aria-label'],
    ['Epsilon', 'placeholder']
  ]);
});

test('hidden, disabled and non text inputs are skipped', () => {
  const fields = scan.collectFields(makeDom(generic).window.document);
  const labels = fields.map(field => field.label);
  assert.equal(labels.includes('First name'), false);
  assert.equal(fields.some(field => field.el.id === 'secret'), false);
  assert.equal(fields.some(field => field.el.id === 'pw'), false);
  assert.equal(fields.some(field => field.el.id === 'submit'), false);
  assert.equal(fields.filter(field => field.label === 'First Name *').length, 1);
});

test('radio buttons collapse into one group labelled by the legend', () => {
  const fields = scan.collectFields(makeDom(generic).window.document);
  const group = byLabel(fields, 'Are you legally authorized to work in Canada?');
  assert.equal(group.kind, 'radio');
  assert.deepEqual(group.radios.map(radio => radio.text), ['Yes', 'No']);
});

test('field kinds and existing values are detected', () => {
  const dom = makeDom(generic);
  dom.window.document.getElementById('first_name').value = 'Keep';
  const fields = scan.collectFields(dom.window.document);
  assert.equal(byLabel(fields, 'First Name *').hasValue, true);
  assert.equal(byLabel(fields, 'Last Name *').hasValue, false);
  assert.equal(byLabel(fields, 'Country').kind, 'select');
  assert.equal(byLabel(fields, 'Resume').kind, 'file');
  assert.equal(byLabel(fields, 'Why do you want to work here?').kind, 'textarea');
});
