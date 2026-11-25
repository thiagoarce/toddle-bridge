# Workflow evidence and first implementation

The manual recordings cover four operational families. Counts are structural observations, not distinct product screens. No raw recordings, personal data, institution identifiers, screenshots, or authenticated profile data are included in this document.

| Family | States | Clicks | Images |
| --- | ---: | ---: | ---: |
| Assignments | 245 | 191 | 83 |
| Planning | 109 | 98 | 35 |
| Messaging | 70 | 39 | 16 |
| Announcements | 29 | 19 | 9 |

## Planning
Observed screenshots 3–12: Weekly planner list, named planner, weekly grid, existing block editor. The planner may be shared across classes. Select planner, date, day, discipline/block title and start/end time, not an ordinal or fixed screen coordinate. Description appears on the card after editing; server persistence remains unverified. Screenshots 15–21: import from unit and file picker. 23–31: batch selection, PDF export, sharing, move blocks, recurring schedule settings. Separate editing of content from editing recurring schedule. 33–35: note and existing block editor.

## Announcements
Observed screenshots 3–9: School announcements, Create announcement, textarea title, rich-text body, live preview, attachments, recipient type (staff, students, family), group (programmes, grades, classes, custom), recipient counts, per-channel toggles. Explicit draft success notification in image 9. Publishing and scheduling not verified. Do not default to all members.

## Messaging
Observed screenshots 2–9: search, existing conversation, composer, sent message visible, individual conversation. 10–13: family channel, custom channel form, membership picker, class channel. Channel creation and family messaging require separate workflows; no assumption of universal equivalence. Verify exact intended recipient and distinguish people with similar names; never replay recipient ordinals or names from recordings. Sending and channel creation are not implemented in the pilot.

## Assignments
Observed screenshots 5,38,68,73: Create new and in-folder Create menus. Four editor families: Quick task, Assessment (Formative Assessment and Performance Task variants), Learning experience, Worksheet. Library and Unit imports are separate entry options. Common metadata: title, instructions, resources; category, associated unit, duration, assessment tools and weight vary by family. The Worksheet supports question types including graphing; screenshots 46–62 show creation methods, question editing and time/assignment settings. Screenshot 29 exposes category configuration shared by the subject; don't modify category definitions during ordinary assignment creation. Screenshots 76–82 show existing assessment detail/evaluation/editing. No assignment publication verified.

## First executable pilot
Use only an authorized test environment with fictitious data. Run from the repo:
`npm.cmd run workflow:prepare -- --authorized-test-demo --file .local/job.json`

Announcement job: {"workflow":"announcement","title":"Test announcement","body":"Fictitious content"}
Planning job: {"workflow":"planning","planner":"Exact visible test planner name","week":"Exact visible week label","day":"Exact visible day label","block":"Exact block title","time":"Exact time label","body":"Fictitious planning text"}

The pilot opens the persistent browser; operator positions it at the home/empty announcement editor or selected empty planning block. The announcement pilot attempts opening School announcements and Create announcement. The planning pilot requires manual day-to-block verification. Type PREPARAR after checking the selected target. The pilot only fills empty fields and verifies visible text. It does not select recipients, publish, send messages, click Save, update recurring schedules, or attach files. The planning editor may autosave and thus change server state when filled. No automatic retries on ambiguous controls. The browser remains open until the operator reviews and presses Enter. It may fail on exact labels or selector differences; real browser testing is pending. No new dependency required.

## Next acceptance tests
1. Validate editor identity and visible text read-back in an authorized test environment.
2. Validate server persistence by reopening the intended draft/block; then add a distinct explicit draft-saving workflow.
3. Implement target-aware navigation for planner and class selection; verify date/slot association rather than mere visible labels.
4. Build separate assignment editor adapters, messaging composer and recipient picker; verify final target, content, and outcome before enabling explicit publication or sending.
