# DataFactor readiness review — provenance, licensing and data constraints

This document is a self-assessment prepared for an external readiness review of the NSE Pulse
repository. It records **what is in the repository, where it came from, and what its licensing
position actually is.**

It deliberately contains:

- no score, ranking, payout or eligibility claim,
- no statement that any programme, reviewer or data provider endorses this project,
- no assertion of exclusive ownership that the repository's history does not support,
- no claim that a licence exists where none does.

Everything below is reproducible from the repository and the commands listed in
`docs/ENGINEERING_READINESS.md` §15.

## 1. Repository licensing position

| Question                              | Answer                                                                                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is there a `LICENSE` file?            | **No.** `ls LICENSE` fails; the root contains no licence text.                                                                                                                                                                                                 |
| What does `package.json` say?         | It has no `license` field. `npx license-checker` therefore reports the root package as `UNLICENSED`.                                                                                                                                                           |
| Was a licence added during this work? | **No.** Adding or changing a repository licence is a decision for the repository owner, not for an automated contributor.                                                                                                                                      |
| What is the default legal position?   | Without a licence grant, default copyright applies: the code may not be freely redistributed or used commercially by third parties without the owner's permission. Any commercial redistribution therefore requires an explicit licence decision by the owner. |
| Are there third-party notices files?  | No `NOTICE` or `THIRD_PARTY_NOTICES` file exists. Dependency licences are listed in §3 instead of being vendored.                                                                                                                                              |

**Action required from the owner:** choose a licence (or a commercial/proprietary stance) before
distributing the project or accepting outside contributions at scale. Contributors currently
retain copyright in their own contributions unless a CLA or DCO is introduced.

## 2. Provenance inventory

| Component                                            | Origin                                      | Evidence                                                                                                                                                   | Rights position                                                                                  |
| ---------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Application source (`src/`, `tests/`, configs, docs) | Written in this repository's own history    | `git log` — 12 commits, authors `fetronix <fidelism99@gmail.com>` (initial commit `85207b7`) and `Arena Agent <agent@arena.ai>` (subsequent commits)       | Copyright held by the respective authors/organisation; no assignment document exists in the repo |
| Dependencies                                         | npm registry, pinned in `package-lock.json` | 423 packages in the full tree                                                                                                                              | Permissive licences dominate; 6 MPL-2.0 and 1 CC-BY-4.0 appear in the dev/build tree (§3)        |
| Adapted or generated code                            | None identified                             | No vendored source trees, no copied third-party modules, no `vendor/` directory                                                                            | —                                                                                                |
| Fonts, icons, images                                 | None shipped                                | `dist/assets` contains only the compiled CSS/JS; client UI is CSS-only                                                                                     | —                                                                                                |
| Sample/fixture data                                  | Synthetic, authored here                    | `tests/fixtures/provider.ts` uses `SCOM`, `EQTY`, `KEGN` with deliberately unrealistic prices labelled `DEMO FIXTURE — SYNTHETIC VALUES, NOT AN NSE QUOTE` | Synthetic values are not market data and carry no third-party rights                             |
| Market data                                          | **Not present**                             | No CSV, dump or seed of real prices, securities, announcements or dividends                                                                                | Data would be subject to NSE/vendor terms; nothing is shipped                                    |
| Documentation and diagrams                           | Authored here                               | Markdown under `docs/` and the root                                                                                                                        | Same position as source                                                                          |
| User data                                            | **Not present**                             | No database dumps, logs, Telegram member lists or personal data in the tree                                                                                | Not applicable                                                                                   |
| Credentials                                          | **Not present**                             | `npm run check:secrets` scans tracked files; no `.env` is tracked                                                                                          | —                                                                                                |

## 3. Dependency licence inventory

Produced with `npx license-checker --production --json` and `npx license-checker --json` on a
clean `npm ci` tree.

### Production runtime (122 packages)

| Licence      | Count | Notes                                           |
| ------------ | ----- | ----------------------------------------------- |
| MIT          | 111   | Permissive; attribution required                |
| ISC          | 6     | Permissive                                      |
| BSD-2-Clause | 2     | Permissive                                      |
| BSD-3-Clause | 1     | Permissive; no-endorsement clause               |
| Apache-2.0   | 1     | Permissive; patent grant and NOTICE obligations |
| Unlicensed   | 1     | This project itself                             |

