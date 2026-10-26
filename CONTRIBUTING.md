# Contributing to NSE Pulse

Thanks for helping. This project has an unusual constraint for a software repository: **most of
what it could display is data someone else owns.** Contributions are judged as much on
provenance honesty as on code quality.

## Ground rules

1. **Never invent data or endpoints.** No placeholder provider URLs, no seeded prices, no
   "example" quotes presented as market data, no scraping of NSE pages or third-party mirrors.
2. **`MARKET_DATA_PROVIDER` stays `none`** until a provider is selected, licensed and a real
   adapter is implemented. Credential presence alone must never enable live data.
3. **No fabricated verification.** Do not write "tested", "verified" or "production-ready" in
   docs, commit messages or PR descriptions unless you ran the command and have the output.
4. **Do not weaken gates to go green.** Coverage thresholds, ESLint rules and TypeScript
   strictness are floors. Do not add blanket `any`, global rule disables, `@ts-ignore`
   without a written reason, or files that exist only to raise a metric.
5. **No secrets, ever.** No `.env` files, tokens, connection strings, database dumps, personal
   data or restricted market data in commits, tests, fixtures or issues.
6. **Preserve history.** No force pushes, no rewritten commits, no impersonated authorship.

## Getting set up

```bash
nvm use                 # Node 22 per .nvmrc
npm ci
cp .env.example .env    # then set DATABASE_URL if you have PostgreSQL
npm run db:migrate      # only if a database is configured
npm run dev
```

PostgreSQL is optional for most work. Only `db:migrate`, `db:check`, the CSV import and
`test:integration` need it.

## Before opening a pull request

```bash
npm run verify          # typecheck → lint → format → secret scan → coverage → build
```

Add `npm run test:integration` with a disposable `TEST_DATABASE_URL` when you touched
repositories, migrations or SQL. Do not point `TEST_DATABASE_URL` at a database you care about.

## Change requirements

| Change                       | Requirement                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bug fix                      | A regression test that fails before the fix and passes after                                                                                                |
| New API behaviour            | Route test (supertest) covering success, validation failure and unavailable-data path; update `docs/openapi.yaml`                                           |
| Financial or indicator maths | Unit tests with hand-checked inputs, plus a documented formula and unit in the response                                                                     |
| Provider adapter work        | Interface-conforming adapter with mocked HTTP fixtures; a test asserting no request is made without explicit configuration; update `docs/PROVIDER_SETUP.md` |
| Schema change                | Versioned Drizzle migration (`npm run db:generate`), reviewed SQL, and an integration test where feasible                                                   |
| Environment variable         | Read through `src/server/config.ts`, documented in `.env.example` **and** README §8                                                                         |
| Logging change               | Structured fields only; no secrets, tokens, request bodies or raw payloads                                                                                  |
| Dependency update            | Keep the lockfile in sync; `npm audit --audit-level=high` must stay clean; note breaking changes                                                            |

## Commit and branch conventions

- One workstream per commit, with a conventional prefix: `feat:`, `fix:`, `test:`, `ci:`,
  `build:`, `security:`, `logging:`, `docs:`, `refactor:`.
- Explain _why_ in the body; state what was actually run to verify it, and what could not be run.
- Never rewrite history that others may have based work on, and never force push a shared branch.
- Keep unrelated formatting churn out of functional commits.

## Data and licensing obligations for contributors

- Do not commit market data of any kind, including "small samples" of real quotes, unless the
  licence explicitly permits redistribution; sample fixtures must be synthetic and labelled.
- Do not commit issuer documents or datasets whose terms you have not read.
- Do not add a dataset download step to CI or to the build.
- If your change depends on a third-party dependency with a licence that restricts commercial
  redistribution, open an issue before adding it.
- Do not change the repository licence, or add one, as part of an unrelated change.

## Reporting problems

- Functional bugs and feature requests: open an issue with reproduction steps and the observed
  versus expected response, redacting any real data.
- Security issues: report privately to the maintainers; never in a public issue, and never with
  live credentials or market-data payloads attached.

## Code review expectations

Reviewers check, in order: does it invent or misrepresent data; does it leak secrets; is the
error path honest and non-leaky; are the tests meaningful (would they fail if the behaviour
broke); do the docs match the code; is the diff minimal and reviewable.
