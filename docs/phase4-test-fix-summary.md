# Phase 4 Test Fix Summary

## What Was Fixed

### Pre-existing State

When this session began, the existing `phase4.test.ts` had **20 service-level tests** that were all passing. The problem statement referred to 9 previously-failing tests that had already been resolved by prior work (the DB mock chain helper `setupAlertsOrgChain` correctly models the `selectDistinct → innerJoin × 3 → where` chain for portfolio issuers and the `Promise.all`-based rows + count query).

### What Was Added

The primary deliverable was **20 new HTTP route-level tests** covering the full route layer for the alerts and portfolios routes. These were added to `phase4.test.ts` in 8 new `describe` blocks.

#### New dependencies

- `supertest` + `@types/supertest` — added as devDependencies for HTTP-level route testing.

#### New test infrastructure in phase4.test.ts

- A minimal Express test app (`testApp`) that injects `orgId` from the `X-Organization-Id` header, mirroring the real `mockAuthResolver` behavior.
- Route imports: `alertsRouter` and `portfoliosRouter`.
- Service spy imports: `* as alertEvalSvc` and `* as portfolioSvc` for `vi.spyOn()` usage in route tests.
- `afterEach(() => vi.restoreAllMocks())` per describe block to prevent spy leakage between tests.

### Route Behaviors Validated

| Route | Behavior Tested |
|---|---|
| `GET /alerts` | 401 without org context |
| `GET /alerts` | 200 with alert page; passes orgId + filters to service |
| `POST /alerts/bulk-read` | 401 without org context |
| `POST /alerts/bulk-read` | Only updates alerts belonging to current org (DB join filter) |
| `POST /alerts/bulk-read` | Returns `updated:0` for cross-org IDs |
| `POST /alerts/:id/unread` | 401 without org context |
| `POST /alerts/:id/unread` | 404 when alert does not belong to requesting org |
| `POST /alerts/:id/unread` | 200 and marks alert unread when org owns it |
| `POST /alerts/:id/feedback` | 401 without org context |
| `POST /alerts/:id/feedback` | 404 when alert does not belong to requesting org |
| `POST /alerts/:id/feedback` | 200 and upserts feedback when org owns the alert |
| `GET /portfolios` | 401 without org context |
| `GET /portfolios` | 200 with portfolio list for requesting org |
| `GET /portfolios/:id` | 401 without org context |
| `GET /portfolios/:id` | 404 for cross-org portfolio (blocked) |
| `GET /portfolios/:id` | 200 with details for owning org |
| `GET /portfolios/:id/exposure-alerts` | 401 without org context |
| `GET /portfolios/:id/exposure-alerts` | 404 for cross-org portfolio (blocked) |
| `GET /portfolios/:id/exposure-alerts` | 200 with exposure alerts for owning org |

## Real Route/Service Bugs Found

**None.** The route and service logic was correct. No speculative refactors were made.

One discovery during test authoring: the `POST /alerts/:id/feedback` body schema (`SubmitAlertFeedbackBody`) requires `organizationId` in the request body and `rating` must be one of `"useful"`, `"noise"`, or `"investigate_later"`. Tests use `"useful"` as the valid rating value.

## Test Quality Notes

- **No mock leakage**: each route describe block uses `afterEach(() => vi.restoreAllMocks())` to clean up `vi.spyOn()` calls.
- **Clear DB call correspondence**: direct-DB route tests (bulk-read, unread, feedback) document which mock setup corresponds to which query path via inline comments.
- **Deterministic**: service function spies return controlled values; DB mock `once` variants prevent cross-test interference.
- **Reusable helpers**: the existing `setupAlertsOrgChain()` and `resetDb()` helpers are reused in the route tests where DB mocking is needed.

## Final Test Count

| File | Tests |
|---|---|
| phase4.test.ts | 40 (20 original + 20 new route tests) |
| All test files | 233 total |
