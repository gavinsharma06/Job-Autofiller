(function () {
  const api = JobAutofiller;
  const store = api.storage.createStore(chrome);
  const $ = id => document.getElementById(id);

  function say(text) {
    $('pd-status').textContent = text;
  }

  async function describe() {
    const counts = api.privatedata.summarize(await store.getPrivate());
    return `Stored: ${counts.entries} work entries, ${counts.certifications} certifications, ${counts.library} answer rules, ${counts.websites} websites.`;
  }

  $('pd-import').addEventListener('click', () => $('pd-file').click());

  // Files are told apart by their shape, so the source files can be imported
  // as they are. Only counts are shown, never the contents.
  $('pd-file').addEventListener('change', async event => {
    const files = Array.from(event.target.files || []);
    let data = await store.getPrivate();
    const notes = [];
    for (const file of files) {
      try {
        const result = api.privatedata.importFile(data, JSON.parse(await file.text()));
        if (result) {
          data = result.data;
          notes.push(`${result.kind}: ${result.count}`);
        } else {
          notes.push('one file was not recognised');
        }
      } catch (error) {
        notes.push('one file was not valid JSON');
      }
    }
    await store.savePrivate(data);
    event.target.value = '';
    say(`${notes.join(', ')}. ${await describe()}`);
  });

  $('pd-clear').addEventListener('click', async () => {
    await store.clearPrivate();
    say(`Private data cleared. ${await describe()}`);
  });

  describe().then(say);
})();
