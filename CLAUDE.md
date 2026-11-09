@AGENTS.md

## Claude-specific notes

- Everything in AGENTS.md applies; it is the shared guide for every AI tool and for people.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line your session's instructions give).
- Parallel stages run as subagents in their own git worktrees (`.claude/worktrees/`): run `npm ci` there, never edit the owner's main checkout, and push only as described in AGENTS.md → "Stage workflow".
- Use explicit `git add <paths>`; never skip hooks (`--no-verify`) or force-push.
- Theme work: read `docs/THEMING.md` → "For AI agents: making a package" and validate every package with `validateThemePackage` before handing it over. Enabling a theme is always left to an administrator.
- Fictional data only in anything you write, generate or screenshot; never paste real student data into a prompt, a file or a test.