**No copyleft licence appears in the production dependency set.** If the project is distributed
as a container image or bundle, the MIT/ISC/BSD/Apache attribution notices must be reproduced.

### Development and build tree (423 packages in total)

| Licence       | Count | Notes                                                                      |
| ------------- | ----- | -------------------------------------------------------------------------- |
| MIT           | 353   | Permissive                                                                 |
| ISC           | 24    | Permissive                                                                 |
| Apache-2.0    | 20    | Includes tooling; patent grant and NOTICE obligations                      |
| BSD-2-Clause  | 9     | Permissive                                                                 |
| BSD-3-Clause  | 7     | Permissive                                                                 |
| MPL-2.0       | 6     | File-level copyleft, in `lightningcss` (build/runtime of the CSS pipeline) |
| CC-BY-4.0     | 1     | `caniuse-lite` browser-support data; attribution required                  |
| 0BSD          | 1     | `tslib`; effectively public-domain equivalent                              |
| BlueOak-1.0.0 | 1     | Permissive                                                                 |
| Unlicensed    | 1     | This project itself                                                        |

Compliance notes for a commercial distribution:

- **MPL-2.0 (`lightningcss`)** is file-level copyleft. Shipping the _compiled output_ is not
  affected; shipping modified `lightningcss` source files would require publishing those files.
  No modification is made here.
- **CC-BY-4.0 (`caniuse-lite`)** requires attribution if its dataset is redistributed. It is a
  build-time input, but if build artifacts embed its data, keep the attribution notice.
- **Apache-2.0** dependencies require preserving their `NOTICE` content if present.

## 4. Market-data constraints (the substantive commercial risk)

| Constraint                                                                                                                         | Position taken in this repository                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NSE states delayed data is at least 15 minutes delayed and that redistribution through software or web products requires a licence | The application does not infer "live" from refresh frequency, and no redistribution is implemented                                                             |
| No provider licence is held                                                                                                        | `MARKET_DATA_PROVIDER=none`; the commissioned adapter refuses to run and invents no endpoint                                                                   |
| No credentials exist                                                                                                               | `NSE_VENDOR_API_KEY` / `NSE_VENDOR_API_BASE_URL` are empty placeholders; credential presence alone cannot enable data                                          |
| No scraping                                                                                                                        | No scraper, headless browser or HTML-parsing ingestion path exists in the tree                                                                                 |
| Issuer announcements need their own permission                                                                                     | Gated behind `ANNOUNCEMENTS_PERMISSION_CONFIRMED`; default response is `PERMISSION_UNCONFIRMED`                                                                |
| Historical series need their own permission                                                                                        | Gated behind `HISTORICAL_DATA_PERMISSION_CONFIRMED`; rows are withheld regardless of what is stored                                                            |
| Derived analytics could still be restricted                                                                                        | Indicators are computed only from stored observations that the operator is permitted to hold; the licence question belongs to that data, not to the arithmetic |

**Commercial-redistribution risks to flag explicitly:**

1. Any future licensed feed must be reviewed for _derived-data_ and _redistribution_ rights —
   many vendor contracts restrict computed outputs and caching, not just display.
2. Distributing this application as-is does **not** grant anyone a data licence; an operator
   deploying it must obtain their own.
3. Announcement republication is a separate right from price data.
4. The demo fixtures are synthetic by construction and must never be relabelled as real data.

## 5. Data handling in the review package

| Item                              | Present? | Verification                                                                             |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Production database contents      | No       | No dumps or `.sql` data files; `.gitignore` excludes `*.dump`, `*.sql.gz`, `.pgdata/`    |
| Credentials or tokens             | No       | `npm run check:secrets` (tracked files); `.env` is git-ignored                           |
| Restricted market data            | No       | No data files at all; ingestion is not implemented                                       |
| Personal or user data             | No       | No accounts, no sessions, no Telegram member storage                                     |
| Logs with payloads                | No       | Logger redacts credential-shaped keys and logs paths without query strings or bodies     |
| Third-party copyrighted documents | No       | Announcements are referenced by URL only when a permitted source exists; none are stored |

## 5a. Verification log (2026-10-25, three passes)

Added so a reviewer can see which statements below rest on executed commands. Environment:
Linux sandbox, Node 22.22.3, PostgreSQL 16.14 (embedded binaries), `psql`/`pg_dump`/`pg_restore`
16.2. **No Docker runtime was available**, so the container image remains unverified and nothing
in this document depends on it.

