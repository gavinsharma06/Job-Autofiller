(function (root) {
  if (root.__jobAutofillerLauncher) return;
  root.__jobAutofillerLauncher = true;

  const api = root.JobAutofiller;
  const store = api.storage.createStore(chrome);
  const doc = document;

  const host = doc.createElement('div');
  host.setAttribute('data-job-autofiller', 'launcher');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '.box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font: 13px/1.4 system-ui, sans-serif;',
    '  background: #fff; color: #1b1b1b; border: 1px solid #888; border-radius: 8px; padding: 8px; max-width: 280px; }',
    'button { font: inherit; cursor: pointer; padding: 6px 10px; border-radius: 6px; border: 1px solid #1a5fb4; background: #1a5fb4; color: #fff; }',
    'p { margin: 6px 0 0; }'
  ].join('\n');
  const box = doc.createElement('div');
  box.className = 'box';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Job Autofiller: fill this page (Alt+Shift+F)';
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  box.append(button, status);
  shadow.append(style, box);

  function show(text, extra) {
    status.textContent = text;
    // A summary of labels and outcomes only, never profile values, so a person
    // or a browser assistant can verify a run without opening the popup.
    host.setAttribute('data-report', JSON.stringify(Object.assign({ message: text }, extra || {})));
  }

  async function run() {
    show('Filling...');
    const profile = await store.getProfile();
    const described = api.profile.describeProfile(profile);
    if (described.state === 'missing') {
      show('No profile saved. Open the extension settings and run Quick Setup first.', { error: 'no_profile' });
      return;
    }
    const response = await api.run.fill();
    if (response.error) {
      show(`Could not fill this page: ${response.error}`, { error: response.error });
      return;
    }
    const { counts, fields } = response;
    let text = `Filled ${counts.filled + counts.verify}, needs you ${counts.review}, already filled ${counts.existing}.`;
    if (described.state === 'incomplete') text += ` Profile is missing: ${described.missing.join(', ')}.`;
    show(text, { counts, missingProfile: described.missing, fields: fields.map(({ label, status: outcome, reason }) => ({ label, status: outcome, reason })) });
  }

  // Only real user input starts a fill, so a page script cannot trigger it.
  function guarded(event) {
    // api.trust exists only so tests can stand in for a real user event. Page
    // scripts cannot reach it because content scripts run in an isolated world.
    if (!(api.trust ? api.trust(event) : event.isTrusted)) return;
    run().catch(error => show(`Could not fill this page: ${error && error.message || error}`));
  }

  button.addEventListener('click', guarded);
  doc.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyF') guarded(event);
  }, true);

  doc.documentElement.appendChild(host);
  const initial = api.profile.describeProfile.bind(null);
  store.getProfile().then(profile => {
    const described = initial(profile);
    if (described.state === 'missing') show('No profile saved. Open the extension settings and run Quick Setup first.', { error: 'no_profile' });
    else if (described.state === 'incomplete') show(`Profile is missing: ${described.missing.join(', ')}.`, { missingProfile: described.missing });
  });
})(globalThis);
