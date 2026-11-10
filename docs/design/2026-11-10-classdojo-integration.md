# ClassDojo and Class Compass: findings and recommendation

Status: proposal, nothing built. Written after a read-only feasibility probe on 2026-11-10.

## Question

Students want to see their points on Class Compass. The wish was extended to a two-way link:
show ClassDojo points in Class Compass and give points from Class Compass.

## What the probe found

The probe looked at one teacher's logged-in ClassDojo points page and recorded only request URLs,
methods and status codes. No response bodies, names or point values were read or saved.

- The teacher site is a single-page app that calls a same-origin JSON API under `/api/` with plain
  GET requests. Examples of the shapes: `dojoClass/{classId}`, `dojoClass/{classId}/student`,
  `dojoClass/{classId}/behavior`, `dojoClass/{classId}/group`, `session`.
- No token appears in any URL, so sessions are probably cookie based (not confirmed: headers were not read).
- No separate points endpoint loads with the page. Point totals may be inside the student response
  or load when a report opens. Not checked.
- No bot protection was seen on one page load; that does not rule it out.
- The key names of the student response were not read (the browser tool blocked that call and it was not worked around).
- No write endpoint was probed. Writing would change real children's records and parents are notified.

There is no public, documented ClassDojo API that we know of. This should be confirmed with ClassDojo.

## Why not a live two-way sync on the private API

- It writes to children's records under a teacher's identity; a bug or retry loop could award or remove real points.
- It needs a teacher's ClassDojo session or password stored on the Class Compass server (conflicts with AGENTS.md rule 9).
- The endpoints are undocumented and can change or be blocked without notice.
- ClassDojo's terms most likely forbid automated access to the private API. Children's data is involved, so the school's privacy duties apply.

## Options, most to least sensible

1. **Make Class Compass the points system.** Students see their points on Class Compass and teachers give them there; ClassDojo is dropped or left alone.
   Cleanest and fits the privacy rules. First check what points features exist (for example Super Speakers) and
   what the student page may show (positive things only).
2. **Ask ClassDojo for an official route** (support or partnerships): is there an integration or API for schools? Do this in parallel with option 1.
3. **A teacher-run browser helper** (extension or bookmarklet) that runs in the teacher's own logged-in ClassDojo tab and
   moves points on a button press. No credentials reach our server. Still unofficial and fragile.
   Start read-only; test any write only on a fictional test class.
4. **A server-side sync with stored credentials.** Not recommended.

## Recommendation

Option 1, with option 2 sent in parallel. If option 3 is wanted, build read-only first and only test writes on a
class of fictional students, with the owner's explicit approval.

## Before any build

- Decide with the school whether syncing with a third party is allowed at all.
- Record the decision in `docs/DECISIONS.md` (and `docs/CONVENTIONS.md` if it becomes a rule).
- Never put real student data in prompts, files, tests or screenshots.
