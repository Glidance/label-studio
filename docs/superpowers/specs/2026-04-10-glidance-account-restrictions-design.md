# Glidance Account Restrictions — Design

**Status:** Draft
**Date:** 2026-04-10
**Base branch:** `glidance`
**Target branch:** `glidance-account-restrictions` (merges back into `glidance`)

## Problem

Non-Glidance users of our Label Studio deployment currently have access to UI
surfaces that allow them to exfiltrate data or manipulate account-level
settings:

- The **Export** button in Data Manager and the project-level `/export` modal
- The **Organization** page (member management, settings)
- **Access token** management in Account Settings (both legacy token and the
  new JWT-based tokens)
- **Cloud storage** settings (a target storage is effectively a persistent
  export pipeline)

We want users whose email ends in `@glidance.io` to retain full access, and
everyone else to not see these features.

## Goals

- Hide (not disable) the listed surfaces for non-Glidance users.
- Keep the gating logic in **one place** so it's easy to audit and easy to
  remove once backend RBAC catches up.
- Reuse the existing `ABILITY` permission system rather than introducing a
  parallel concept.
- Ship on a feature branch and verify on the test Label Studio deployment
  before any merge.

## Non-goals

- **Not a security boundary.** This is a UX guardrail. Anyone with an
  authenticated session and browser devtools can still hit the underlying API
  endpoints directly. Server-side enforcement is a documented follow-up
  (see "Backend follow-up" below).
- No changes to the backend in this spec.
- No changes to import, labeling UI download actions, or row-level task
  download. If those need to be gated later, they slot into the same list
  with no architectural change.

## Mixins — why we're not using them

The user asked whether this fits the "mixins concept" in the codebase.
Investigation: mixins in Label Studio are **MobX-State-Tree model composition**
used for data-state concerns (pagination, loading, selection) on store
models — primarily in `web/libs/datamanager/src/mixins/DataStore/`.

They are not a cross-cutting UI concern pattern. Most of the surfaces we need
to gate (Menubar, AccountSettings, ExportPage, Organization) are plain React
components with no MST store behind them. Using a mixin would only cover the
Data Manager case and force an inconsistent pattern everywhere else.

**Decision:** Do not use MST mixins for this. Use the existing `ABILITY`
permission system, which already flows through `useAuth().permissions.can(...)`
and is already consulted by every surface we care about (or trivially can be).

## Detection rule

A user is a Glidance user iff:

```ts
user?.email?.toLowerCase().endsWith("@glidance.io") === true
```

Notes:
- Email is the detection field (not username) because emails are tied to
  identity and not user-editable.
- Case-insensitive match.
- Exact suffix `@glidance.io` — `@sub.glidance.io` does not match, and
  `foo@glidance.io.attacker.com` does not match (the `@` anchor matters).
- Null user or null email returns `false`.

## Architecture

A small "restriction overlay" is wired into the existing `AuthProvider`
permission checker. For a defined set of abilities, non-Glidance users are
force-denied regardless of what the backend said.

```
useAuth().permissions.can(ability)
   │
   ▼
permissionsChecker(ability):
   1. Is `ability` in RESTRICTED_FOR_NON_GLIDANCE?
        yes → is user glidance?
                no  → return false   ← NEW overlay
                yes → fall through
        no  → fall through
   2. Return backendPermissions.includes(ability)  ← existing logic
```

Why this shape:

- **One place to change.** The restriction list and the email check live
  together in `account-restrictions.ts` and are wired once in `AuthProvider`.
- **No new concept.** Call sites use the existing
  `permissions.can(ABILITY.*)` pattern. The word "Glidance" never appears in
  a component file.
- **Future-proof.** When backend RBAC lands, we delete the overlay and the
  same call sites keep working — the checker simply falls through to
  backend-sourced permissions.
- **Grep-friendly.** A single constant `RESTRICTED_FOR_NON_GLIDANCE` tells a
  future reader exactly which abilities are currently gated by email domain.

