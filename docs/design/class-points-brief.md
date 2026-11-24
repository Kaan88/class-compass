# Class points with targets: design brief

Status: proposal, 2026-11-24. Nothing is built. The owner and the teacher decide from this file; a
developer builds from it afterwards. Decision and stage numbers in this file are proposals (the next
free ones today are D-218 and S37).

The request, in the teacher's words: "Burada her çocuğa puan verilsin, puan değerleri ve ne
olduklarını öğretmen belirlesin, ekleme çıkarma yapılsın, class dojo gibi olsun, hedefler olsun her
hedefe ulaşan çocuk oyuncak getirsin tanıtsın, stiker kazansın, badge kazansın." The owner adds:
"badge" is the existing achievements system, children probably want to see their achievements in the
classroom too, and this system may get achievements of its own.

This brief follows `docs/design/2026-11-10-classdojo-integration.md`, which recommended "make Class
Compass the points system" instead of syncing with ClassDojo.

All names in this file are fictional (the demo school's style).

## Decisions (owner and teacher, 2026-11-25)

The owner's answers after looking at the mockups (`docs/design/class-points-mockups/index.html`).
Quoted words are the owner's, verbatim. Short **Decided:** notes in the sections below point back here;
everything that was not decided keeps this brief's proposal.

**Outside the numbered questions:**

- **Board concept** (section 10): "concept 1". → Star paths (10.2): each child's path to their own next target, in name order. The class jar (question 9) is added to it.
- **Giving screen** (new): "combine the screen with achievements and stars buttong. make a mockup of the page only." → One dock button and one classroom screen to give both stars and achievements, instead of an Achievements button and a Class stars button. Mockup: `docs/design/class-points-mockups/give.html`. This changes an existing feature (the achievements panel and its dialog), so it needs its own decision (proposed D-227, section 7).

**The open questions of section 9, in their order:**

1. **Taking stars away: correction only, or also for behaviour?** "option b".
   → Option B (section 2): "needs work" reasons with −1 to −3, given only in the teacher area or from her own device, never from the classroom display; never an event on any classroom screen (no line, sound, animation, colour or reason text); a total never goes below 0 or below the last target reached in the period; the student page shows the total only. Stage S37e is part of the first version; AGENTS rule 7 and CONVENTIONS get the Option B sentence (section 7).
2. **Board: every child's stars, or only the jar and each child's own card?** "Should the board show every child's stars = yes".
   → Every child's stars on the board in name order with their own next target (`showOnBoard: 'all'`, the default).
3. **Is a ranking wanted?** "3 no ranking".
   → No ranking, no top three, no sorting by total, anywhere on a classroom screen. The alternatives table in 4.1 is closed.
4. **Which targets and which period?** "sensible defaults, and adjustable from teacher screen".
   → The module ships a default ladder and period, and the teacher changes both (thresholds, names, stickers, period, "a new target every N stars") on her setup page in the teacher area. Defaults to build: 25 / 50 / 100 per term (see To confirm).
5. **Show and tell: at every target or only some? Who chooses the day?** "first achivement, adjustable".
   → Read as: a show-and-tell turn is on by default for the **first target** only (Bronze star, 25), and the teacher switches it on or off per target. The day: not answered; the brief's proposal stays (the teacher plans the day; the child can say "not this time" without losing anything). See To confirm.
6. **PIN to give stars on the smartboard?** "no pin".
   → No PIN to give stars (and, as today, achievements) on the classroom screen. Editing reasons and targets, removals and Option B deductions stay `teacher` access (PIN-gated in classroom mode). The optional class setting "give stars only from my own devices" was not discussed and stays proposed.
7. **One star system per class+subject, or one per class shared by its teachers?** "7- per class per teacher".
   → Not shared between teachers: each teacher has her own reasons, targets, totals and jar for each class she teaches. Built as per class+subject (the teaching context), which is the same thing for a teacher with one subject in a class. See To confirm.
8. **Names.** "8 recommded names yes".
   → Class Stars / Sınıf Yıldızları; unit star / yıldız; target / basamak (Goals keep "goal" / "hedef"); sticker / çıkartma (not "stiker").
9. **A shared class jar with a class reward?** "A shared class jar with a class reward?  = yes".
   → The jar is on by default, beside the per-child paths, and is in the first version.
10. **Where is the empty space on her board, and how big should the box be?** Not answered.
   → Open. Proposal: the Star paths box at L (12 × 4, its own row) where she has room, otherwise M (4 × 3); the box's star button and the combined dock button both open the give screen.

### To confirm

Questions to put to the owner; the reading in brackets is what would be built if there is no answer.

1. **Question 7, "per class per teacher":** if one teacher teaches two subjects in the same class (for example English and Science in 3-A), is that one star system or two? (Two: per class+subject, the existing teaching context. One shared system per teacher and class would need a new scope that no module has today.)
2. **Question 5, "first achivement, adjustable":** does "first achivement" mean the first **target** (a show-and-tell turn only at the first target, switchable per target), the first time a child reaches **any** target, or that show and tell is tied to an **achievement** (for example the child's first class-stars achievement)? And who chooses the day? (The first target, switchable per target; the teacher plans the day.)
3. **Question 4, "sensible defaults":** which defaults: 25 / 50 / 100 per term, or small weekly targets such as 5 / 10 / 15? (25 / 50 / 100 per term.)
4. **Option B switch:** the brief proposed B as a per-class switch that starts off. Does the switch start on now that B was chosen? (It exists per class and starts off; the teacher turns it on in her setup page.)
5. **Question 2, "yes":** does the class setting "show each child's stars only on their own card" stay as an option? (Yes, as an option; the default shows every child's stars.)
6. **Option B with every child's stars on the board:** a total that went down between two lessons is visible on the board by name (the cost section 2 describes). Is that accepted with the choice of B? (Yes.)
7. **The combined give screen:** it replaces today's Achievements button and panel. When only one of the two modules is on for a class, the button and the screen show only that part (and the button keeps that module's name). The achievements panel's list "Achievements given this lesson" becomes one list for stars and achievements. (As described; see give.html.)
8. **Question 10, the box size:** L or M, and where. (L as its own row, the student grid lowered to 3 rows.)
9. **A star given from the teacher's phone:** the celebration is played only in the path of an action on the same screen (D-175), so a target reached from her phone celebrates on the phone, not on the smartboard. Should the board celebrate too? (Not in the first version; the board shows the new sticker at its next refresh.)


---

## 1. What it is

1. Every child in a class collects stars from their teacher, for reasons the teacher defines ("Helped a friend", 1 star).
2. The teacher gives stars in one or two taps from the classroom board or from a phone, to one child, several, or everyone.
3. The teacher sets targets (for example 25, 50, 100 stars). A child who reaches a target gets a sticker and a show-and-tell turn: they bring a toy and present it.
4. The class sees it in a box on the classroom board; each child sees their own stars, stickers and next target on their student page.
5. Reaching targets also earns achievements in the existing achievements system.

How it differs from what exists:

| Existing | What it is | The difference |
|---|---|---|
| **Super Speakers** | School-wide English points, +1 only, given by scorers with their own app, shown as a weekly top-3 podium on a hall screen. | Class points belong to one class+subject and its teacher, have teacher-defined reasons and values, have personal targets, and are not a competition between classes. |
| **Goals** | Learning goals a student sets or gets, with evidence and reflection. | A target here is a number of stars, not a learning goal. To keep the words apart the UI says "target" / "basamak" here and keeps "goal" / "hedef" for Goals (see open question 8). |
| **Achievements** | Effort-based awards (the user-facing word is "achievement" / "başarı", never "badge" / "rozet", D-144), automatic or given by hand, kept forever. | Class points are a running count with a ladder. They feed achievements (section 5) but are not achievements. |
| **Counters** | Reminder counts per lesson and per student (CNT), amber to red. | Counters count reminders. Class points count good things. They stay separate modules. |

**Working name.** Recommended: **Class Stars / Sınıf Yıldızları**, with "star" / "yıldız" as the unit.
The word "points" is already used by Super Speakers on the classroom card ("Super Speakers points this
week"), and two kinds of "points" on one card would confuse children. Alternatives: **Class Points /
Sınıf Puanları** (her own word, plainest) and **Star Path / Yıldız Yolu** (fits the path concepts in
section 10). The code key stays `classPoints` whatever the display name is.

**Decided:** Class Stars / Sınıf Yıldızları, "star" / "yıldız" (question 8).

---

## 2. The big conflict: taking points away on a classroom screen

The project's rule (AGENTS.md rule 7, CONVENTIONS "Classroom student card", D-121, D-154): classroom
screens show names and positive things only; no ranks, no comparisons. Super Speakers was decided as
"positive points only" by the owner (SSP-5). ClassDojo's public red "−1" with a sad sound is exactly
what the rule exists to prevent: a child is corrected in front of 20 classmates, on a wall-sized
screen, and often on a parent's phone in the evening.

"Ekleme çıkarma yapılsın" can mean two things. It can mean "I must be able to correct a mistake", or
it can mean "I want to take stars away for behaviour". The options below answer both readings. The
owner decides.

### Option A: positive only; "take back" is a correction, not an event

- Reasons have values of +1 to +5. There are no negative reasons.
- A mistaken give is taken back: Undo in the classroom for 10 minutes (the same window as achievements, `CLASSROOM_UNDO_MS`), later "Remove" in the PIN-gated teacher area with a reason. The stars leave the total quietly. No sound, no animation, no red, no line in the feed.
- **Children:** nobody is ever shown losing something. A child who misbehaves simply does not get stars; the teacher still has the reminder counters and her voice.
- **Teacher:** she cannot use the system as a penalty. If that is what she meant, this option does not give it to her, and she should be told so plainly.
- **Code and rules:** no rule changes. The ledger is append-only with voids, like `counter_events` and Super Speakers. Cheapest to build and test.

### Option B: quiet deductions, with a floor

- The teacher may also define "needs work" reasons with a negative value (−1 to −3).
- They are given only from the teacher's own device or the PIN-gated teacher area, never from the shared classroom display. Nothing is shown or played when one is given: no feed line, no sound, no animation, no reason text on any classroom screen. Only the child's total changes at the next refresh.
- Floors: a total never goes below 0, and never below the last target the child reached in the period. A reached target, its sticker, its show-and-tell turn and any achievement are never lost.
- The student page shows the total only; it never lists deductions (the page is opened at home, so parents see what the child sees).
- **Children:** less public than ClassDojo, but children watch their numbers. A total that drops between two lessons is noticed, by the child and by neighbours. The shame is smaller and later, not gone.
- **Teacher:** she gets a real "take away", but not a public one, and not from the board.
- **Code and rules:** needs a new sentence in CONVENTIONS and a decision that records the exception ("a total may go down; a deduction is never an event on a classroom screen"). Signed values, two floors, a second give path with different access, and tests that scan every classroom response for negative values and deduction reason texts. Roughly one extra small stage. Reports show deductions to the teacher only.

### Option C: full ClassDojo style

- Negative reasons are given from the board, shown in red with the child's name and the reason, with a sound.
- **Children:** public correction, by name, repeated every lesson. The children who struggle most with behaviour get the most public negatives. This is the documented cost of public behaviour charts.
- **Teacher:** exactly what she knows from ClassDojo.
- **Code and rules:** AGENTS rule 7, the classroom card allow-list (D-154), the fairness rule of D-121 and CNT-9 ("never highlight the triggering student") would all need to change or get an exception. Tests that enforce "positive only" on classroom responses would be loosened. Negative behaviour text about named children would be on a screen any visitor can see, and would need its own privacy thinking (reports, exports, AI tools).

### Recommendation

**Option A, built so that B can be added later** (the ledger stores a signed `value` from the first
day, so B is a feature switch and not a migration). Reasons: it gives the teacher everything she
listed except public penalties; it needs no rule change; and a system that only adds is the one
children like to look at. If the teacher says she needs to take stars away for behaviour, choose B as
a per-class switch that starts off. **Do not build C.** If C is truly wanted, it should be a separate
owner decision that rewrites rule 7 first, not a side effect of this feature.

**Decided: Option B** (question 1), with the limits above: deductions only in the teacher area or on
her own device, never an event on a classroom screen, floors at 0 and at the last reached target.
Whether the class switch starts on or off is to confirm.

Section 10 has concepts for A, and one concept that shows B on the board, so the choice is visible.

---

## 3. How it works, end to end

### 3.1 Scope: one class+subject

Class points are a per class+subject module (`CONTEXT_MODULE_CATALOG`), like counters and
achievements: a teacher's stars in her lessons with that class. Another teacher of the same class has
their own reasons, targets and totals. This fits every existing rule (`assertOwnsContext`, module
switches, reports per class+subject). A class-wide system shared by several teachers is possible
later but is not proposed (open question 7).

**Decided:** not shared between teachers, "per class per teacher" (question 7); whether one teacher's
two subjects in one class share a system is to confirm.

The module is opt-in: `defaultAvailability: 'enabled'`, `contextDefault: 'off'` (D-188). The teacher
turns it on in Class settings.

### 3.2 Reasons

A reason is what a star is for. Per class+subject:

| Field | Rule |
|---|---|
| Name | A class-facing label, `{ en?, tr? }`, edited with `LangFields` for the languages the class uses (D-099, D-172). One language is enough. Up to 40 characters. |
| Icon | One of the existing original icons (`BADGE_ICONS`, drawn by `BadgeArt`'s icon set). No uploads. |
| Value | 1 to 5 stars. Default 1. (Option B: also −1 to −3.) |
| Order | The order of the buttons; the teacher sorts them. |
| Archived | Soft archive; past events keep a snapshot of the name, icon and value. |

At most 12 active reasons, so the give sheet stays one screen of big buttons.

**Starter set** (seeded when the module is first turned on, in the class's languages, `inLocales` +
`onClassLanguageChanged`):

| English | Turkish | Icon | Value |
|---|---|---|---|
| Helped a friend | Arkadaşına yardım etti | `heartHands` | 1 |
| Listened carefully | Dikkatle dinledi | `headphones` | 1 |
| Tried hard | Çok çabaladı | `rocket` | 1 |
| Spoke English | İngilizce konuştu | `speech` | 1 |
| Worked well in a team | Takımda güzel çalıştı | `handshake` | 1 |
| Tidy desk | Düzenli masa | `brush` | 1 |
| Great idea | Harika fikir | `bulb` | 2 |
| Extra effort | Ekstra emek | `mountain` | 3 |

**Who edits:** the teacher who owns the class+subject, in the teacher area (PIN-gated in classroom
mode). No school-wide defaults by the administrator in the first version: the starter set is in the
code, and "copy my reasons and targets from another of my classes" covers a teacher with several
classes. The administrator's part is the module's availability switch only.

### 3.3 Giving stars

**From the classroom board** (the box or its dock button opens the give view):

1. Tap one or more children (big avatar tiles in name order, each at least `var(--cc-touch)`; "Everyone here" selects every child who is present today).
2. Tap a reason. Done: the stars are added at once (optimistic), the `pointAwarded` sound plays, and a line "Defne, Ege: +1 Helped a friend" appears in the view with **Undo**.

Two taps for one child (UX-8). A shortcut for the most common case: tapping a reason first and then
children gives that reason to each child tapped, until "Done".

**Decided:** the give view and the achievements dialog become **one screen** behind **one dock button**
("Stars and achievements" / "Yıldız ve başarı"); stars stay two taps for one child. Mockup:
`docs/design/class-points-mockups/give.html`. Option B deductions are not on this screen.

**From the phone:** the same board works on a phone today (375 px, the dock folds). The give view is
the same component in its narrow form. Outside a lesson (playground, after marking), the teacher area
has a "Give stars" page with the same sheet.

**Who can give:** the teacher who owns the class+subject. Nobody else. An administrator cannot.

**PIN or not.** Recommended: no PIN to give, like counter taps and achievements (D-122). A PIN on every
give would make the tool unusable in a lesson. The honest risk is a child tapping the smartboard.
What limits it:

- giving takes two deliberate taps inside a view that must be opened first;
- every give is announced by a sound and a named line, in front of the class;
- Undo is one tap for 10 minutes, and later the teacher area lists every event with who, when and why;
- a per-device rate limit (for example 60 gives in 10 minutes), as Super Speakers has;
- an optional class setting "Give stars only from my own devices", which hides the give controls on a browser marked as a classroom display (`lib/classroomDevice.ts`); the box then only shows.

Everything that is not a plain give (reasons, targets, removing old events, Option B deductions) is
`teacher` access and PIN-gated.

**Decided:** no PIN to give (question 6).

**Undo and removal.** Undo voids the whole give (all children of that tap) within 10 minutes. Later,
"Remove" in the teacher area voids single events with a reason, audited. Events are never deleted.

### 3.4 Targets

One ladder per class+subject, the same for every child. A ladder per child would be seen by the
children as unequal treatment; the teacher can instead give more stars for individual effort. (Per
child ladders are not proposed.)

A target has: a number of stars (threshold), a class-facing name (`{ en?, tr? }`, for example
"Bronze star" / "Bronz yıldız"), a sticker (an icon), and a switch "show and tell turn". Up to 8
targets. Optional: "after the last target, a new target every N stars", so the ladder never ends.

Default ladder: **25, 50, 100**, each with a sticker; show and tell on all three.
**Decided:** defaults the teacher can change on her setup page (question 4); show and tell is on by
default for the **first** target only and switchable per target (question 5; the exact reading is to
confirm).

**When a child reaches a target** (their total in the period crosses the threshold through a give):

1. The server records it once (one row per child, target and period; a replay or a later void never makes a second one).
2. **Celebration** on the classroom screen: the theme's `celebrate()` with "Defne reached 25 stars!", the sticker, the child's avatar, the `fanfare` sound. It follows the class's animation and sound switches and reduced motion. The class chooses when, like achievements: **now** (default), **at the end of the lesson** (an End Lesson step that gathers the lesson's reached targets), or **quietly** (no celebration in class; the child sees it on their page).
3. **Sticker:** it appears in the child's sticker album (student page) and on their classroom card.
4. **Show and tell turn:** the child goes into the teacher's show-and-tell queue with the state *waiting*. The teacher plans a date (*planned*), and ticks it off when the child presented (*done*), or marks *skipped* (the child did not want to; no penalty, nothing shown). The board box can show "Show and tell today: Defne" on the planned day. This is a tracked reward: the teacher never has to remember who is owed a turn.
5. **Achievements:** the rule engine is told (section 5).

A reached target is never taken back by the system. If stars are voided later and the total falls
below the threshold, the sticker and the turn stay (the D-132 rule: a child does not silently lose
something that was celebrated). The teacher can remove a reached target by hand in the teacher area
with a reason.

### 3.5 Periods and reset

The total that counts toward targets is the sum of the live events in the current **period**. A reset
is only a time window (as in Super Speakers): nothing is deleted, earlier periods stay in reports.

| Period | When it suits |
|---|---|
| Week | Small ladders (5, 10, 15). Fast rewards, many show-and-tell turns. |
| Month | A middle way. |
| **Term (default)** | The 25 / 50 / 100 ladder. |
| School year | A long journey map. |

What carries over a reset: stickers, show-and-tell turns (waiting ones stay in the queue),
achievements, the history. What starts again: the total and the ladder. "Never reset" is the school
year (totals end with the archived year anyway).

**Decided:** term by default, changeable by the teacher (question 4).

The period boundaries are computed in the class timezone at write time (`localDate` on each event),
with the week starting on Monday as elsewhere.

### 3.6 A shared class target (recommended as an addition)

Optional, on by default: every star any child earns also fills a class jar. The teacher sets the size
(for example 500 stars) and types the reward ("Film afternoon" / "Film öğleden sonrası"). When the
jar is full the class celebrates together, the teacher ticks the reward off when it happened, and a
new jar starts.

Why: it is cooperative. A child with few stars still helped fill the jar, and the most visible number
on the board becomes "ours". It is the best counterweight to comparing individual totals.

**Decided:** yes, on by default, in the first version, shown with the Star paths (question 9).

### 3.7 Absent, new and leaving children; archived years

- **Absent today:** "Everyone here" skips children marked absent (the attendance module's state for today, when attendance is on). An absent child can still be given stars by name. Nothing on any screen says a child got no stars because they were away.
- Being ill slows a child's path to a target but never removes anything. No achievement in section 5 depends on days, streaks or attendance (D-121).
- **New student:** starts at 0 in the running period. The teacher may give a "Welcome" star.
- **Leaving student** (enrolment ends): their events stay for reports; they disappear from the box and the give view from that date (`enrolmentActiveOn`). A waiting show-and-tell turn is closed as *left*.
- **Moved to another class:** stars do not travel; they belong to the class+subject.
- **Archived class or year:** read-only (`assertClassWritable`); every write is refused with `CLASS_ARCHIVED` / `YEAR_ARCHIVED`.
- **Erasure and export:** the per-student export and erasure read every table from the schema, so the new tables are covered; a test names them.

---

## 4. What the children see

### 4.1 In the classroom (recommended)

**For the class:** the class jar with its number and target in words ("312 of 500 stars"), the name
of the reward, and the last few gives ("Defne, Ege: +1 Helped a friend").

**Per child**, in the box when it is large and in the give view:

- avatar and name;
- progress toward the child's **own next target** as a ring or path with the numbers in words ("18 of 25");
- stickers of targets already reached in this period.

On the student cards of the grid: a small mark, a star and the child's total (the existing mark
mechanism, D-177; nothing at zero).

On the classroom student card (tap a name): the child's stars, next target and stickers, and the
recent achievements that are already there today. **This is also where "children want to see their
achievements in the classroom" is answered:** the card shows the four most recent achievements today
(D-154). Proposed: a "See all" inside the card that pages through all of the child's achievements in
this class+subject, and stickers beside them. Still own things only, opened on purpose.

**Deliberately not shown:**

- **No ranking.** No list from first to last, no places, no "top" label, no crown.
- **Order by name** (the student grid's order, `sortByName`), never by total. The order never changes when stars are given, so no child "moves down".
- **No zero that reads as failure.** A child with no stars yet shows an empty path with "Next: 25", not "0".
- **No negatives.** Under Option A there are none. Under Option B a total may change but no classroom response carries a deduction.
- **No "who has not reached a target"** list anywhere on a classroom screen.

**Honest limit.** Showing each child's number by name, even in name order, lets children compare.
That is a softer form of the thing the classroom card rule forbids ("ranks or comparisons with
classmates"). The recommendation therefore puts the weight on the jar and on "my next target", keeps
totals small, and offers a class setting **"Show each child's stars on the board: on / only on their
own card"**. With "only on their own card" the board shows the jar, the feed and the celebration, and
a child's number is seen only when their name is tapped.

**Decided:** every child's stars are on the board (question 2); no ranking of any kind (question 3).

**Alternatives the teacher may prefer, with their cost:**

| Alternative | Cost |
|---|---|
| A full leaderboard, first to last | The last places are public every lesson. Needs the rule changed (a rank on a classroom screen). Not recommended. |
| "Stars of the week": the top three, as on the Super Speakers podium | There is a precedent (SSP-1: top 3 only, zero never shown, ties share a place). It still names winners by comparison inside one small class, every week, where the same children tend to win. Needs a decision that allows a podium inside a classroom. Possible as an opt-in later; not in the first version. |
| Sort the tiles by stars | A hidden leaderboard. Same cost as the first row. |
| "Most improved this week" | Kinder, but still a comparison, and hard to explain to an eight-year-old. Not proposed. |

### 4.2 On the student's own page

A new tile and screen "My stars" / "Yıldızlarım":

- the total in this period and the path to the next target ("7 more stars to Silver star");
- the sticker album: stickers reached, with the date, and the next ones as outlines;
- the last ten gives with their reason and date ("+1 Helped a friend, Tuesday"), positive only;
- a show-and-tell note when a turn is waiting or planned ("Your show and tell is on Friday. Bring something you want to show.");
- one small celebration the first time the page is opened after a target was reached (then marked seen, like new achievements);
- the class jar ("Our class: 312 of 500").

Never: classmates' names or numbers, a rank, a deduction, who gave the star.

### 4.3 Parents

There is no parent access in Class Compass, and this feature adds none. No messages are sent to
anyone. A parent sees only what the child shows them on the child's own student page, which is one
more reason that page lists only positive things.

---

## 5. Achievements and stickers

### 5.1 Stickers

Three things a "sticker" could be:

| Option | Notes |
|---|---|
| **A collectable on the student page and the classroom card (recommended)** | The sticker of a reached target: the target's icon drawn in a sticker shape (a white edge and a slight tilt, existing original icon art, `--cc-badge-*` and `--cc-accent*` tokens). It is the "reached" record itself, so no extra table. The teacher chooses the icon per target. |
| An avatar item | Avatars already have unlocks tied to achievements (`AVATAR_UNLOCKS`). A sticker that unlocks an avatar part is attractive, but avatar keys can never be removed (D-169), so it must be designed with care. Later, as its own decision. |
| A printable | A sheet of earned stickers or a small certificate, with the print pattern of D-120. Nice for the show-and-tell day. Later, small. |

Recommendation: the collectable now; the printable certificate as a later extra; the avatar item only
after the first version has been used.

Words: "sticker" / "çıkartma" in the UI (children say "stiker"; the teacher chooses in open question 8).
**Decided:** "çıkartma" (question 8).

### 5.2 Achievements

Targets map to the existing system, not to a parallel one:

- A new achievement **category `classPoints`** (in `ACHIEVEMENT_CATEGORIES` and `ACHIEVEMENT_CATEGORY_VALUES`; a text column, so a type change and no table rebuild).
- New **rule events** in `RULE_EVENTS` with `EVENT_SOURCE` → `classPoints`: `class_points` (live positive stars the child earned in this class+subject, over all periods), `class_point_reasons` (different reasons), `class_targets` (targets reached), `show_and_tell` (turns done), `class_jar` (class jars filled while the child was in the class).
- The module calls `emitStudentActivity` after a give, a reached target, a done turn and a full jar; facts go in `achievements/facts.ts`, pure progress in `domain/achievements.ts`.
- Lifetime counts, so a reset never takes an achievement away; voids do not count toward later achievements and never revoke a given one (D-132).
- The rules are skipped while the class points module is off for the class+subject, and follow the class's existing "automatic achievements" switch and start choice (D-121).

Proposed defaults (ten):

| Key | English | Turkish | Rule | Tier |
|---|---|---|---|---|
| `classPoints.first` | First star | İlk yıldız | 1 star | bronze |
| `classPoints.p25` | Star collector | Yıldız toplayıcı | 25 stars | bronze |
| `classPoints.p100` | Star collector | Yıldız toplayıcı | 100 stars | silver |
| `classPoints.p250` | Star collector | Yıldız toplayıcı | 250 stars | gold |
| `classPoints.reasons3` | Many ways to shine | Her yönüyle parlayan | stars for 3 different reasons | bronze |
| `classPoints.reasons6` | Many ways to shine | Her yönüyle parlayan | stars for 6 different reasons | silver |
| `classPoints.target1` | First step up | İlk basamak | 1 target reached | bronze |
| `classPoints.target3` | Climber | Tırmanıcı | 3 targets reached | silver |
| `classPoints.showTell` | Show and tell star | Göster ve anlat yıldızı | 1 show and tell done | bronze |
| `classPoints.jar` | Team star | Takım yıldızı | the class filled a jar | silver |

Fairness (D-121): all count things done, none compares children, none needs attendance. "Team star"
goes to every child enrolled when the jar fills, including a child who was ill that week.

**Where achievements become visible in the classroom:** the Celebrate moment that exists (manual
awards), the End Lesson "Well done!" step (automatic ones, when the class chose it), the card mark
(this lesson's), and the classroom student card (recent ones; proposed "See all", section 4.1).
Nothing new shows achievements of several children side by side.

---

## 6. Module shape

### 6.1 Key and manifests

Module key `classPoints` (folders `src/server/modules/classPoints/`, `src/client/modules/classPoints/`,
contract `src/shared/contracts/classPoints.ts`, shared constants `src/shared/classPoints.ts`).
Scaffold with `npm run new:module -- classPoints`, then set `contextDefault: 'off'`.

**Server manifest**

| Hook | Use |
|---|---|
| `routes` | Section 6.3. Also registers `onClassLanguageChanged` for the seeded reasons and targets. |
| `commands` | `classPoints.give`, `classPoints.undo`, `classPoints.showTell`, `classPoints.jarDone`. |
| `lessonState` | Key `classPoints`: period, ladder, per child `{ studentId, total, nextTarget, stickers }` (only when "show on the board" is on; otherwise only for the give view's own tiles), the jar, the last 5 gives, today's show and tell. `stamp` from the newest event, reached row and settings change. Classroom-safe by construction. |
| `lessonSummary` | Stars given this lesson and targets reached, for "Lesson saved". |
| `endSteps` | `classPointsTargets`, order 60, `when` the class chose "celebrate at the end of the lesson" and the lesson has uncelebrated reached targets. |
| `startSteps` | None. |
| `classroomCard` | Key `classPoints`, order 15: `{ total (min 1), nextTarget: { threshold, name } \| null, stickers: [{ icon, name, reachedOn }] }`. A new member of `ClassroomCardItem`. Null when the child has nothing yet. |
| `studentPage` | Key `classPoints`, order 25. A new member of `StudentPageSection`. |
| `reports`, `timeline` | Section 6.6. |
| `activityListeners` | None of its own; it emits activity for the achievements module. |
| `notificationSink` | Not used, and no `notify()` in the first version: the only actor is the teacher herself, and the sink never notifies the actor. The show-and-tell queue's count is shown as a tile badge instead (`teacherPages[].useBadge`). |
| `config` | Section 6.7. |

**Client manifest**

| Hook | Use |
|---|---|
| `dashboardSlots` | Key `classPoints`, order 125, `dock: { Icon: IconStar, label: 'classPoints.title', useBadge }` (badge: show-and-tell turns planned for today, a count). `Component` renders the box (`presentation: 'box'`) and the give view (`'dock'`). |
| `studentCardAddons` | A mark `{ key: 'classPoints', Icon: IconStar, value: total, label: '12 stars' }`, only when "show on the board" is on and the total is above 0. |
| `endSteps` | `endStepUi` for `classPointsTargets`. |
| `teacherPages` | `class-stars` (`group: 'today'`: Give stars, the show-and-tell queue, history; `useBadge` = turns waiting) and `class-stars-setup` (`group: 'setup'`, `setupTab: 'lessons'`: reasons, targets, jar, period). Both `module: 'classPoints'`. |
| `settingsPanel` | The class settings under the module's switch. |
| `invalidations` | `classPoints.` → the lesson state and the module's queries. |

**Board catalogue** (`BOX_CATALOGUE`): `classPoints: spec('classPoints', { defaultPlace: 'dock', minW: 4 })`,
`minH` 1. It starts as a dock button, so turning the module on never takes height from the student
grid (the `e2e/board-40.spec.ts` floors stay). The teacher drags it onto the board in the layout
editor into the space she has. The box must work at every size from 4×1 up (section 10). If the
teacher wants it on the board by default, a `nextTo` placement can be added after the mockups show
which size she likes.

**Decided:** the dock does not get a second button. The `classPoints` dock contribution and the
achievements one become one combined dock button and screen (D-227, proposed); the Star paths box is
placed by the teacher (size still open, question 10).

### 6.2 Tables

Appended to `src/server/db/schema.ts`; ids are UUIDv7 text, times epoch ms, local dates text.

**`class_point_reasons`**: `id`, `context_id` → teaching_contexts, `default_key` (null for the
teacher's own), `label_json` `{en,tr}`, `icon`, `value` int (1..5; −3..−1 only with Option B),
`sort_order`, `archived_at`, `created_by`, `created_at`, `updated_at`.
Index `(context_id, archived_at)`. Create, edit, archive are audited.

**`class_point_events`** (the ledger, append-only): `id`, `batch_id` (the command's opId or the REST
`batchId`), `context_id`, `lesson_id` (null outside a lesson), `student_id`, `reason_id`, `value` int
(signed from day one), `label_snapshot_json`, `icon_snapshot`, `occurred_at`, `local_date`,
`given_by` → users, `voided_at`, `voided_by`, `void_op_id`, `void_reason` (null for a classroom undo;
a fixed short text field for a later removal, teacher-only).
Indexes: unique `(batch_id, student_id)`; `(context_id, local_date)`; `(context_id, student_id, local_date)`; `(lesson_id)`.
Rows are never updated except the four void columns, and never deleted. A give and a void are audited
(one audit row per batch, with counts, not one per child).

**`class_point_targets`**: `id`, `context_id`, `threshold` int, `label_json`, `sticker_icon`,
`show_and_tell` bool, `sort_order`, `archived_at`, timestamps. Index `(context_id, archived_at)`. Audited.

**`class_point_reached`**: `id`, `context_id`, `student_id`, `target_id`, `period_key` (for example
`W:2026-11-23`, `M:2026-11`, `T:<termId>`, `Y:<yearId>`), `reached_at`, `local_date`,
`threshold_snapshot`, `label_snapshot_json`, `sticker_snapshot`, `celebrated_at`, `seen_at` (student
page), `show_tell_state` (`none | waiting | planned | done | skipped | left`), `show_tell_date`,
`show_tell_done_at`, `show_tell_done_by`, `removed_at`, `removed_by`, `remove_reason`.
Unique `(student_id, target_id, period_key)` where `removed_at IS NULL`; index `(context_id, show_tell_state)`.
Removing one by hand and every show-and-tell change are audited.

**`class_point_jars`**: `id`, `context_id`, `seq`, `size`, `reward_json` `{en,tr}`, `started_at`,
`filled_at`, `done_at`, `done_by`. One open jar per class+subject (partial unique index on
`context_id` where `filled_at IS NULL`).

There are no stored totals. A total is the sum of live events in the period, read with the
`(context_id, local_date)` index: a class of 40 with 100 events each per term is 4 000 small rows.

Single-owner rule: only `server/modules/classPoints/` reads or writes these tables
(`tests/server/single-owner-tables.test.ts`); achievements read through a helper the module exports
(`classPointFacts`), as they do for Super Speakers points.

### 6.3 Endpoints and commands

**Outbox commands** (classroom, no PIN, idempotent by opId; lesson-scoped with `contextId` +
`lessonId`, resolved with `lessonForCommand`; each re-checks ownership, module on, class writable,
students enrolled today):

| Command | Payload | Does |
|---|---|---|
| `classPoints.give` | `{ contextId, lessonId, studentIds[1..40], reasonId, givenAt }` | One event per child with `batch_id = meta.opId`; fills the jar; finds crossed targets and inserts `class_point_reached` rows; emits activity. Returns `{ reached: [{ studentId, targetId }], jarFilled }`. Refuses an archived or negative reason (`REASON_NOT_AVAILABLE`), and rate-limits (`TOO_MANY_GIVES`). |
| `classPoints.undo` | `{ contextId, lessonId, batchId }` | Voids the batch within 10 minutes, same teacher (`UNDO_PASSED` afterwards). A reached target that this give alone created in the last 10 minutes and that was not yet celebrated is removed with it; a celebrated one stays. Repeat → `alreadyUndone`. |
| `classPoints.showTell` | `{ contextId, lessonId, reachedId, state: 'done' \| 'planned' }` | Ticks a turn off in class (a positive moment; the name is already public). |
| `classPoints.jarDone` | `{ contextId, lessonId, jarId }` | The class reward happened. |

The client applies the give optimistically with `patchLesson`, enqueues in the same step
(`sendLessonCommand`), computes a crossed target locally from the polled ladder so the celebration
works offline, registers descriptions and invalidations, and shows `OutboxSaveBadge` and
`OutboxAttentionTray`. The sound plays in the action's path, never from polled state, a replay or an
undo (D-175).

**Endpoints**

| Endpoint | Access | Notes |
|---|---|---|
| `GET /api/classroom/contexts/:contextId/class-points` | `classroom` | What the give view needs beyond the lesson state (active reasons, the lesson's batches for Undo). ETag. Offline key in `isOfflineKey`. |
| `GET/POST/PATCH /api/teacher/contexts/:contextId/class-points/reasons…` | `teacher` | List, create, edit, archive, reorder, "copy from another of my classes". |
| `GET/POST/PATCH …/class-points/targets…` | `teacher` | The ladder. A changed threshold applies to totals from now on; reached rows keep their snapshot. |
| `GET/PATCH …/class-points/jar` | `teacher` | Size and reward. |
| `POST …/class-points/give` | `teacher` | Outside a lesson; optional client `batchId`, replayed when repeated (D-074). |
| `GET …/class-points/events` | `teacher` | History with filters (student, reason, date), paged. |
| `POST …/class-points/events/:id/void` | `teacher` | With a reason; audited. |
| `GET …/class-points/show-and-tell` | `teacher` | The queue. |
| `PATCH …/class-points/reached/:id` | `teacher` | Plan a date, done, skipped, remove with a reason. |
| `POST /api/student/class-points/seen` | `student` | Marks reached targets as seen (the celebration plays once); own rows only. |
| (Option B only) `POST …/class-points/adjust` | `teacher` | A negative reason; never a command, never from the classroom. |

Settings travel through the existing module config endpoint. All output schemas are allow-lists.
Classroom outputs never contain `value < 0`, a void reason, `given_by`, or anything about a child who
is not in the class today. The new classroom GET is automatically in the Secret Student and grouping
leak scans.

### 6.4 Privacy marks and AI tools

- Output strings are marked with `pii()`: student names `studentName`, reason and target names `label` (`LocalizedText`), the void / remove reason `teacherText`.
- **Offered to AI tools: reading only, through reports.** The report section appears in the existing report tool (`reports:read`), with pseudonyms while student data is off. One read tool may be added later: `list_class_points` on the events endpoint.
- **Not offered:** giving, undoing, adjusting, reasons and targets editing. A star should come from the teacher who saw what happened, not from a model. (The assistant chat's confirmation cards would allow a write tool later; that is a separate decision.)
- Reason names are typed by the teacher and shown to the class. They are labels, not student text, so no text check; the editor says "The class sees this".

### 6.5 Student page

Section `classPoints` in `StudentPageSection`; screen `stars` in `SCREENS` and `TILE_ORDER` (after
`achievements`); renderer in `student/sections.tsx`. It reuses the icon art the achievements screen
already loads and adds no library. Strings the page shows (about 15 keys) go in the main dictionary
(`en.ts` / `tr.ts`, plus `module.classPoints`); everything else in the staff dictionary
(`areas/staff/`), and the two teacher pages can use an area file (`areas/classPoints.ts`) so no other
screen downloads them. Report the size with `npm run size:student`; the expected cost is 2 to 3 kB
gzip and must fit the present budget without raising it.

### 6.6 Reports

Points fit reports as plain counts with honest context, not as a score.

Section `classPoints`, order 85, with `meta` listing these tables:

| Table | Rows | Cells |
|---|---|---|
| `students` | One per student, **in name order** | Stars in the period `n(v)`; targets reached `n(v, d)` with the ladder's length as denominator; show and tell done `n(v, d)` of turns earned. A student who was not in the class in the period: `NA`. |
| `reasons` | One per reason (snapshot names, `text(then, now)`) | Times given `n(v)`; children who got it `n(v, d)` of the children in the class. |
| `weeks` | One per week | Stars given `n(v)`; lessons with stars `n(v, d)` of lessons held; a week of closures is `CLOSED`. |
| `showTell` | One per turn | Student, target, state, date. |
| (Option B) `adjustments` | Teacher only, hidden from `viewer: 'admin'` | Count per student. |

Rules:

- **No overall score and no rank column.** The table is never sorted by stars by default, and there is no class average per child.
- **"Not recorded" is never 0.** For a period before the module was turned on, or a class+subject that never used it, the cells are `NR`. Once the module is in use, "no stars in this week" is a true 0 and is shown as 0.
- Stars are not a measure of a child's learning, and the section's note says so ("Stars show what the teacher noticed, not a grade.").
- Timeline: target reached, show and tell done. Not every star (too many).
- The student statistics drawer (teacher area) gets the section through the built-in Student overview view.

### 6.7 Settings

Per class+subject, in the manifest `config` (Zod, defaults):

| Key | Values | Default |
|---|---|---|
| `period` | `week`, `month`, `term`, `year` | `term` |
| `showOnBoard` | `all` (each child's stars on the board), `ownCard` (only on the child's own card) | `all` (**decided**: every child's stars shown; whether `ownCard` stays offered is to confirm) |
| `announce` | `now`, `endOfLesson`, `quiet` | `now` |
| `jarEnabled` | boolean | true |
| `repeatEvery` | null or 5..500 (targets after the last one) | null |
| `giveFromDisplay` | boolean (false hides the give controls on a browser marked as a classroom display) | true |
| (Option B, **decided**) `deductions` | boolean | false (to confirm) |

Per school: the module's availability (Admin → Modules), nothing else. Per device: nothing new.

### 6.8 Demo seed and demo history

- `seed/demo.ts`: nothing (the module is opt-in).
- `seed/history/classPoints.ts`, listed in `HISTORY_GENERATORS`: `setupSchool` turns the module on for 3-A English and 3-B English through the teacher's own endpoint (as Lesson goals does); `setup` sets a smaller ladder for 3-B (10 / 20 / 40, weekly) so both shapes are in the demo; `duringLesson` gives stars to present children through `h.command(… 'classPoints.give' …)` (single, small groups, sometimes everyone; one give undone); `afterLesson` plans and ticks show-and-tell turns; `endOfWeek` sometimes removes one event with a reason. Deterministic (`h.rand`), the past only, cheap.
- `tests/server/seed-history.test.ts` covers it automatically.

### 6.9 Theme hooks and accessibility

- **Tokens:** no new colour tokens. Surfaces `--cc-surface`, `--cc-surface-2`, `--cc-border`; text `--cc-text`, `--cc-text-muted`; stars and progress `--cc-accent`, `--cc-accent-strong`, `--cc-accent-soft`, `--cc-segment-on`, `--cc-segment-off` (the jar and the paths, as the counter bar); a reached target `--cc-success`, `--cc-success-soft`; stickers `--cc-badge-bronze`, `--cc-badge-silver`, `--cc-badge-gold`, `--cc-badge-plain`, `--cc-badge-ink`, `--cc-badge-shine`; focus `--cc-focus`. Sizes from the board's `--cc-card-*` variables and `cqi`; radii and shadows from the theme's shape variables. `--cc-danger*` is not used on any classroom screen of this module.
- **Frames:** the box places `<FrameOverlay surface=… />` like every board box.
- **Sound:** existing events only: `pointAwarded` (a give), `undo`, `fanfare` (a target), `clapping` (a full jar). No new sound event.
- **Celebration:** `celebrate(message)` after the teacher's action, never on load or a poll; `<Mascot pose="cheer">` in the box's empty state.
- **Never colour alone:** every progress shows numbers in words ("18 of 25"); a reached target has a tick and its name; a sticker has its name as accessible text; a give line says "+1" and the reason in words.
- **Reduced motion:** a star flying into the jar is opacity-only under `cc-motion-reduced` and absent with class animations off. Nothing loops, nothing flashes.
- **Touch:** child tiles and reason buttons are at least `var(--cc-touch)`; choice grids use `repeat(auto-fit, minmax(min(100%, <n>rem), 1fr))` and go into `e2e/button-groups.spec.ts`.
- **Keyboard and screen readers:** the give view is a multi-select list plus buttons; a `role="status"` line names who was chosen and what was given.
- **Words on the board are never cut inside a word** (D-200): long reason names wrap; the box measures with `useLayoutFit` and falls back to a calmer form (icons with accessible names) when there is no room.
- **Class language:** everything class-facing follows the class's language (`useClassLocale`), not the teacher's.

### 6.10 Tests (requirement IDs)

New requirement IDs are proposed as **CPT-1 … CPT-12** in `docs/REQUIREMENTS.md` (reasons per class;
give to one / several / all; idempotent give; undo keeps accountability; targets once per period;
show-and-tell queue; periods; jar; classroom shows no negatives and no rank; student page own data
only; achievements; reports). Existing ones touched: UX-7, UX-8, UX-9, UX-10, UX-11, PIN-8, CRD-1,
STU-5, RPT-5, DAT-1, CFG-2.

Tests: idempotent replay and offline queue; undo window; target crossing exactly once (also on
replay, after a void, across a period boundary: property test around Monday 00:00 Europe/Istanbul);
floors (Option B); a marker scan of every classroom response for negative values, void reasons and
other children; module off serves nothing; archived class refuses writes; classroom card and student
page allow-lists; `mcp-privacy`; report `meta` against produced tables; e2e: give from the board at
1920×1080 and on the `@mobile` project, the celebration, the box at each size in
`e2e/classroom-layout.spec.ts`, the fit floors of `e2e/board-40.spec.ts` with the mark on.

---

## 7. Rules and decisions this would add or change

Draft DECISIONS entries (numbers are proposals):

- **D-218 — Class points are a per class+subject, opt-in module; the unit is a star.** Not school-wide, not shared between teachers; display name and unit chosen by the owner.
- **D-219 — Stars are positive; a mistake is taken back, never shown.** Option A of this brief (or, if the owner chooses B: "Deductions exist only behind a class switch, are given only in the teacher area, never appear as an event on a classroom screen, and never take a total below zero or below a reached target").
- **D-220 — A ledger with voids, no stored totals; one give is one batch.** `class_point_events`, opId = batch id, undo for 10 minutes in class, later removal with a reason in the teacher area.
- **D-221 — One ladder of targets per class+subject; a reached target is recorded once per period and is never taken back automatically.** Sticker, show-and-tell turn, celebration mode.
- **D-222 — Show and tell is a tracked reward with a queue.** States, who ticks, what the class sees.
- **D-223 — The classroom shows stars in name order, never ranked; the class jar is the main number.** The `showOnBoard` setting; no podium in a classroom.
- **D-224 — Class point achievements: category `classPoints`, five rule events, lifetime counts.** Ten defaults; nothing depends on attendance.
- **D-225 — Class points in reports are counts without a score, and are read-only for AI tools.**
- **D-226 — Giving stars needs no PIN; a class can hide the give controls on classroom displays.**
- **D-227 — One classroom screen gives stars and achievements.** One dock button replaces the Achievements button and the Class stars button; the screen keeps the achievement dialog's choices (children, groups, "Celebrate on the display", "Give to N") and adds the star reasons; when one of the two modules is off, only the other part shows.

**Decided (2026-11-25):** D-219 takes the Option B wording; D-223 with `showOnBoard: 'all'` and no podium;
D-226 as written; D-227 is new.

CONVENTIONS sentences to add:

- **"Classroom student card":** add `classPoints` to the allow-list sentence ("the student's own stars, next target and stickers; never a rank or another student").
- **A new bullet "Class points":** only `server/modules/classPoints/` reads or writes its tables; totals are always derived from live events; classroom responses never carry a negative value, a void reason or the giver; lists of children are in name order, never by total; a reached target is never removed by a void; the celebration and the `pointAwarded` sound are played only in the path of the teacher's action.
- **"Classroom board":** the `classPoints` box is in the catalogue as a dock button by default; it must render at 4×1.
- **"Words":** "target" / "basamak" for class points, "goal" / "hedef" for Goals; "sticker" / "çıkartma"; still never "badge" / "rozet" in the UI.
- **AGENTS.md rule 7** needs no change under Option A. Under B it gets: "a child's star total may go down, but a deduction is never shown as an event". Under C it would have to be rewritten.
- **EXTENDING:** orders in use (classroom card 15, report 85, dashboard slot 125, end step 60); the example "points" generator in "Demo history generators" should be renamed so it is not mistaken for this module.

---

## 8. Stages

| Stage | Delivers | Size | The teacher can try it |
|---|---|---|---|
| **S37a Stars, reasons and the combined give screen** | Module, catalogue line, tables `reasons` and `events`, starter reasons, reasons editor, `give` / `undo` commands, **the combined "Stars and achievements" screen and its one dock button** (replacing the Achievements dock button; D-227), **the Star paths box** (concept 1) at its sizes, the card mark, lesson state, the "Give stars" page for the phone, history with removal, demo history, tests. | L | Yes (first version) |
| **S37b Targets, stickers, show and tell** | Tables `targets` and `reached`, the ladder editor (default 25 / 50 / 100 per term, changeable), the crossing logic, the celebration and its three modes (End Lesson step), the show-and-tell queue (on by default for the first target only) and its tile badge, periods, the classroom card item. | L | Yes (first version) |
| **S37c Class jar, then the student page** | **First version:** the jar (table, its line in the Star paths box and in the give screen, the reward tick, the jar-full celebration). **After:** the "My stars" screen with the sticker album and the seen celebration, `showOnBoard`'s `ownCard` option. | M | Yes (the jar in the first version) |
| **S37d Achievements and reports** | Category, rule events, facts, ten defaults, "See all" on the classroom card, the report section and timeline, report views, guides in English and Turkish. | M | Yes |
| **S37e Option B deductions (decided)** | The `deductions` switch, negative reasons, the `adjust` endpoint (teacher area only, never on the combined classroom screen), floors, the leak scans, the rule texts. | S–M | Yes (first version) |

Order (decided 2026-11-25): a → b → e and the jar of c → the rest of c and d in parallel. One
migration per stage, generated after the final rebase.

**Hot files** (one stage at a time): `src/shared/modules.ts`, `src/shared/classroomLayout.ts`,
`src/server/db/schema.ts` and `drizzle/`, `src/server/modules/index.ts`, `src/client/modules/index.ts`,
`src/shared/contracts/classroomCard.ts` and `board/StudentCardDialog.tsx` (b, d),
`src/shared/contracts/goals.ts` (`StudentPageSection`), `src/client/student/sections.tsx` and
`nav.ts` (c), `src/shared/achievements.ts`, `achievements/facts.ts`, `domain/achievements.ts` (d),
`src/shared/reportViews.ts` (d), `en.ts` / `tr.ts`, `areas/staff/en.ts` / `tr.ts`,
`src/client/styles/app.css`, `src/client/lib/offlineClassroom.ts` (`isOfflineKey`),
`e2e/classroom-layout.spec.ts`, `e2e/board-40.spec.ts`, `e2e/button-groups.spec.ts`,
`src/client/modules/achievements/AchievementsPanel.tsx` and `manifest.tsx` and the achievements e2e
specs (a: the combined screen), `docs/DECISIONS.md`, `docs/CONVENTIONS.md`, `docs/ROADMAP.md`.

**The first version (decided 2026-11-25): S37a + S37b + S37e + the jar of S37c.** Her own reasons with
values; one dock button and one screen to give stars or achievements to one, several or everyone, from
the board and the phone, with no PIN; Undo; the Star paths box with every child's path in name order
and the class jar; each child's stars on their card; the default ladder 25 / 50 / 100 per term that she
can change, with the celebration and the show-and-tell queue (first target by default); Option B
deductions in the teacher area only. Not yet: the student page, class-star achievements, reports. It
can be on the test server for her to try before the rest is built.

(Before the decisions the smallest first version was S37a plus one target of S37b, with no jar and
no deductions.)

Real-device checks (a touch panel, her phone, a projector at 1280×720) stay open ROADMAP boxes until
a person has done them.

---

## 9. Open questions

Each has a recommended answer. Turkish follows each question so the teacher can read it herself.

**Answered 2026-11-25:** see "Decisions" at the top (question 10 is still open, and some answers are
listed there under "To confirm").

1. **Taking stars away: correction only, or also for behaviour?** Recommended: correction only (Option A). Taking away for behaviour can be added later as a quiet, non-public switch (Option B).
   **Yıldız geri almak: sadece yanlışı düzeltmek için mi, yoksa davranış için de mi?** Önerimiz: sadece düzeltme (A seçeneği). Davranış için puan düşürme, sonradan sessiz ve sınıfa gösterilmeyen bir ayar olarak eklenebilir (B seçeneği).

2. **Should the board show every child's stars, or only the class jar and each child's own card?** Recommended: every child's stars in name order with their own next target, and a class setting to hide the numbers.
   **Tahtada her çocuğun yıldızı mı görünsün, yoksa sadece sınıf kavanozu ve her çocuğun kendi kartı mı?** Önerimiz: her çocuğun yıldızı alfabetik sırayla ve kendi sıradaki basamağıyla görünsün; sayıları gizlemek için bir sınıf ayarı da olsun.

3. **Is a ranking wanted (first to last, or a top three)?** Recommended: no. A top three could be an opt-in later, with a separate decision.
   **Sıralama istiyor musunuz (birinciden sonuncuya ya da ilk üç)?** Önerimiz: hayır. İlk üç, ayrı bir kararla sonradan isteğe bağlı eklenebilir.

4. **Which targets and which period?** Recommended: 25 / 50 / 100 stars per term. (Or small weekly targets such as 5 / 10 / 15?)
   **Hangi basamaklar, hangi dönem?** Önerimiz: dönem başına 25 / 50 / 100 yıldız. (Ya da haftalık küçük basamaklar, örneğin 5 / 10 / 15?)

5. **Show and tell: at every target or only some? Who chooses the day?** Recommended: the teacher switches it per target and chooses the day; the child can say "not this time" without losing anything.
   **Göster ve anlat: her basamakta mı, yoksa bazılarında mı? Günü kim seçer?** Önerimiz: öğretmen her basamak için açıp kapatır ve günü seçer; çocuk "bu sefer istemiyorum" diyebilir, hiçbir şey kaybetmez.

6. **Should giving stars on the smartboard need the PIN?** Recommended: no; two taps, a sound, a named line and Undo, plus an optional setting that hides giving on the smartboard so only the teacher's phone can give.
   **Akıllı tahtadan yıldız vermek için PIN gerekli olsun mu?** Önerimiz: hayır; iki dokunuş, bir ses, isimli bir satır ve Geri al yeterli. İsteyen öğretmen tahtadan vermeyi kapatıp sadece kendi telefonundan verebilir.

7. **One star system per class+subject (the teacher's own lessons), or one per class shared by all its teachers?** Recommended: per class+subject.
   **Yıldızlar sınıf ve derse göre mi olsun (öğretmenin kendi dersleri), yoksa sınıfın bütün öğretmenleri için ortak mı?** Önerimiz: sınıf ve derse göre.

8. **Names.** Recommended: "Class Stars / Sınıf Yıldızları", unit "star / yıldız", "target / basamak" (so it is not mixed up with Goals / Hedefler), "sticker / çıkartma".
   **İsimler.** Önerimiz: "Sınıf Yıldızları", birim "yıldız", hedef yerine "basamak" (Hedefler modülüyle karışmasın diye), "çıkartma" (ya da "stiker").

9. **A shared class jar with a class reward?** Recommended: yes, on by default.
   **Ortak bir sınıf kavanozu ve sınıf ödülü olsun mu?** Önerimiz: evet, başlangıçta açık.

10. **Where is the empty space on her board, and how big should the box be?** Recommended: decide with the mockups; the box starts as a dock button and she places it.
    **Tahtadaki boş alan nerede, kutu ne kadar büyük olsun?** Önerimiz: taslaklara bakarak karar verelim; kutu önce alttaki düğmelerde durur, öğretmen istediği yere koyar.

---

## 10. For the mockup designer

Make static HTML mockups of the concepts below. Nothing here is decided: the mockups are how the
owner and the teacher choose.

**Decided 2026-11-25:** concept 1, Star paths (10.2), with the class jar of 3.6; see "Decisions" at the
top.

### 10.1 Ground rules

- **Board model** (`src/shared/classroomLayout.ts`): a 12 × 12 grid of rows of boxes; at most 4 boxes in a row and 6 rows; the last row is the dock (height 1). The default board is: routine (8 wide) and timer (4), 3 high; today's focus (4) and the counter bar (8), 1 high; the student grid (12 wide), 7 high; the dock, 1 high. Draw at 1920 × 1080, and check 1280 × 720 and 375 × 812.
- **Three sizes to draw for each concept** (the proposed box is at least 4 columns wide and 1 row high):
  - **S, strip:** 4 columns × 1 row (about 600 × 80 px at 1920 × 1080; 400 × 50 at 1280 × 720). In the second row beside today's focus, with the counter bar narrowed to 4. Content must stay inside the row's height: one line, icon buttons, no wrapping onto a second line.
  - **M, panel:** 4 columns × 3 rows (about 600 × 250 px). In the first row, the routine narrowed to 4 or 5.
  - **L, wide:** 12 columns × 4 rows (about 1870 × 330 px) as its own row, the student grid lowered to 3 rows; **and** the same content in the dock view (a full-screen dialog opened by the dock button, with the give controls). On a phone the dock view is the only form.
- Every box starts with a `PanelHead` (title and at most one icon button) and is an inline-size container: sizes in `cqi` and the `--cc-card-*` variables, no viewport units.
- **Tokens only** (`var(--cc-*)`), no hex: `--cc-bg`, `--cc-surface`, `--cc-surface-2`, `--cc-border`, `--cc-border-strong`, `--cc-text`, `--cc-text-muted`, `--cc-accent`, `--cc-accent-strong`, `--cc-accent-soft`, `--cc-accent-text`, `--cc-on-strong`, `--cc-focus`, `--cc-success`, `--cc-success-soft`, `--cc-segment-on`, `--cc-segment-off`, `--cc-badge-bronze`, `--cc-badge-silver`, `--cc-badge-gold`, `--cc-badge-plain`, `--cc-badge-ink`, `--cc-badge-shine`, `--cc-icon-accent`, `--cc-art-sky`, `--cc-art-ground`, `--cc-art-light`, `--cc-mascot-*`, `--cc-overlay`, `--cc-shadow-color`, and `--cc-touch` for target sizes. Use `--cc-warning*` and `--cc-danger*` only in the one concept that shows deductions, and only where stated. Show each concept in two built-in themes (`explorer` and `animals`) to prove nothing depends on a theme.
- Status never by colour alone: numbers in words, ticks, names. Draw a reduced-motion frame for every animated moment.
- English and Turkish versions of at least the chosen concept; Turkish strings are longer.
- **Fictional class: 3-A English, teacher Sevgi Toprak, 19 children.** Use these twelve in the mockups (name order, stars this term, next target):

  | Child | Stars | Next target |
  |---|---|---|
  | Asya Bulut | 31 | 50 |
  | Çınar Öztürk | 12 | 25 |
  | Defne Yıldız | 24 | 25 |
  | Ege Kaya | 52 | 100 |
  | Elif Su Demir | 18 | 25 |
  | İpek Aydın | 47 | 50 |
  | Kerem Doğan | 9 | 25 |
  | Nehir Arslan | 26 | 50 |
  | Ömer Faruk Şahin | 0 (new this week) | 25 |
  | Poyraz Çelik | 38 | 50 |
  | Yağmur Koç | 22 | 25 |
  | Zeynep İrem Güneş | 61 | 100 |

  Targets: Bronze star 25, Silver star 50, Gold star 100 (Bronz / Gümüş / Altın yıldız). Class jar: 312 of 500, reward "Film afternoon" / "Film öğleden sonrası". Last gives: "Defne Yıldız, Ege Kaya: +1 Helped a friend"; "Everyone here: +1 Tidy desk"; "Kerem Doğan: +2 Great idea". The moment to animate: Defne gets +1 and reaches 25.

### 10.2 Concept 1: "Star paths" (Yıldız yolları). Per-child progress, no ranking. Positive only.

*Idea.* Each child has a short path to their **own next target**. The board shows how close each
child is to their next sticker, not who has the most. A child at 24 of 25 and a child at 47 of 50
look alike: nearly there.

- **S:** the star icon, "Class stars", then up to three names that are within 3 stars of their next target as chips ("Defne 24 of 25", "İpek 47 of 50", "+1 more"), then an icon button "Give stars". When nobody is close: "312 stars this term".
- **M:** a list in name order; each row is avatar, first name, a segmented path of 5 segments toward the next target with "24 of 25" in words, and the stickers already reached as small icons. Rows scroll inside the box; the row that just changed is brought into view.
- **L:** all children as tiles in a grid in name order: avatar, name, the path, "24 of 25 · Bronze star next", stickers. Ömer Faruk shows an empty path and "Next: Bronze star", never "0". In the dock view the tiles are selectable and the reason buttons stand below them.
- **Give:** dock view. Tap tiles (a tick and a border in `--cc-accent-strong`, plus the word "Chosen"), tap a reason. "Everyone here" at the start of the grid. A status line and Undo inside the view.
- **Target reached:** Defne's path fills, the tile lifts, the sticker lands on it, then the full-screen celebration: avatar, "Defne reached 25 stars!", the Bronze star sticker, "Show and tell turn!" and the mascot in its `celebrate` pose.
- **Deductions:** Option A. Undo makes a segment empty again without any effect. Under Option B a path could lose a segment between lessons but never below the last sticker; nothing marks it.

### 10.3 Concept 2: "Class jar" (Sınıf kavanozu). A shared target with individual stars inside. Positive only.

*Idea.* One big jar that the whole class fills. Every star any child earns drops into it. Individual
stars exist but are secondary: they are on each child's own card.

- **S:** a horizontal jar bar (segments, `--cc-segment-on` / `--cc-segment-off`), "312 of 500", the reward name when there is room, an icon button "Give stars".
- **M:** the jar as a drawing filled to 62 %, "312 of 500 stars", "Reward: Film afternoon", and the last two gives as lines.
- **L:** the jar on one side with the reward and "188 to go"; beside it the feed of the last five gives; beside that "Show and tell today: Asya Bulut" and "Close to a sticker: Defne, İpek, Yağmur" (names only, no numbers). No per-child totals in the box at all (`showOnBoard: ownCard`). The dock view has the child tiles for giving, with each child's own stars shown small.
- **Give:** as concept 1; after the give, one star per child flies from the tile into the jar (opacity-only fade when motion is reduced).
- **Target reached:** an individual target is celebrated as in concept 1. When the jar fills: the lid pops, "We did it! Film afternoon!", every avatar of the class in a row in name order, `clapping`.
- **Deductions:** Option A only. The jar never goes down except by an Undo, which simply removes the star. This concept cannot show Option B or C and is the calmest of the five.

### 10.4 Concept 3: "Sticker album wall" (Çıkartma albümü). Collecting, not counting. Positive only.

*Idea.* The wall shows what was collected, not numbers: every child has an album row with slots for
the term's stickers. Stars are the way to a sticker; the board celebrates stickers.

- **S:** "Stickers this term: 14", the three newest stickers with first names ("Ege: Silver star"), an icon button "Give stars".
- **M:** the newest five stickers as large icons with name and date, and "Next show and tell: Asya Bulut, Friday".
- **L:** a wall: one row per child in name order, with three slots (Bronze, Silver, Gold). A reached slot holds the sticker (icon, tier colour from `--cc-badge-*`, and its name as text below); the next slot is an outline with a thin progress arc and "24 of 25"; later slots are plain outlines. Ege has two stickers, Zeynep İrem two, Defne an outline at 24 of 25.
- **Give:** as concept 1 in the dock view; a quick way from the wall is tapping a child's next outline, which opens the reason buttons for that child (one child, two taps).
- **Target reached:** the sticker is "peeled" from a sheet and pressed into Defne's slot (a short scale and settle; a plain fade when motion is reduced), then the shared celebration.
- **Deductions:** Option A. Stickers are never removed by the system, so nothing on the wall ever goes backwards; under Option B only the thin arc of the next slot could shrink.

### 10.5 Concept 4: "Star tiles" (Yıldız kutucukları). What the teacher literally asked for.

*Idea.* The grid she knows from ClassDojo: every child a tile with an avatar and a big number, tap a
tile, choose a reason, the number changes. Drawn in two variants so the difference is visible.

- **S:** "Class stars", the class total "312", the last give as one line, an icon button "Give stars".
- **M:** a compact grid of avatars with a number badge each, in name order; scrolls inside the box.
- **L:** tiles with a large avatar, the name, and the total as a big number with a star ("24 stars"); a thin line under it toward the next target. A "Whole class" tile first, as in ClassDojo. In name order: draw it this way, and add one small frame showing the same tiles sorted by total, labelled "not recommended", so the cost is seen.
- **Give:** tap a tile; a sheet opens with two tabs. **Variant 4a (Option A):** one list, the positive reasons, and "Take back the last star" as a plain text button. **Variant 4b (Option C, for comparison only):** tabs "Positive" and "Needs work"; a "Needs work" reason shows "−1" on the tile in `--cc-danger` with a minus icon and the reason in words, and a red line in the feed. Mark this frame clearly: "Needs the classroom rule changed. Not recommended." Also draw **4c (Option B):** the "Needs work" tab exists only on the teacher's phone sheet; on the board Kerem's number changes from 9 to 8 with no animation, no line and no colour.
- **Target reached:** the number rolls to 25, a "Bronze star" ribbon appears on the tile, then the shared celebration.
- **Deductions:** this is the concept that shows all three options side by side. Under B draw the floor: Nehir at 26 with Bronze reached cannot go below 25.

### 10.6 Concept 5: "Mountain climb" (Dağ tırmanışı). A journey map. Positive only.

*Idea.* One landscape for the whole class: a mountain path with camps at 25, 50 and 100. Each child's
avatar stands at the camp they have reached (not at their exact number), so children are in three or
four friendly groups, not in a line from first to last.

- **S:** a flat path with three camp flags and a count at each in words ("Base: 7 · Bronze camp: 8 · Silver camp: 4"), an icon button "Give stars". If that does not fit one line: camp icons with numbers, names as accessible text.
- **M:** the mountain drawn small with the three camps; at each camp up to four avatars and "+4"; under it the jar as a thin bar.
- **L:** the full scene with theme art colours (`--cc-art-sky`, `--cc-art-ground`, `--cc-art-light`): base, Bronze camp, Silver camp, Gold summit. Avatars stand at their camp in name order, with first names. A child close to the next camp (within 3 stars) stands on the path just below it with a small "1 to go". Ömer Faruk stands at the base with the mascot beside him ("Ready to climb"). The class jar is a flag on the summit that rises as it fills.
- **Give:** the dock view with tiles and reasons as in concept 1 (the scene is not a good tap target with 19 or 40 avatars).
- **Target reached:** Defne's avatar walks from the path to the Bronze camp, a flag goes up with her sticker, then the shared celebration. With motion reduced: she fades in at the camp.
- **Deductions:** Option A. Nobody ever walks down the mountain: a camp is a reached target and reached targets are never lost, which is also exactly Option B's floor.
- **Check:** 40 avatars at 1280 × 720 (camps wrap to rows; names fall back to initials with full names as accessible text), and that the map is drawn from tokens only so every theme and theme package can colour it.

### 10.7 Supporting screens to mock

1. **The give sheet on a phone** (375 × 812, the dock view's narrow form): a search-free list of child tiles in name order (two columns, avatar, name, own stars small), "Everyone here", a sticky bar of reason buttons (icon, name, "+1"), the status line "3 chosen", the result line with Undo, the save state badge ("Saved" / "Offline, 2 waiting"). For Option B also the sheet's second tab as it would look on the teacher's phone only.
2. **The reasons editor** (teacher area, desktop and 375 px): the list with drag handles and Move up / Move down buttons, each row icon, name fields per class language (`LangFields`, "Needs translation" mark), value stepper 1 to 5, Archive; "Add a reason"; the icon picker (the existing icon grid); the note "The class sees these names"; "Copy from another of my classes".
3. **The targets and rewards editor with the show-and-tell queue:** the ladder as rows (stars, name, sticker picker, "Show and tell turn" switch), "A new target every … stars after the last one", the period select, the jar (size, reward name, on/off). Beside or below it the queue: *Waiting* (Ege Kaya, Silver star, reached 18 November; "Plan a day"), *Planned* (Asya Bulut, Friday 27 November; "Done", "Move", "Not this time"), *Done* (Zeynep İrem Güneş, 13 November). The tile badge "2 waiting" on the teacher menu.
4. **The student page section "My stars"** (375 px, the student page's style of big tiles and short screens): the home tile with the total; the screen with the path to the next target ("1 more star to Bronze star"), the sticker album (reached, next as an outline, later ones plain), the last gives with reasons, the show-and-tell note, the class jar line. And the first-visit celebration after a target. No classmates anywhere.
5. **The target-reached celebration** on the classroom screen (1920 × 1080): full, reduced-motion and "animations off" versions; the "celebrate at the end of the lesson" End Lesson step listing three children with their stickers in name order; and the jar-full celebration.
6. **The classroom student card with stars** (the dialog a tapped name opens): the child's stars and next target, stickers, recent achievements and the proposed "See all" achievements view.
7. **The student grid with the star mark** on the cards at 19 and at 40 children, so the mark's cost in card space is seen.
