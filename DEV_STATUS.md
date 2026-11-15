# Job-AutoFiller dev status

Shared handoff between the application session and the development session. No personal data here.

## Current version
0.2.0 plus Workday fixes below (local commits, not yet pushed; push needs a terminal on Gavin's computer).

## Fixed
* Workday custom dropdowns: the fill picked the first listbox with an option, which on Workday is the "selected value" pill (for example Canada (+1)). It now uses aria-controls, then the largest list that is not a pill.
* "Province or Territory" label was not recognised as the region field.

## Active issues
* Quick Setup accepted a profile with empty address line 1 and postal code; the form then showed those required fields empty. Consider a visible "missing for Workday" note after import.
* Workday keeps aria-invalid and red errors on fields after they are filled until the next validation. Confirm on a real form that the errors clear after Save and Continue.
* Required questions that need Gavin's answer: How Did You Hear About Us (searchable multi select, not yet supported), previously employed with us.

## Next action
Reload the extension, rerun Fill this page on a real Workday My Information step, review the fill report.