| Claim in this document                                               | How it was checked                                                                                                                               | Result                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| No market data is shipped                                            | Search of the tree for data files and dumps; no `.csv`/`.dump`/seed data present; demo fixtures are synthetic constants                          | Confirmed                           |
| No credentials in the repository                                     | `npm run check:secrets` over all tracked files (100 files scanned)                                                                               | Passed                              |
| No credentials, dumps or market data, re-checked after later commits | `npm run check:secrets` over 100 tracked files; the backup/restore drill used disposable databases seeded with synthetic `PASSC*` securities     | Confirmed (Pass C)                  |
| Demo mode cannot be enabled by configuration alone in production     | `tests/server/config.test.ts` child-process cases; runtime smoke test with `MARKET_DATA_PROVIDER=none` reported `liveQuoteAdapterEnabled: false` | Confirmed                           |
| No production database contents                                      | Backup/restore drill used disposable local databases created for the purpose and seeded with three synthetic `DRILL*` securities                 | Confirmed                           |
| Dependency licence mix (§3)                                          | `npx license-checker --production --json` (122 packages) and `--json` (423 packages)                                                             | Unchanged from the statement below  |
| No copyleft in the runtime dependency set                            | Production tree: MIT 111, ISC 6, BSD-2 2, BSD-3 1, Apache-2.0 1, project itself unlicensed                                                       | Confirmed                           |
| No repository licence                                                | `ls LICENSE` fails; `package.json` has no `license` field                                                                                        | Confirmed; not changed in this pass |
| Author history preserved                                             | `git log` retains the original `fetronix` commit `85207b7` beneath the agent commits; no rebase, amend of others' commits, or force push         | Confirmed                           |
| Historical/announcement data gated by permission                     | Live server with a real database returned `state: "PERMISSION_UNCONFIRMED"` for announcements and withheld history unless the flag is set        | Confirmed at runtime                |

Not verified and not claimed: that any dataset is licensed for redistribution, that the
application is fit for a commercial deployment, or that the container image builds.

Docker remains blocked in this environment for two independent reasons, so no container evidence
is claimed anywhere in this document: no runtime can be installed (no reachable package mirror)
and no base image can be pulled (`registry-1.docker.io` unreachable). See
`docs/ENGINEERING_READINESS.md` §9 for the exact commands to reproduce the container checks where
Docker is available.

Docker remains blocked in this environment for two independent reasons, so no container evidence
is claimed anywhere in this document: no runtime can be installed (no reachable package mirror)
and no base image can be pulled (`registry-1.docker.io` unreachable). See
`docs/ENGINEERING_READINESS.md` §9 for the exact commands to reproduce the container checks
where Docker is available.

## 6. What a reviewer can verify without external access

```bash
git log --format='%h %an <%ae> %s'          # authorship, unmodified history
ls LICENSE || echo "no licence file"        # licensing position
npx license-checker --production --summary  # runtime licence mix
npm run check:secrets                       # no committed credentials
grep -rIl "MARKET_DATA_PROVIDER" src docs   # provider gate locations
npm run test:coverage                       # unit/API/client suite and thresholds
npm run build:all                           # client + server artefacts
npm run check:secrets                       # no committed credentials
```

Database-dependent checks need a disposable PostgreSQL (`docker compose --profile test up -d db-test`):

```bash
TEST_DATABASE_URL=postgres://nse_pulse_test:test_only@127.0.0.1:5433/nse_pulse_test \
  npm run test:integration:verified         # fails if the suite only skipped
```

## 7. Limitations of this review

- No lawyer or licensing specialist has reviewed the repository; the dependency analysis is
  mechanical (package metadata), not legal advice.
- Copyright ownership of contributions is recorded by git authorship only. There is no
  contributor agreement, copyright assignment or employment record in the repository.
- No market-data agreement, letter of permission or vendor contract is present, and none is
  claimed.
- The absence of third-party data was verified by searching the tree; a future commit could
  change that, so re-run the checks at the commit under review.

## 8. Declarations

This project claims no endorsement, score, funding decision or payout from any readiness
programme or data provider. It is an early-stage engineering increment with no licensed market
data, no authentication and no production deployment history. The honest summary is: the
engineering scaffolding and its verification are real and reproducible; the commercial data
position is not established and cannot be established by this repository alone.
