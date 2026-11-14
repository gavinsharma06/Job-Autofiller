# Job Autofiller

A Chrome extension that fills the repetitive parts of job applications (Workday and most other forms) from a profile stored on your own device. It never submits an application, never ticks consent boxes and never touches CAPTCHAs.

## Install for development

1. Open `chrome://extensions` and enable Developer mode.
2. Choose Load unpacked and select this folder.
3. Open the extension settings, enter your details and press Save profile. You can also import a JSON file shaped like `profile.example.json`.

## Use

1. Open an application form and click the extension icon.
2. Press Fill this page. The popup lists what needs you. Click an entry to jump to that field.
3. Fields are outlined on the page. Orange needs you, blue was filled with a lower confidence match, green was filled.
4. Fill the orange fields yourself, then press Review my answers to approve reusable answers for next time.
5. Review everything and submit the application yourself.

## How fields are matched

In order of confidence: Workday automation ids, the HTML `autocomplete` attribute, the field label, then the input type. Labels are matched against fixed patterns, not guessed. A field is skipped when it already has a value, when the profile has nothing for it, when a dropdown has no matching option, or when the question is sensitive (demographics, identity numbers, passwords) or a consent statement.

Approved answers are reused only when the question text matches exactly.

## Privacy

* The profile, approved answers and fill reports live in `chrome.storage.local` on this device.
* The extension requests `storage`, `activeTab` and `scripting`. It has no host permissions and runs only on the tab where you click Fill.
* The code makes no network requests.
* `private/`, `profile.json` and exported profile files are ignored by Git.

## Fill reports

After each fill the extension keeps a report of every field and what happened to it: filled, filled with a lower confidence match, already filled, or skipped with a reason. The popup lists them, and Copy report or Download report gives you the same JSON. It contains the host name, field labels, control types, Workday automation ids, matched profile field names and reasons. It never contains profile values or anything typed into the page, and labels that contain your email, phone, address, name or links are redacted.

## Known limits

* Only the top frame of the tab is filled. Forms embedded in an iframe must be opened on their own.
* Searchable dropdowns and multi select controls (for example Workday field of study and skills) are listed for you to complete.
* Workday selectors follow the markup seen in common tenants and are covered by fixtures, not by a live tenant. Copy the fill report if a field is missed.

## Development

```
npm install
npm test
```

Layout:

* `core/` pure logic: text normalising, profile schema, field matching, saved answers, reports
* `content/` page scanning, filling and the message handler injected on demand
* `adapters/` ATS specific rules (Workday)
* `storage/` thin wrapper over `chrome.storage.local`
* `ui/` popup and settings page
* `test/` unit tests and jsdom form fixtures
