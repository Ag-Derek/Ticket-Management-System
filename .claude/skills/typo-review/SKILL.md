---
name: typo-review
description: Review spelling, grammar, wording and term consistency in Docket's user-facing text, docs and code comments. Run before opening a PR. Reports findings first; applies spelling fixes only on request and wording changes only after approval.
---

# Typo review

Catch spelling and wording mistakes before they reach users. cspell already
runs in CI on every PR (`cspell.json`, job `spelling` in
`.github/workflows/ci.yml`). This review covers what cspell can't: grammar,
wording, tone and using one spelling per term.

## When to run

Before opening a PR. The developer runs `/typo-review`. By default, review the
changes on the current branch compared with `main`
(`git diff main...HEAD` plus uncommitted changes). If the user says "full" or
"all", review the whole repo.

## What to check

- UI text in `client/*.html` and `client/app.js`: labels, buttons, headings,
  placeholders, `title`/`aria-*` text, alerts, toasts and helpbot answers
- Email templates and email subjects (`docket-server/utils/email.js`,
  `ticket-notifications.js`, `message-reminders.js`, and anything else that
  sends mail)
- Error and status messages returned to clients (`res.status(...).json({ error: ... })`)
- README and docs (`**/*.md`, `docket-server/docs/`)
- Code comments

## What to skip

- Variable, function, property, CSS class and file names
- `.env*` files, lockfiles (`package-lock.json`)
- Migrations and one-off DB scripts (`docket-server/db/migrate-*.js`,
  `docket-server/db/remove-seeded-agents.js`)
- Backups (`*.backup*`, `backups/`)
- Helpbot keyword lists (`words: [...]` in `client/app.js`). They include
  alternate spellings such as "licence" and "normalise" on purpose, so that
  users' questions still match.

## Steps

1. Run cspell first: `npx --yes cspell@10.4.1 --no-progress` (or pass the
   changed files). Include its hits in the report.
2. Read the in-scope text in the changed files and check for:
   - Spelling cspell missed: real words used wrongly, such as their/there or
     its/it's
   - Grammar: agreement, missing or repeated words, punctuation
   - Wording: unclear, overlong or inconsistent tone in UI text and errors
   - Consistency against the term list below
3. Report findings. Don't edit anything yet.

## Term list (one spelling per term)

| Use | Not |
| --- | --- |
| sign in (verb), sign-in (noun/adjective) | log in, login, Login |
| sign out | log out, logout, Logout |
| sign up (verb), sign-up (noun) | signup |
| email | e-mail |
| US spelling: organization, normalize, customize, license, recognize | -ise / -isation / licence |
| check / uncheck (a box) | tick / untick |
| Docket, Supabase, Resend, MFA | lowercase or other variants in prose |

When a new term needs a single spelling, add it to this table. When cspell
flags a real word (a product, a name or a Postgres keyword), add it to `words`
in `cspell.json` in alphabetical order within its group. Don't use it to hide
a typo.

## Labels

Give every finding one label:

- **must fix**: a visible mistake users will see, such as a misspelling in UI
  text, an email or an error message, broken grammar that changes the meaning,
  or wrong product names. Only must-fix findings block a merge.
- **should fix**: a term-list inconsistency, an unclear message, or a
  misspelling in docs or comments.
- **nit**: style or tone preference, or a minor comment wording.

## Report format

Group findings by label (must fix first). For each one:

```
[must fix] client/portal.html:28 — "Logout" → "Sign out" (term list: sign out)
```

End with counts per label and whether anything blocks the merge.

## Applying fixes

- **Spelling** fixes (including US spelling): apply when the user asks, for
  example "fix the spelling".
- **Wording** changes (rephrasing, term-list changes to UI text or error
  messages): list each proposed change and apply only the ones the user
  approves.
- Never rename identifiers, change behavior, or touch skipped files.
- After fixing, run cspell again and confirm it passes.
