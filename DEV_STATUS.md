# Job-AutoFiller dev status

Shared handoff between the application session and the development session. No personal data here.

## Current version
0.2.0 plus Workday fixes below (local commits, not yet pushed; push needs a terminal on Gavin's computer).

## Fixed (Workday test round, local commit)
* Searchable multi selects (Field of Study, Certification, How Did You Hear): type, press Enter on Workday, pick the best match, then verify the pill. Nothing is reported filled without a pill or value.
* Degree matching is tenant aware: by level first (Bachelors, BS, BA, Bachelor's Degree), by stream only when several options share a level.
* Date sections read the parent label (From, To, Issued Date, Expiration Date) and fill Month, Day and Year boxes.
* Work Experience, Certification and Websites repeaters press Add as needed, fed from private data imported in Settings (never committed).
* Canadian postal codes are written A1A 1A1, LinkedIn URLs are normalized to the www form.
* Optional fields that have no profile value show as "Optional, left blank" instead of "needs you".
* "Extension context invalidated" now says to refresh the page.
* Employer specific answer library (imported private data): phrase rules, optional host scope, alternatives, {today+7} dates, and approval each time rules.

## Fixed earlier
* Workday custom dropdowns: the fill picked the first listbox with an option, which on Workday is the "selected value" pill (for example Canada (+1)). It now uses aria-controls, then the largest list that is not a pill.
* "Province or Territory" label was not recognised as the region field.

## Active issues
* Quick Setup accepted a profile with empty address line 1 and postal code; the form then showed those required fields empty. Consider a visible "missing for Workday" note after import.
* Workday keeps aria-invalid and red errors on fields after they are filled until the next validation. Confirm on a real form that the errors clear after Save and Continue.
* Required questions that need Gavin's answer: How Did You Hear About Us (searchable multi select, not yet supported), previously employed with us.

## Next action
Reload the extension, rerun Fill this page on a real Workday My Information step, review the fill report.