## New module

**File:** `web/libs/core/src/lib/utils/account-restrictions.ts` (new)

Exports:

```ts
export function isGlidanceUser(user: APIUser | null | undefined): boolean;

export const RESTRICTED_FOR_NON_GLIDANCE: Ability[];
```

Pure functions, fully unit-testable, zero React dependencies.

## Abilities

Extend the existing `ABILITY` enum in
`web/libs/core/src/providers/AuthProvider.tsx`.

**New abilities:**

| Ability                      | String key           | Gates                                                |
|------------------------------|----------------------|------------------------------------------------------|
| `can_export_data`            | `projects.export`    | Data Manager export button, `/export` page           |
| `can_access_organization`    | `organization.view`  | Menubar "Organization" link, `/organization` page    |

**`RESTRICTED_FOR_NON_GLIDANCE` list:**

```ts
[
  ABILITY.can_create_tokens,      // existing — legacy + JWT token UI
  ABILITY.can_export_data,        // new
  ABILITY.can_access_organization,// new
  ABILITY.can_view_storage,       // existing — cloud storage read
  ABILITY.can_manage_storage,     // existing — cloud storage create/edit
  ABILITY.can_sync_storage,       // existing — cloud storage sync
]
```

The four existing abilities in the list are already checked by their call
sites. The overlay makes those checks return `false` for non-Glidance users
with no call-site changes needed.

## Call sites

### 1. `web/libs/core/src/providers/AuthProvider.tsx`

- Add `can_export_data` and `can_access_organization` to `ABILITY` enum.
- Import `isGlidanceUser` + `RESTRICTED_FOR_NON_GLIDANCE`.
- Extend the existing `permissionsChecker` so that for any ability in
  `RESTRICTED_FOR_NON_GLIDANCE`, a non-Glidance user gets `false` before the
  backend-permissions lookup runs.

### 2. `web/libs/core/src/lib/utils/account-restrictions.ts` (new)

- `isGlidanceUser` + `RESTRICTED_FOR_NON_GLIDANCE` as described above.
- Sibling test file `account-restrictions.test.ts`.

### 3. `web/apps/labelstudio/src/components/Menubar/Menubar.jsx` (~line 225)

- Wrap the Organization `<Menu.Item>` in a
  `permissions.can(ABILITY.can_access_organization)` check. The item is not
  rendered for non-Glidance users.

### 4. `web/apps/labelstudio/src/pages/Organization/index.jsx`

- Page-level guard: if `!permissions.can(can_access_organization)`, render
  nothing (or redirect to `/projects`). Defends against direct URL
  navigation.

### 5. `web/libs/datamanager/src/components/DataManager/Toolbar/instruments.jsx` (~lines 125–131)

The export button is already wrapped in `<Interface name="export">`. Two
implementation options, final choice to be made during implementation:

- **(a) Preferred:** Add a React-level `permissions.can(can_export_data)`
  check alongside the Interface check. Requires that Data Manager's toolbar
  code have access to `useAuth()` at that point.
- **(b) Alternative:** Flip `store.interfaces.get("export")` to `false`
  upstream so every consumer of that interface flag becomes consistent. More
  invasive, broader surface.

Lean (a). Decision finalized in the implementation plan.

### 6. `web/apps/labelstudio/src/pages/ExportPage/ExportPage.jsx`

- Page-level guard: same pattern as Organization. Covers direct `/export`
  URL navigation.

### 7. `web/libs/app-common/src/pages/AccountSettings/sections/index.tsx`

- **No code change.** Both the legacy-token section and the JWT-token
  section already consult `canCreateTokens` from `useAuth().permissions`.
  The `AuthProvider` overlay causes that to return `false` for non-Glidance
  users automatically, hiding both sections.

### 8. Cloud storage settings

- File paths to be located during implementation (source + target storages
  under project settings).
