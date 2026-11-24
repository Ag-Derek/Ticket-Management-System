---
name: docs-updater
description: Bring Docket's README, docs and CHANGELOG.md up to date with the PRs merged into main since the last run. Run weekly on Monday, or after a batch of PRs is merged. Edits only README, docs and CHANGELOG.md, on a new branch; a maintainer reviews, commits and opens the PR.
---

# Docs updater

Keep the README, docs and changelog in step with what has been merged into
`main`. The developer runs `/docs-updater`.

## When to run

- Weekly on Monday, after the Dependabot PRs for the week are merged
- By hand after a batch of PRs is merged

## Rules

- **Only edit** `README.md` (any folder), files under `docs/` folders (such
  as `docket-server/docs/`) and `CHANGELOG.md`. Never change code, config,
  workflows, tests, migrations, `.env*` files or lock files. If a doc can't be
  fixed without a code change, report it instead.
- **Only merged work.** Work from what is on `origin/main`. Never mention open
  or unmerged PRs, branches or issues.
- **Public repo.** Never write secrets, keys, tokens, real email addresses,
  host names, project refs or `.env` values. Use placeholders such as
  `<project URL>`, as `docket-server/docs/recovery.md` does.
- **Security fixes** are listed only after they're merged. Even then, say what
  changed for users ("sign-in responds the same way whether or not an account
  exists"), not how the old behavior could be exploited: no attack steps,
  payloads or affected versions.
- **Branch, don't commit.** Make the changes on a new branch off `origin/main`.
  The maintainer reviews, commits, pushes and opens the PR.

## Steps

1. **Branch.**
   ```
   git fetch origin
   git switch -c docs/update-YYYY-MM-DD origin/main
   git branch --unset-upstream
   ```
   Stop if the working tree isn't clean.

2. **Find the last run.** `CHANGELOG.md` has a marker on its second line:
   `<!-- docs-updater: last-merge <sha> (PR #<n>) -->`. Everything after that
   commit is new. If `CHANGELOG.md` doesn't exist, this is the first run: cover
   every merged PR.

3. **List what was merged since then.**
   ```
   git log <sha>..origin/main --merges --first-parent --format='%h %ad %s%n%b' --date=short
   git log <sha>..origin/main --no-merges --first-parent --format='%h %ad %s' --date=short
   ```
   The first lists merged PRs (the PR title is the commit body). The second
   lists commits pushed straight to `main`; include those that change behavior
   and cite them by short hash.

4. **Read each change.** PR titles are often vague ("Code changes",
   "Email sending changes"). For each PR, look at the diff before writing
   about it: `git diff <merge>^1 <merge> --stat`, then the relevant parts.
   Describe what actually changed, not the title.

5. **Update CHANGELOG.md.** Add one section per week at the top, below the
   marker, newest first. See the format below.

6. **Update README and docs.** For each change, check whether any README or
   doc is now wrong or missing something: setup steps, environment variables,
   scripts, routes, tables, backup and restore steps. Fix what's out of date
   in the existing style. Don't create a new doc or README unless the user
   asks; list it under "Gaps" in the report instead.

7. **Move the marker** to the newest merge commit on `origin/main`:
   `<!-- docs-updater: last-merge <sha> (PR #<n>) -->`.

8. **Check spelling.** Run `npx --yes cspell@10.4.1 --no-progress CHANGELOG.md`
   plus any doc you changed, and follow the term list in
   `.claude/skills/typo-review/SKILL.md` (sign in, email, US spelling).

9. **Report and stop.** Don't commit.

## CHANGELOG format

```markdown
# Changelog
<!-- docs-updater: last-merge e74ed77 (PR #84) -->

What has changed in Docket, newest first. Each week lists the PRs merged
into `main` that week.

## Week of 2026-11-23

### Added
- One line per change, in plain words for someone using or running Docket (#76)

### Changed
### Fixed
### Security
### Maintenance
```

- Headings are the Monday of the week the PR merged (`## Week of YYYY-MM-DD`).
  If a week already has a section, add to it.
- Use only the subsections that have entries, in the order above.
  - **Added**: new features
  - **Changed**: changes to existing behavior
  - **Fixed**: bugs
  - **Security**: hardening and security fixes (see the rules above)
  - **Maintenance**: dependencies, CI, tooling and agents. Dependency bumps
    go on one line each with the new version (`express-rate-limit 8.7.5 (#81)`).
- End each entry with the PR number `(#76)`, or the short hash for a direct
  push. Merge several PRs into one entry only when they're the same change.
- Write for someone using or running Docket, not for the person who wrote
  the code. No file paths unless the entry is about a doc or script.

## Report format

```
Docs updater: PRs #85 to #91 (7 merged), 2 direct commits

Changed
- CHANGELOG.md: week of 2026-11-30 (6 entries), marker moved to <sha> (PR #91)
- docket-server/docs/recovery.md: restore steps updated for the new --dry-run flag (#89)

Gaps (not changed)
- No README.md for the repo
- PR #88 adds SOME_SETTING but no doc mentions it

Branch docs/update-2026-11-30, not committed. Review the diff, then commit
and open the PR.
```
