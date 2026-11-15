(function (root) {
  if (root.__jobAutofillerLauncher) return;
  root.__jobAutofillerLauncher = true;

  const api = root.JobAutofiller;
  const store = api.storage.createStore(chrome);
  const doc = document;
  const view = doc.defaultView || root;
  const siteHost = (doc.location && doc.location.hostname) || '';
  const MARGIN = 6;
  const NUDGE = 10;

  const host = doc.createElement('div');
  host.setAttribute('data-job-autofiller', 'launcher');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '.box { position: fixed; left: 0; top: 0; z-index: 2147483647; font: 13px/1.4 system-ui, sans-serif; color: #111827;',
    '  display: flex; flex-direction: column; align-items: flex-end; gap: 4px; max-width: 280px; }',
    '.bar { display: flex; align-items: center; gap: 2px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 999px;',
    '  padding: 3px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.25); }',
    '.grip { width: 18px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: grab; color: #64748b;',
    '  border-radius: 999px; touch-action: none; user-select: none; }',
    '.grip:focus-visible, button:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }',
    '.grip.dragging { cursor: grabbing; }',
    'button { font: inherit; cursor: pointer; border: 0; border-radius: 999px; }',
    'button.fill { padding: 5px 12px; background: #1d4ed8; color: #ffffff; font-weight: 600; }',
    'button.fill:hover { background: #1e40af; }',
    'button.min { width: 24px; height: 24px; padding: 0; background: transparent; color: #475569; font-size: 16px; line-height: 1; }',
    'button.min:hover { background: #e2e8f0; }',
    '.status { margin: 0; padding: 6px 10px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 12px;',
    '  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.2); }',
    '.status:empty { display: none; }',
    '.mini .status { display: none; }',
    '.mini button.fill { padding: 5px 9px; }',
    '@media (prefers-color-scheme: dark) {',
    '  .bar, .status { background: #1e293b; border-color: #475569; color: #e2e8f0; }',
    '  button.min { color: #cbd5e1; } button.min:hover { background: #334155; }',
    '  button.fill { background: #3b82f6; color: #0b1220; } button.fill:hover { background: #60a5fa; }',
    '}'
  ].join('\n');

  const box = doc.createElement('div');
  box.className = 'box';
  const bar = doc.createElement('div');
  bar.className = 'bar';
  // The Fill button stays the first button in the tree and keeps one stable
  // name, so people and browser assistants find it in both sizes.
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'fill';
  button.setAttribute('data-action', 'fill');
  button.setAttribute('aria-label', 'Job Autofiller: fill this page');
  button.title = 'Fill this page (Alt+Shift+F)';
  const minimize = doc.createElement('button');
  minimize.type = 'button';
  minimize.className = 'min';
  minimize.setAttribute('data-action', 'minimize');
  const grip = doc.createElement('div');
  grip.className = 'grip';
  grip.setAttribute('role', 'button');
  grip.setAttribute('tabindex', '0');
  grip.setAttribute('data-action', 'move');
  grip.setAttribute('aria-label', 'Move Job Autofiller. Drag, or use the arrow keys.');
  grip.title = 'Drag to move';
  grip.textContent = '⋮⋮';
  const status = doc.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  bar.append(button, minimize, grip);
  grip.style.order = '-1';
  box.append(bar, status);
  shadow.append(style, box);

  let placement = { x: null, y: null, minimized: false };

  function size() {
    const rect = box.getBoundingClientRect();
    return { width: rect.width || 160, height: rect.height || 36 };
  }

  // Keeps the launcher fully on screen, also after the window is resized.
  function clamp(x, y) {
    const { width, height } = size();
    const maxX = Math.max(MARGIN, (view.innerWidth || 1024) - width - MARGIN);
    const maxY = Math.max(MARGIN, (view.innerHeight || 768) - height - MARGIN);
    return { x: Math.min(Math.max(MARGIN, x), maxX), y: Math.min(Math.max(MARGIN, y), maxY) };
  }

  function place(x, y) {
    const spot = clamp(x, y);
    placement.x = spot.x;
    placement.y = spot.y;
    box.style.left = `${spot.x}px`;
    box.style.top = `${spot.y}px`;
  }

  function defaults() {
    // Right edge, a third of the way down: clear of headers, footers and the
    // cookie banners that normally sit along the bottom.
    const { width } = size();
    return { x: (view.innerWidth || 1024) - width - 12, y: Math.max(96, (view.innerHeight || 768) * 0.3) };
  }

  function render() {
    box.classList.toggle('mini', placement.minimized);
    button.textContent = placement.minimized ? 'Fill' : 'Fill this page';
    minimize.textContent = placement.minimized ? '+' : '−';
    minimize.setAttribute('aria-label', placement.minimized ? 'Expand Job Autofiller' : 'Minimize Job Autofiller');
    minimize.setAttribute('aria-expanded', String(!placement.minimized));
    minimize.title = placement.minimized ? 'Expand' : 'Minimize';
  }

  function persist() {
    store.savePlacement(siteHost, { x: placement.x, y: placement.y, minimized: placement.minimized }).catch(() => {});
  }

  // Dragging only moves the box. It never reaches the fill action.
  let drag = null;
  grip.addEventListener('pointerdown', event => {
    if (event.button > 0) return;
    drag = { dx: event.clientX - placement.x, dy: event.clientY - placement.y };
    grip.classList.add('dragging');
    if (grip.setPointerCapture && event.pointerId != null) {
      try { grip.setPointerCapture(event.pointerId); } catch (error) { /* synthetic pointers cannot be captured */ }
    }
    event.preventDefault();
  });
  grip.addEventListener('pointermove', event => {
    if (drag) place(event.clientX - drag.dx, event.clientY - drag.dy);
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    grip.classList.remove('dragging');
    persist();
  }
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('keydown', event => {
    const step = event.shiftKey ? NUDGE * 5 : NUDGE;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    place(placement.x + move[0], placement.y + move[1]);
    persist();
  });

  minimize.addEventListener('click', () => {
    placement.minimized = !placement.minimized;
    render();
    place(placement.x, placement.y);
    persist();
  });

  view.addEventListener('resize', () => place(placement.x, placement.y));

  function show(text, extra) {
    status.textContent = text;
    place(placement.x, placement.y);
    // A summary of labels and outcomes only, never profile values, so a person
    // or a browser assistant can verify a run without opening the popup.
    host.setAttribute('data-report', JSON.stringify(Object.assign({ message: text }, extra || {})));
  }

  function summary(counts, missing) {
    const get = name => counts[name] || 0;
    const parts = [`Filled ${get('filled') + get('verify')}`, `needs you ${get('review')}`, `already filled ${get('existing')}`];
    if (get('conflict')) parts.push(`conflicts ${get('conflict')}`);
    if (get('invalid')) parts.push(`not accepted ${get('invalid')}`);
    let text = `${parts.join(', ')}.`;
    if (!Object.values(counts).some(Boolean)) text = 'No form fields found in this frame. If the form is embedded from another site, use the toolbar popup and allow access to it.';
    if (get('optional')) text += ` Optional, left blank ${get('optional')}.`;
    if (missing.length) text += ` Profile is missing: ${missing.join(', ')}.`;
    return text;
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
    show(summary(counts, described.state === 'incomplete' ? described.missing : []),
      { counts, missingProfile: described.missing, fields: fields.map(({ label, status: outcome, reason }) => ({ label, status: outcome, reason })) });
  }

  // Only real user input starts a fill, so a page script cannot trigger it.
  function guarded(event) {
    // api.trust exists only so tests can stand in for a real user event. Page
    // scripts cannot reach it because content scripts run in an isolated world.
    if (!(api.trust ? api.trust(event) : event.isTrusted)) return;
    run().catch(error => show(`Could not fill this page: ${api.text.describeError(error)}`));
  }

  button.addEventListener('click', guarded);
  doc.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyF') guarded(event);
  }, true);

  doc.documentElement.appendChild(host);
  render();
  const start = defaults();
  place(start.x, start.y);
  store.getPlacement(siteHost).then(saved => {
    if (!saved) return;
    placement.minimized = saved.minimized;
    render();
    place(saved.x, saved.y);
  }).catch(() => {});
  store.getProfile().then(profile => {
    const described = api.profile.describeProfile(profile);
    if (described.state === 'missing') show('No profile saved. Open the extension settings and run Quick Setup first.', { error: 'no_profile' });
    else if (described.state === 'incomplete') show(`Profile is missing: ${described.missing.join(', ')}.`, { missingProfile: described.missing });
  }).catch(error => show(api.text.describeError(error)));
})(globalThis);