- Verification step in the implementation plan: confirm whether the current
  UI already calls `permissions.can(can_view_storage)` /
  `can_manage_storage`. If yes, nothing to do — the overlay gates them.
  If no, add the checks as part of this work.

### Routing note

Guarding `/export` and `/organization` at the page level means direct
navigation renders nothing. We are not trying to pretend the routes don't
exist at the router level — refusing to render is sufficient for the threat
model.

## Testing

### Unit tests

**`account-restrictions.test.ts`**

- `isGlidanceUser`:
  - `null` user → `false`
  - user with `null` email → `false`
  - `alice@glidance.io` → `true`
  - `Alice@GLIDANCE.IO` → `true` (case-insensitive)
  - `alice@sub.glidance.io` → `false` (strict suffix)
  - `evil@glidance.io.attacker.com` → `false`
  - `alice@glidanceio.com` → `false`
- `RESTRICTED_FOR_NON_GLIDANCE` sanity check that the expected abilities are
  present.

**AuthProvider test** (extend existing provider tests, or create one):

- Given a non-Glidance user,
  `permissions.can(ABILITY.can_export_data)` returns `false` even if
  backend permissions included it.
- Given a Glidance user, the same call returns whatever backend says.
- A non-restricted ability (e.g. `can_delete_projects`) is unaffected for
  both user types.

### Manual smoke test (on test Label Studio)

Run through twice — once as a `@glidance.io` account, once as a non-Glidance
account.

**As `@glidance.io`:**

- [ ] Menubar shows "Organization"
- [ ] `/organization` page loads
- [ ] Data Manager shows Export button; clicking opens the export dialog
- [ ] `/export` route loads
- [ ] Account & Settings shows access token section(s)
- [ ] Cloud storage settings accessible under a project

**As non-Glidance:**

- [ ] Menubar does NOT show "Organization"
- [ ] Navigating to `/organization` directly renders nothing / redirects
- [ ] Data Manager does NOT show the Export button
- [ ] Navigating to `/export` directly renders nothing / redirects
- [ ] Account & Settings shows no token sections (both legacy and JWT hidden)
- [ ] Cloud storage settings do not render

### Not tested

- **API-level enforcement.** A non-Glidance user with a valid session and
  devtools can still call the underlying REST endpoints. See "Backend
  follow-up."
- **E2E browser tests.** The existing e2e suite may exercise some of these
  flows with non-Glidance fixtures. The implementation plan includes a step
  to audit the e2e fixtures and update them if necessary so tests do not
  break.

## Branch & workflow

- Base branch: `glidance` (not `develop`) — this work layers on top of the
  in-progress Glidance UI changes already on `glidance`.
- Work branch: `glidance-account-restrictions`.
- Developed in an isolated git worktree so the current `glidance` checkout
  stays clean.
- PR target: merge back into `glidance`. The existing `glidance` → `develop`
  integration flow is unchanged.
- Deployment to test Label Studio: out of scope for this spec; handled by
  the user from the branch.

## Backend follow-up (out of scope, documented)

**Security posture statement:** These changes are UX guardrails and
defense-in-depth, **not a security boundary.** A technically capable
non-Glidance user with an authenticated session can still exfiltrate data
via direct API calls.

**Endpoints that would need server-side checks for real enforcement:**

- `POST /api/projects/:id/export` and related export-format endpoints
- `GET /api/current-user/token`, `POST /api/current-user/reset-token`
  (legacy token)
- `accessTokenList`, `accessTokenGetRefreshToken`, `accessTokenRevoke`
  (JWT tokens)
- Organization-scoped endpoints under `/api/organizations/...`
- Cloud storage CRUD endpoints under `/api/storages/...` and sync endpoints

**Recommended follow-up shape** (separate project):

- Add a Django permission class that resolves the same email-domain rule
  server-side, applied to the viewsets above.
- Better: once real backend roles exist, source
  `RESTRICTED_FOR_NON_GLIDANCE`'s outcomes from `user.permissions[]` and
  delete the client overlay. Call sites do not change.
