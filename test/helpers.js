const { JSDOM } = require('jsdom');
const { normalizeProfile } = require('../core/profile');

function makeDom(html, url) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: url || 'https://careers.example.com/apply' });
}

function sampleProfile() {
  return normalizeProfile({
    personal: {
      firstName: 'Jane',
      lastName: 'Sample',
      email: 'jane.sample@example.com',
      phone: '902 555 0100',
      phoneCountryCode: 'Canada (+1)'
    },
    address: {
      line1: '1 Example Street',
      city: 'Halifax',
      region: 'Nova Scotia',
      postalCode: 'A1A 1A1',
      country: 'Canada'
    },
    links: { linkedin: 'https://www.linkedin.com/in/example' },
    education: [{
      school: 'Example University',
      degree: "Bachelor's Degree",
      fieldOfStudy: 'Computer Science',
      startDate: '2022-01',
      endDate: '2026-04',
      gpa: '3.5'
    }],
    employment: [
      { employer: 'Acme Cafe', title: 'Server', location: 'Halifax, NS', startDate: '2026-06', current: true, description: 'Served customers.' },
      { employer: 'Beta Foods', title: 'Cook', location: 'Halifax, NS', startDate: '2024-05', endDate: '2024-10' }
    ]
  });
}

// Simulates a custom dropdown: clicking the button opens a listbox in the body.
function wireListboxes(doc) {
  doc.querySelectorAll('button[aria-haspopup="listbox"]').forEach(button => {
    const options = JSON.parse(button.getAttribute('data-options') || '[]');
    button.addEventListener('click', () => {
      const list = doc.createElement('ul');
      list.setAttribute('role', 'listbox');
      options.forEach(text => {
        const item = doc.createElement('li');
        item.setAttribute('role', 'option');
        item.textContent = text;
        item.addEventListener('click', () => {
          button.textContent = text;
          list.remove();
        });
        list.appendChild(item);
      });
      doc.body.appendChild(list);
    });
  });
}

module.exports = { makeDom, sampleProfile, wireListboxes };
