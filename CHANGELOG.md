# Changelog
<!-- docs-updater: last-merge e74ed77 (PR #84) -->

What has changed in Docket, newest first. Each week lists the PRs merged
into `main` that week. It is kept up to date by the `/docs-updater` skill.

## Week of 2026-11-23

### Changed
- Tickets are now filed by product (RiskFlow Calibre, Symphony, Orcaa.ai,
  Credit Studio & Onboard Studio) instead of by category (Network,
  Application, Hardware, Access & Identity). Forms, filters, search,
  reports and ticket emails all use the new names (#76)

### Security
- Sign-in responds the same way whether or not an account exists (#84)
- Rate limit counts are kept in the database instead of server memory, so
  limits still apply after a restart (#83)

### Maintenance
- Dependabot opens weekly dependency updates on Monday, with minor and
  patch updates grouped. A new check comments on PRs when `package.json`
  and the lockfile don't match (#77, eeadbaa)
- dotenv 18.0.10 (#82)
- express-rate-limit 8.7.5 (#81)
- bcryptjs 3.0.3 (#80)
- Five minor and patch updates (#79)
- actions/checkout 7 in CI (#78)

## Week of 2026-11-16

### Fixed
- A sign-in code that arrives late still works after a newer code was
  requested. Once any code is used, the others stop working (#52)
- Returning customers' profile changes are saved after they verify their
  sign-in code (#51)
- Attachments are all checked before any are uploaded, so one bad file
  no longer leaves the others stored. The file picker only offers allowed
  file types (#50)

### Security
- Password reset checks the reset link before hashing the new password,
  and hashes without holding up other requests (#53)
- The frontend sends security headers on every page (#46)
- The server no longer advertises that it runs on Express (#45)
- No admin account is created when `ADMIN_EMAIL` isn't set (#47)

### Maintenance
- `/typo-review` skill, and a spelling check (cspell) on every PR (#75)

## Week of 2026-11-09

### Fixed
- A comment that is rejected no longer leaves its attachments in storage (#40)
- Running the frontend locally calls the local API instead of production (#39)

## Week of 2026-11-02

### Changed
- All emails share one branded layout, with a Docket header, button links
  and a footer (#37)

### Fixed
- Updating a ticket that someone else changed since you opened it shows the
  latest version instead of overwriting their change (#38)
- Only the customer, or an admin, can confirm or reopen a resolved ticket.
  Agents can't (#36)
- Agent workload in reports only counts tickets in the selected date range (#35)
- Deleting an agent restarts the SLA clock on tickets that were paused (#34)

### Maintenance
- Automated tests run in CI on every PR and merge (#33)

## Week of 2026-10-26

### Fixed
- Restoring a backup asks you to confirm which database it will replace
  (#10, see `docket-server/docs/recovery.md`)
- The server starts even when the database is down, and recovers by itself
  once the database is back (#9)
- Attachments with non-ASCII filenames download correctly (#7)

### Security
- Customers no longer receive internal comments or escalation notes on
  their tickets (#6)
- Sign-in checks that each field is the right type (#4)

### Maintenance
- Dependencies updated to clear `npm audit` (#5)

## Week of 2026-08-31

### Added
- Attachments a ticket was filed with are shown on the portal and on the
  agent and admin dashboards (#3)

### Fixed
- Closing tickets and unassigning agents work as expected (#2)
- Fixes to the customer portal and agent dashboard (#1)
