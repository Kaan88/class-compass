# AI tools: connecting an AI assistant

Class Compass can let an AI assistant, such as **Claude Code**, work with your classes for you: read a report and write a short weekly summary, suggest goal presets, plan the week's lesson topics or design a theme. The assistant connects through the **Model Context Protocol (MCP)**, an open standard for AI tools, at the address `/mcp` of your school's Class Compass.

The assistant can do exactly what you can do in Class Compass, and only the parts you choose. Every call it makes is logged (what was called and when, never what was in it), and every change it makes is in the audit log under your name, marked "through an AI tool".

AI tools are **off** until an administrator switches them on, and **student names stay inside the school** until the administrator, with the school's KVKK contact, decides otherwise.

## What leaves the school

With **pseudonyms** (the default, and the only choice while the school's "Student data to AI tools" switch is off):

- Students appear as **"Student 1", "Student 2"** and so on, and their ids as `student-1`, `student-2`. The numbers stay the same for one token, so the assistant can follow a student across questions. It can use `student-3` in its own requests (only for your own students).
- Student names inside text you or other teachers wrote (a lesson reflection, feedback, a homework title) are replaced by the pseudonym, also in Turkish spellings (İ/I, ş, ğ…).
- **Anything a student wrote** (goals, reflections, notes to themselves, evidence text and links) is **withheld**.
- What does leave: class and subject names, dates, counts with their totals, attendance and homework statuses per pseudonym, your own text with names replaced, goal categories and presets, settings.

With **names** (only when the administrator allows student data, and only for tokens made with "Names"):

- Student names and what students wrote also leave. Student writing is marked as `untrustedText`, so the assistant treats it as data and never as an instruction.

**Never, in either case:** files, photos and voice recordings; private teacher notes and homework notes; Secret Student choices before the reveal; grouping levels; student link addresses and codes; passwords, PINs and sign-in data; exports, backups and deleting students.

> Where the data goes depends on the AI tool you use: with Claude Code it goes to Anthropic under your own account. Use only the tools your school has agreed to, and only fictional data while you are trying things out.

## For administrators: switch it on

Open **AI tools** in the administration menu.

- **AI tools are on**: switches the `/mcp` address on. While it is off, no token works and no new token can be made.
- **Longest a token may last**: 7 to 90 days (90 by default). Teachers choose a shorter time for each token.
- **Student data to AI tools**: off by default. Switch it on **only after your school's KVKK contact has agreed** and the parent privacy note says so. The dialog lists what would leave the school; type `STUDENT DATA` to confirm. Switching it off takes effect at once for every token.
- **What leaves the school** repeats the list above for the current setting.
- **Tokens at this school** lists every token (never its secret) with its account, permissions, privacy and last use. **Revoke** stops one at once. Changes on this page are in the audit log.

If your school reaches Class Compass through Cloudflare Access, the IT person must let `/mcp` through (see `docs/OPERATIONS.md`, "AI tools"): an AI tool cannot sign in to Cloudflare.

## Make a personal token

Open **Profile** (teachers from the menu, administrators from the administration menu) and find **AI tools**. On a classroom computer the PIN is asked first.

1. Press **New token**.
2. **Name**: where you will use it, for example "Claude Code on my laptop".
3. **Permissions**: choose only what the assistant needs. Read permissions are chosen to start with. Teachers can choose: see my classes, students and homework; read reports and student timelines; read goals; write goals, presets, sentence starters and feedback; set and mark homework; classroom actions in a running lesson; change class settings. Administrators can choose: read school structure and school-wide reports; change school settings; save theme drafts.
4. **Valid for**: a number of days, at most what the school allows.
5. **Students are shown as**: only when the school allows names. Pseudonyms are the safe default.
6. Type your **current password** (accounts that sign in with an email link sign in again first) and press **Make token**.

The token (it starts with `ccmcp_`) is **shown only once**. Copy it, or copy the ready-made Claude Code command, and keep it like a password. Class Compass keeps only a fingerprint of it.

The list shows your tokens with their permissions, until when they are valid and when they were last used. **Revoke** stops a token at once; make a new one when you need it again.

## Claude Code

On your own computer, with Claude Code installed, run the command from the dialog. It looks like this (your school's address and your token instead of the examples):

```
claude mcp add --transport http class-compass https://school.example.org/mcp --header "Authorization: Bearer ccmcp_…"
```

Then ask Claude, for example: "Use class-compass: give me a short summary of last week in 3-A English." Claude starts with **list_my_classes** and asks before it changes anything when you tell it to.

Useful tools: **class_overview**, **class_report** (ask for a few sections when a report is large), **student_summary**, **goal_library**, **create_goal_preset**, **create_sentence_starter**, **get_topic_plan** and **set_topic_plan**, **create_homework**; for themes **theme_schema**, **validate_theme** and, for administrators, **import_theme_draft** (it saves a draft; enabling a theme stays your decision on **Themes**). Ready-made requests (prompts): weekly summary, goal presets, topic plan, design a theme.

## claude.ai and Claude Desktop (coming)

> This part is not ready yet. Connecting claude.ai or Claude Desktop as a "custom connector" needs a sign-in in the browser (OAuth) instead of a token you paste; it comes with the next stage of the AI tools work. Until then use Claude Code with a personal token.

## Good to know

- A token works only at the `/mcp` address, never in the app itself, and a signed-in browser cannot use `/mcp`.
- Each token may make about 120 calls a minute; very large answers are shortened with a note asking for a narrower question.
- When an account is deactivated, or must change its password, its tokens stop working.
- The assistant sees only your own classes and students, exactly like you do.
