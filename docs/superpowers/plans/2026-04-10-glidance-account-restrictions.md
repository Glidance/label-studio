# Glidance Account Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide export, organization, token, and cloud storage UI surfaces from non-`@glidance.io` users via a single overlay in the existing `AuthProvider` permission checker.

**Architecture:** Add a client-side restriction overlay inside `AuthProvider.makePermissionChecker`. A pure helper module (`account-restrictions.ts`) exports `isGlidanceUser(user)` and a `RESTRICTED_FOR_NON_GLIDANCE` ability list. When a non-Glidance user asks `permissions.can(ability)` for any restricted ability, the checker returns `false` before consulting the backend-sourced permission list. Two new abilities are added: `can_export_data` and `can_access_organization`. Four existing abilities (`can_create_tokens`, `can_view_storage`, `can_manage_storage`, `can_sync_storage`) are added to the restriction list without needing call-site changes at their existing consumers.

**Tech Stack:** React + TypeScript + Jotai + React Query; Jest + Testing Library for unit tests; Nx monorepo; Yarn package manager.

**Spec reference:** `docs/superpowers/specs/2026-04-10-glidance-account-restrictions-design.md`

---

## File map

**New files:**
- `web/libs/core/src/lib/utils/account-restrictions.ts` — pure helper module
- `web/libs/core/src/lib/utils/account-restrictions.test.ts` — unit tests for helper
- `web/libs/core/src/providers/AuthProvider.test.ts` — unit test for exported `makePermissionChecker`

**Modified files:**
- `web/libs/core/src/providers/AuthProvider.tsx` — add abilities + overlay
- `web/apps/labelstudio/src/components/Menubar/Menubar.jsx` — gate Organization menu item
- `web/apps/labelstudio/src/pages/Organization/index.jsx` — gate Organization page component
- `web/libs/datamanager/src/components/DataManager/Toolbar/instruments.jsx` — gate Data Manager export button
- `web/apps/labelstudio/src/pages/ExportPage/ExportPage.jsx` — gate project-level export modal
- `web/apps/labelstudio/src/pages/Settings/index.jsx` — gate StorageSettings sidebar entry
- `web/apps/labelstudio/src/pages/Settings/StorageSettings/StorageSettings.jsx` — gate StorageSettings page body

**Unchanged (overlay gates them automatically):**
- `web/libs/app-common/src/pages/AccountSettings/sections/index.tsx` — already checks `can_create_tokens`
- `web/libs/datamanager/src/components/MainView/DataView/empty-state/EmptyState.tsx` — already checks `can_manage_storage`

---

## Task 1: Create isolated worktree and feature branch

**Files:**
- No files modified; creates `.claude/worktrees/glidance-account-restrictions/` worktree

- [ ] **Step 1: Verify current branch is `glidance`**

Run: `git rev-parse --abbrev-ref HEAD`
Expected: `glidance`

- [ ] **Step 2: Verify working tree is clean**

Run: `git status --porcelain`
Expected: empty output (or only the spec doc if it wasn't committed)

- [ ] **Step 3: Create worktree branched from `glidance`**

Run:
```bash
git worktree add -b glidance-account-restrictions .claude/worktrees/glidance-account-restrictions glidance
```

Expected: `Preparing worktree ... HEAD is now at <sha>`

- [ ] **Step 4: Switch session CWD into the worktree**

All subsequent commands run from `.claude/worktrees/glidance-account-restrictions/`.

- [ ] **Step 5: Verify node_modules are available**

Nx monorepos typically share `node_modules` through the workspace root. From the worktree, run:
```bash
test -d web/node_modules && echo "deps present" || echo "need install"
```

If "need install", run: `cd web && yarn install --frozen-lockfile` (or `yarn install` if that fails).

---

## Task 2: Add new abilities to the ABILITY enum

**Files:**
- Modify: `web/libs/core/src/providers/AuthProvider.tsx` (lines 7–22)

- [ ] **Step 1: Edit the ABILITY enum**

Change lines 7–22 from:

```ts
export enum ABILITY {
  can_create_tokens = "users.token.any",

  // webhooks
  can_change_webhooks = "webhooks.change",

  // projects
  can_delete_projects = "projects.delete",
  can_reset_project_cache = "projects.reset_cache",
  can_reset_dm_views = "views.reset",

  // Cloud Storage
  can_view_storage = "storages.view",
  can_manage_storage = "storages.change",
  can_sync_storage = "storages.sync",
}
```

to:

```ts
export enum ABILITY {
  can_create_tokens = "users.token.any",

  // webhooks
  can_change_webhooks = "webhooks.change",

  // projects
  can_delete_projects = "projects.delete",
  can_reset_project_cache = "projects.reset_cache",
  can_reset_dm_views = "views.reset",
  can_export_data = "projects.export",

  // Cloud Storage
  can_view_storage = "storages.view",
  can_manage_storage = "storages.change",
  can_sync_storage = "storages.sync",

  // Organization
  can_access_organization = "organization.view",
}
```

- [ ] **Step 2: Verify TypeScript still compiles**

Run: `cd web && yarn nx run core:typecheck` (or `yarn tsc -p libs/core/tsconfig.lib.json --noEmit` if no `typecheck` target exists)
Expected: exits 0, no errors.

If the `typecheck` target doesn't exist, the project-level build is an acceptable substitute: `yarn nx run core:build` (should also exit 0).

- [ ] **Step 3: Commit**

```bash
git add web/libs/core/src/providers/AuthProvider.tsx
git commit -m "feat(core): add can_export_data and can_access_organization abilities"
```

---

## Task 3: Create `account-restrictions.ts` helper (TDD)

**Files:**
- Create: `web/libs/core/src/lib/utils/account-restrictions.ts`
- Create: `web/libs/core/src/lib/utils/account-restrictions.test.ts`

**Note on circular imports:** `account-restrictions.ts` does NOT import from `AuthProvider.tsx`. It uses bare string literals matching the `ABILITY` enum values. This is deliberate: `AuthProvider.tsx` will import from `account-restrictions.ts` in Task 4, and having `account-restrictions.ts` also import from `AuthProvider.tsx` would create a top-level circular import (the `RESTRICTED_FOR_NON_GLIDANCE` const is initialized at module-load time, so the cycle would crash). Consistency with the `ABILITY` enum is enforced by a test in `account-restrictions.test.ts` that imports `ABILITY` directly — the test file has no such circular-init problem because it only runs after both modules are loaded.

- [ ] **Step 1: Write the failing test file**

Create `web/libs/core/src/lib/utils/account-restrictions.test.ts` with exactly this content:

```ts
import type { APIUser } from "../../types/user";
import { ABILITY } from "../../providers/AuthProvider";
import {
  isGlidanceEmail,
  isGlidanceUser,
  RESTRICTED_FOR_NON_GLIDANCE,
} from "./account-restrictions";

const makeUser = (overrides: Partial<APIUser> = {}): APIUser =>
  ({
    id: 1,
    email: "someone@example.com",
    first_name: "Some",
    last_name: "One",
    username: "someone",
    avatar: null,
    active_organization: 1,
    active_organization_meta: { title: "Org", email: "someone@example.com" },
    ...overrides,
  }) as APIUser;

describe("isGlidanceEmail", () => {
  it("returns true for an exact @glidance.io suffix", () => {
    expect(isGlidanceEmail("alice@glidance.io")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isGlidanceEmail("Alice@GLIDANCE.IO")).toBe(true);
    expect(isGlidanceEmail("ALICE@Glidance.Io")).toBe(true);
  });

  it("rejects subdomains of glidance.io", () => {
    expect(isGlidanceEmail("alice@sub.glidance.io")).toBe(false);
  });

  it("rejects attacker-crafted lookalike domains", () => {
    expect(isGlidanceEmail("evil@glidance.io.attacker.com")).toBe(false);
    expect(isGlidanceEmail("alice@glidanceio.com")).toBe(false);
    expect(isGlidanceEmail("alice@notglidance.io")).toBe(false);
  });

  it("rejects null, undefined, and empty email", () => {
    expect(isGlidanceEmail(null)).toBe(false);
    expect(isGlidanceEmail(undefined)).toBe(false);
    expect(isGlidanceEmail("")).toBe(false);
  });
});

describe("isGlidanceUser", () => {
  it("returns false for a null user", () => {
    expect(isGlidanceUser(null)).toBe(false);
  });

  it("returns false for a user with no email", () => {
    expect(isGlidanceUser(makeUser({ email: undefined as unknown as string }))).toBe(false);
  });

  it("returns true for a user with a @glidance.io email", () => {
    expect(isGlidanceUser(makeUser({ email: "alice@glidance.io" }))).toBe(true);
  });

  it("returns false for a user with a non-glidance email", () => {
    expect(isGlidanceUser(makeUser({ email: "alice@example.com" }))).toBe(false);
  });
});

describe("RESTRICTED_FOR_NON_GLIDANCE", () => {
  it("contains the expected ABILITY values as strings", () => {
    expect(new Set(RESTRICTED_FOR_NON_GLIDANCE)).toEqual(
      new Set<string>([
        ABILITY.can_create_tokens,
        ABILITY.can_export_data,
        ABILITY.can_access_organization,
        ABILITY.can_view_storage,
        ABILITY.can_manage_storage,
        ABILITY.can_sync_storage,
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd web && yarn nx run core:unit --testFile=libs/core/src/lib/utils/account-restrictions.test.ts`

Expected: FAIL with "Cannot find module './account-restrictions'" or similar.

- [ ] **Step 3: Write the minimal implementation**

Create `web/libs/core/src/lib/utils/account-restrictions.ts` with exactly this content:

```ts
import type { APIUser } from "../../types/user";

const GLIDANCE_DOMAIN = "@glidance.io";

/**
 * Pure helper: does this string look like a @glidance.io email?
 * Case-insensitive exact-suffix match; rejects subdomains and lookalikes.
 */
export const isGlidanceEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return email.toLowerCase().endsWith(GLIDANCE_DOMAIN);
};

/** Convenience: is the given user a @glidance.io user? */
export const isGlidanceUser = (user: APIUser | null | undefined): boolean =>
  isGlidanceEmail(user?.email ?? null);

/**
 * Abilities that non-@glidance.io users are force-denied in the UI.
 *
 * Kept as bare string literals (NOT as `ABILITY.*` references) to avoid a
 * top-level circular import with `AuthProvider.tsx`, which depends on this
 * module. Consistency with the `ABILITY` enum is enforced by a unit test
 * in `account-restrictions.test.ts`.
 *
 * This is a client-side UX guardrail only; it is not a security boundary.
 * Backend enforcement of these same abilities is a separate follow-up —
 * see docs/superpowers/specs/2026-04-10-glidance-account-restrictions-design.md
 * section "Backend follow-up" for the endpoint list.
 *
 * When backend RBAC is in place, delete the overlay in AuthProvider and the
 * same call sites will keep working (they source permissions from the
 * backend-provided list instead).
 */
export const RESTRICTED_FOR_NON_GLIDANCE: readonly string[] = [
  "users.token.any",    // ABILITY.can_create_tokens
  "projects.export",    // ABILITY.can_export_data
  "organization.view",  // ABILITY.can_access_organization
  "storages.view",      // ABILITY.can_view_storage
  "storages.change",    // ABILITY.can_manage_storage
  "storages.sync",      // ABILITY.can_sync_storage
];
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd web && yarn nx run core:unit --testFile=libs/core/src/lib/utils/account-restrictions.test.ts`

Expected: all tests PASS (13 test cases across 3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add web/libs/core/src/lib/utils/account-restrictions.ts web/libs/core/src/lib/utils/account-restrictions.test.ts
git commit -m "feat(core): add account-restrictions helper and restriction list"
```

---

## Task 4: Wire the restriction overlay into AuthProvider (TDD)

**Files:**
- Modify: `web/libs/core/src/providers/AuthProvider.tsx` (lines 42–55, 79–80)
- Create: `web/libs/core/src/providers/AuthProvider.test.ts`

**Strategy:** We test the overlay by exporting `makePermissionChecker` and unit-testing it directly as a pure function. This avoids all the Jotai + React Query + hydration ceremony that an integration test would need. `makePermissionChecker` is an internal helper; exporting it is acceptable and the alternative (a full React hook test) adds a lot of harness code to verify a handful of lines of logic.

- [ ] **Step 1: Write the failing unit test**

Create `web/libs/core/src/providers/AuthProvider.test.ts` with exactly this content:

```ts
import { ABILITY, makePermissionChecker } from "./AuthProvider";
import type { APIUser } from "../types/user";

const makeUser = (email: string): APIUser =>
  ({
    id: 1,
    email,
    first_name: "Test",
    last_name: "User",
    username: "testuser",
    avatar: null,
    active_organization: 1,
    active_organization_meta: { title: "Org", email },
  }) as unknown as APIUser;

const ALL_PERMS = [
  ABILITY.can_create_tokens,
  ABILITY.can_export_data,
  ABILITY.can_access_organization,
  ABILITY.can_view_storage,
  ABILITY.can_manage_storage,
  ABILITY.can_sync_storage,
  ABILITY.can_delete_projects,
] as string[];

describe("makePermissionChecker restriction overlay", () => {
  it("grants all backend-granted abilities to a @glidance.io user", () => {
    const checker = makePermissionChecker(ALL_PERMS, makeUser("alice@glidance.io"));
    expect(checker.can(ABILITY.can_export_data)).toBe(true);
    expect(checker.can(ABILITY.can_access_organization)).toBe(true);
    expect(checker.can(ABILITY.can_create_tokens)).toBe(true);
    expect(checker.can(ABILITY.can_view_storage)).toBe(true);
    expect(checker.can(ABILITY.can_manage_storage)).toBe(true);
    expect(checker.can(ABILITY.can_sync_storage)).toBe(true);
    expect(checker.can(ABILITY.can_delete_projects)).toBe(true);
  });

  it("force-denies restricted abilities for a non-glidance user even if backend granted them", () => {
    const checker = makePermissionChecker(ALL_PERMS, makeUser("bob@example.com"));
    expect(checker.can(ABILITY.can_export_data)).toBe(false);
    expect(checker.can(ABILITY.can_access_organization)).toBe(false);
    expect(checker.can(ABILITY.can_create_tokens)).toBe(false);
    expect(checker.can(ABILITY.can_view_storage)).toBe(false);
    expect(checker.can(ABILITY.can_manage_storage)).toBe(false);
    expect(checker.can(ABILITY.can_sync_storage)).toBe(false);
  });

  it("leaves non-restricted abilities unaffected for a non-glidance user", () => {
    const checker = makePermissionChecker(ALL_PERMS, makeUser("bob@example.com"));
    expect(checker.can(ABILITY.can_delete_projects)).toBe(true);
  });

  it("force-denies restricted abilities for a null user", () => {
    const checker = makePermissionChecker(ALL_PERMS, null);
    expect(checker.can(ABILITY.can_export_data)).toBe(false);
    expect(checker.can(ABILITY.can_delete_projects)).toBe(true); // not restricted
  });

  it("respects backend deny-with-minus prefix for non-restricted abilities", () => {
    // Pre-existing behavior: `-ability` means backend explicitly denied it.
    const checker = makePermissionChecker(
      [ABILITY.can_delete_projects, `-${ABILITY.can_delete_projects}`],
      makeUser("alice@glidance.io"),
    );
    expect(checker.can(ABILITY.can_delete_projects)).toBe(false);
  });

  it("respects the wildcard '*' for glidance users on non-restricted abilities", () => {
    const checker = makePermissionChecker(["*"], makeUser("alice@glidance.io"));
    expect(checker.can(ABILITY.can_delete_projects)).toBe(true);
  });

  it("canAny and canAll correctly incorporate the overlay", () => {
    const checker = makePermissionChecker(ALL_PERMS, makeUser("bob@example.com"));
    expect(checker.canAny([ABILITY.can_export_data, ABILITY.can_delete_projects])).toBe(true);
    expect(checker.canAll([ABILITY.can_export_data, ABILITY.can_delete_projects])).toBe(false);
    expect(checker.canAny([ABILITY.can_export_data, ABILITY.can_create_tokens])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd web && yarn nx run core:unit --testFile=libs/core/src/providers/AuthProvider.test.ts`

Expected: FAIL with `makePermissionChecker is not exported` OR `makePermissionChecker is not a function` OR the `@glidance.io` gating assertions fail because the overlay doesn't exist yet. Any of those is a valid "red" state before Step 3.

- [ ] **Step 3: Modify `AuthProvider.tsx` to add the overlay**

Open `web/libs/core/src/providers/AuthProvider.tsx`.

Add a new import after the existing `import type { APIUser } from "../types/user";` (line 2):

```ts
import { isGlidanceUser, RESTRICTED_FOR_NON_GLIDANCE } from "../lib/utils/account-restrictions";
```

Replace lines 42–55 (the current `makePermissionChecker` definition — note it is currently `const`, not `export const`):

```ts
const makePermissionChecker = (list?: (Ability | string)[]) => {
  const abilities = new Set<string>((list as string[]) ?? []);
  const has = (a: string) => {
    if (abilities.size === 0) return false;
    if (abilities.has(`-${a}`)) return false;
    if (abilities.has("*")) return true;
    return abilities.has(a);
  };
  return {
    can: (a: string) => has(a),
    canAny: (arr: string[]) => arr.some((a) => !abilities.has(`-${a}`) && (abilities.has("*") || abilities.has(a))),
    canAll: (arr: string[]) => arr.every((a) => !abilities.has(`-${a}`) && (abilities.has("*") || abilities.has(a))),
  };
};
```

with (note the `export` keyword and the new second parameter `user`):

```ts
/**
 * Exported for unit testing. Builds a permission checker that combines:
 * 1. A backend-provided ability list (with support for "*" wildcard and
 *    "-ability" explicit deny).
 * 2. A client-side overlay: non-@glidance.io users are force-denied any
 *    ability in RESTRICTED_FOR_NON_GLIDANCE regardless of what the backend
 *    granted. See web/libs/core/src/lib/utils/account-restrictions.ts and
 *    docs/superpowers/specs/2026-04-10-glidance-account-restrictions-design.md.
 */
export const makePermissionChecker = (
  list: (Ability | string)[] | undefined,
  user: APIUser | null,
) => {
  const abilities = new Set<string>((list as string[]) ?? []);
  const restrictedSet = new Set<string>(RESTRICTED_FOR_NON_GLIDANCE);
  const glidance = isGlidanceUser(user);

  const has = (a: string) => {
    // Client-side overlay: non-glidance users are denied restricted abilities
    // before we even consult the backend list.
    if (!glidance && restrictedSet.has(a)) return false;
    if (abilities.size === 0) return false;
    if (abilities.has(`-${a}`)) return false;
    if (abilities.has("*")) return true;
    return abilities.has(a);
  };

  return {
    can: (a: string) => has(a),
    canAny: (arr: string[]) => arr.some((a) => has(a)),
    canAll: (arr: string[]) => arr.every((a) => has(a)),
  };
};
```

Note: `canAny`/`canAll` are simplified to delegate to `has` so the overlay applies uniformly. This is equivalent to the original logic for non-restricted abilities and correctly denies restricted ones for non-glidance users.

Replace line 80 (the `useMemo` that builds the checker):

```ts
const checker = useMemo(() => makePermissionChecker(userQuery.data?.permissions), [userQuery.data?.permissions]);
```

with:

```ts
const checker = useMemo(
  () => makePermissionChecker(userQuery.data?.permissions, userQuery.data ?? null),
  [userQuery.data],
);
```

- [ ] **Step 4: Run the overlay tests to confirm they pass**

Run: `cd web && yarn nx run core:unit --testFile=libs/core/src/providers/AuthProvider.test.ts`

Expected: all 7 tests PASS.

- [ ] **Step 5: Run the entire core lib test suite to catch regressions**

Run: `cd web && yarn nx run core:unit`
Expected: all tests PASS. Note any pre-existing failures unrelated to these changes in the commit message.

- [ ] **Step 6: Commit**

```bash
git add web/libs/core/src/providers/AuthProvider.tsx web/libs/core/src/providers/AuthProvider.test.ts
git commit -m "feat(core): add non-glidance restriction overlay to AuthProvider"
```

---

## Task 5: Gate the Menubar "Organization" link

**Files:**
- Modify: `web/apps/labelstudio/src/components/Menubar/Menubar.jsx` (lines 20, 60, 225)

- [ ] **Step 1: Update imports (~line 20)**

Current:
```jsx
import { useAuth } from "@humansignal/core/providers/AuthProvider";
```

Change to:
```jsx
import { useAuth } from "@humansignal/core/providers/AuthProvider";
import { ABILITY } from "@humansignal/core/providers/AuthProvider";
```

(If the editor supports merging, a single `import { useAuth, ABILITY } from "@humansignal/core/providers/AuthProvider";` is fine.)

- [ ] **Step 2: Pull `permissions` out of the auth hook (~line 60)**

Current:
```jsx
const { user, isLoading } = useAuth();
```

Change to:
```jsx
const { user, isLoading, permissions } = useAuth();
```

- [ ] **Step 3: Gate the Organization menu item (~line 225)**

Current:
```jsx
<Menu.Item label="Organization" to="/organization" icon={<IconPeople />} data-external exact />
```

Change to:
```jsx
{permissions.can(ABILITY.can_access_organization) && (
  <Menu.Item label="Organization" to="/organization" icon={<IconPeople />} data-external exact />
)}
```

- [ ] **Step 4: Verify the file still compiles**

Run: `cd web && yarn nx run labelstudio:build --configuration=development` (or `yarn nx run labelstudio:lint` if build is slow).
Expected: exits 0.

If the project has no `build` target for the labelstudio app, fall back to `yarn tsc -p web/apps/labelstudio/tsconfig.app.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add web/apps/labelstudio/src/components/Menubar/Menubar.jsx
git commit -m "feat(menubar): hide Organization link for non-glidance users"
```

---

## Task 6: Gate the Organization page component

**Files:**
- Modify: `web/apps/labelstudio/src/pages/Organization/index.jsx`

- [ ] **Step 1: Add a page-level guard**

Replace the entire file content with:

```jsx
import { Redirect } from "react-router-dom";
import { ABILITY, useAuth } from "@humansignal/core/providers/AuthProvider";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { PeoplePage } from "./PeoplePage/PeoplePage";
import { WebhookPage } from "../WebhookPage/WebhookPage";

const ALLOW_ORGANIZATION_WEBHOOKS = window.APP_SETTINGS.flags?.allow_organization_webhooks;

const MenuLayout = ({ children, ...routeProps }) => {
  const menuItems = [PeoplePage];

  if (ALLOW_ORGANIZATION_WEBHOOKS) {
    menuItems.push(WebhookPage);
  }
  return <SidebarMenu menuItems={menuItems} path={routeProps.match.url} children={children} />;
};

const organizationPages = {};

if (ALLOW_ORGANIZATION_WEBHOOKS) {
  organizationPages[WebhookPage] = WebhookPage;
}

// Page-level guard: non-glidance users who navigate directly to /organization
// are bounced back to /projects. This is a UX guardrail, not a security
// boundary — see the spec's "Backend follow-up" section.
const GatedPeoplePage = (props) => {
  const { permissions, isLoading } = useAuth();
  if (isLoading) return null;
  if (!permissions.can(ABILITY.can_access_organization)) {
    return <Redirect to="/projects" />;
  }
  return <PeoplePage {...props} />;
};

export const OrganizationPage = {
  title: "Organization",
  path: "/organization",
  exact: true,
  layout: MenuLayout,
  component: GatedPeoplePage,
  pages: organizationPages,
};
```

- [ ] **Step 2: Verify compile**

Run: `cd web && yarn nx run labelstudio:build --configuration=development` (or the lint/tsc fallback from Task 5 Step 4).
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/apps/labelstudio/src/pages/Organization/index.jsx
git commit -m "feat(organization): redirect non-glidance users away from /organization"
```

---

## Task 7: Gate the Data Manager export button

**Files:**
- Modify: `web/libs/datamanager/src/components/DataManager/Toolbar/instruments.jsx` (lines 1–18, 125–131)

**Context:** The Data Manager is mounted inside the `labelstudio` app, which wraps its tree in `AuthProvider`. The `useAuth()` hook is therefore available inside Data Manager render functions. The entries in the `instruments` map are effectively React components (they return JSX and are rendered by a parent), so hooks work inside them — but to keep things explicit and testable we extract a named component `ExportButtonWithGate`.

- [ ] **Step 1: Add the new import (top of file, with the other imports)**

Add after the existing `import { Interface } from "../../Common/Interface";` (line 8):

```jsx
import { ABILITY, useAuth } from "@humansignal/core/providers/AuthProvider";
```

- [ ] **Step 2: Add a named gated component above the `instruments` object**

Insert above `export const instruments = {` (currently line 69):

```jsx
/**
 * Wraps the Data Manager export button with a permission check.
 * Non-glidance users do not see the button at all.
 */
const ExportButtonWithGate = ({ size }) => {
  const { permissions } = useAuth();
  if (!permissions.can(ABILITY.can_export_data)) return null;
  return <ExportButton size={size}>Export</ExportButton>;
};
```

- [ ] **Step 3: Update the `export-button` instrument entry**

Replace lines 125–131:

```jsx
  "export-button": ({ size }) => {
    return (
      <Interface name="export">
        <ExportButton size={size}>Export</ExportButton>
      </Interface>
    );
  },
```

with:

```jsx
  "export-button": ({ size }) => {
    return (
      <Interface name="export">
        <ExportButtonWithGate size={size} />
      </Interface>
    );
  },
```

The outer `<Interface name="export">` wrapper is retained to preserve existing SDK-consumer behavior for embedders that set the `export` interface flag.

- [ ] **Step 4: Verify compile**

Run: `cd web && yarn nx run datamanager:build --configuration=development` (or the datamanager lib's equivalent target).
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/libs/datamanager/src/components/DataManager/Toolbar/instruments.jsx
git commit -m "feat(datamanager): hide export button for non-glidance users"
```

---

## Task 8: Gate the project-level ExportPage modal

**Files:**
- Modify: `web/apps/labelstudio/src/pages/ExportPage/ExportPage.jsx` (imports + top of `ExportPage` function)

- [ ] **Step 1: Add the new imports (top of file)**

Add after the existing import of `useHistory` (line 2):

```jsx
import { ABILITY, useAuth } from "@humansignal/core/providers/AuthProvider";
```

- [ ] **Step 2: Add a guard at the very start of the `ExportPage` component body**

Inside `export const ExportPage = () => {` (currently line 46), insert these lines as the very first statements of the function body, before `const history = useHistory();`:

```jsx
  const { permissions, isLoading: authLoading } = useAuth();
  const historyForRedirect = useHistory();

  if (authLoading) return null;
  if (!permissions.can(ABILITY.can_export_data)) {
    historyForRedirect.replace("/projects");
    return null;
  }
```

Note: we use a second `useHistory()` call (`historyForRedirect`) only if the guard needs to run *before* the existing `const history = useHistory();` declaration. If the original `const history = useHistory();` appears right below, you can skip the `historyForRedirect` variable and simply reference `history` after moving the guard *below* the history declaration. Choose whichever produces fewer lines changed.

**Cleaner alternative (preferred):** Leave the imports and existing `const history = useHistory();` where they are, and insert the guard **right after** the existing `const history = useHistory();`. Example — the first few lines of the `ExportPage` body become:

```jsx
export const ExportPage = () => {
  const history = useHistory();
  const location = useFixedLocation();
  const pageParams = useParams();
  const api = useAPI();
  const { permissions, isLoading: authLoading } = useAuth();

  if (authLoading) return null;
  if (!permissions.can(ABILITY.can_export_data)) {
    history.replace("/projects");
    return null;
  }

  const [previousExports, setPreviousExports] = useState([]);
  // ... rest unchanged
```

**IMPORTANT:** Do NOT place the guard after any `useState`, `useRef`, `useEffect`, or other hook calls — an early return before all hooks execute violates React's Rules of Hooks. The preferred placement above works because only `useHistory`, `useFixedLocation`, `useParams`, `useAPI`, and the new `useAuth` have been called at that point, and they are called unconditionally on every render. The early `return null` is safe because no later hooks have run yet. Verify by re-reading the function top to bottom and confirming the guard is before the first `useState`.

- [ ] **Step 3: Verify compile**

Run: `cd web && yarn nx run labelstudio:build --configuration=development`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add web/apps/labelstudio/src/pages/ExportPage/ExportPage.jsx
git commit -m "feat(export): redirect non-glidance users away from /export modal"
```

---

## Task 9: Gate the project Cloud Storage settings page

**Files:**
- Modify: `web/apps/labelstudio/src/pages/Settings/index.jsx` (sidebar menu list)
- Modify: `web/apps/labelstudio/src/pages/Settings/StorageSettings/StorageSettings.jsx` (page body guard)

**Context:** `StorageSettings` is listed unconditionally in the project-settings sidebar at `web/apps/labelstudio/src/pages/Settings/index.jsx`. We need to both hide it from the sidebar AND guard its route handler, because hiding the sidebar alone doesn't prevent direct URL navigation to `/projects/:id/settings/storage`. The existing `EmptyState.tsx:300` already checks `can_manage_storage` for the "Add storage" button inside the empty-state variant, but that covers only one button — not the page itself.

- [ ] **Step 1: Filter StorageSettings out of the settings sidebar for non-glidance users**

Edit `web/apps/labelstudio/src/pages/Settings/index.jsx`.

Current content:

```jsx
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { WebhookPage } from "../WebhookPage/WebhookPage";
import { DangerZone } from "./DangerZone";
import { GeneralSettings } from "./GeneralSettings";
import { AnnotationSettings } from "./AnnotationSettings";
import { LabelingSettings } from "./LabelingSettings";
import { MachineLearningSettings } from "./MachineLearningSettings/MachineLearningSettings";
import { PredictionsSettings } from "./PredictionsSettings/PredictionsSettings";
import { StorageSettings } from "./StorageSettings/StorageSettings";
import "./settings.scss";

export const MenuLayout = ({ children, ...routeProps }) => {
  return (
    <SidebarMenu
      menuItems={[
        GeneralSettings,
        LabelingSettings,
        AnnotationSettings,
        MachineLearningSettings,
        PredictionsSettings,
        StorageSettings,
        WebhookPage,
        DangerZone,
      ].filter(Boolean)}
      path={routeProps.match.url}
      children={children}
    />
  );
};
```

Replace with:

```jsx
import { ABILITY, useAuth } from "@humansignal/core/providers/AuthProvider";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { WebhookPage } from "../WebhookPage/WebhookPage";
import { DangerZone } from "./DangerZone";
import { GeneralSettings } from "./GeneralSettings";
import { AnnotationSettings } from "./AnnotationSettings";
import { LabelingSettings } from "./LabelingSettings";
import { MachineLearningSettings } from "./MachineLearningSettings/MachineLearningSettings";
import { PredictionsSettings } from "./PredictionsSettings/PredictionsSettings";
import { StorageSettings } from "./StorageSettings/StorageSettings";
import "./settings.scss";

export const MenuLayout = ({ children, ...routeProps }) => {
  const { permissions } = useAuth();
  const canViewStorage = permissions.can(ABILITY.can_view_storage);

  return (
    <SidebarMenu
      menuItems={[
        GeneralSettings,
        LabelingSettings,
        AnnotationSettings,
        MachineLearningSettings,
        PredictionsSettings,
        canViewStorage && StorageSettings,
        WebhookPage,
        DangerZone,
      ].filter(Boolean)}
      path={routeProps.match.url}
      children={children}
    />
  );
};
```

The rest of the file (the `pages` object and `SettingsPage` export) is left unchanged.

- [ ] **Step 2: Guard the StorageSettings page body**

Edit `web/apps/labelstudio/src/pages/Settings/StorageSettings/StorageSettings.jsx`.

Add import near the top (after the existing `@humansignal/ui` import block):

```jsx
import { ABILITY, useAuth } from "@humansignal/core/providers/AuthProvider";
import { Redirect } from "react-router-dom";
```

Then modify the top of the `StorageSettings` component. The current top looks like:

```jsx
export const StorageSettings = () => {
  const { project } = useProject();
  const rootClass = cn("storage-settings"); // TODO: Remove in the next BEM cleanup
  const history = useHistory();
  const location = useLocation();
  const sourceStorageRef = useRef();
  const targetStorageRef = useRef();

  useUpdatePageTitle(createTitleFromSegments([project?.title, "Cloud Storage Settings"]));
```

Replace with:

```jsx
export const StorageSettings = () => {
  const { project } = useProject();
  const rootClass = cn("storage-settings"); // TODO: Remove in the next BEM cleanup
  const history = useHistory();
  const location = useLocation();
  const sourceStorageRef = useRef();
  const targetStorageRef = useRef();
  const { permissions, isLoading: authLoading } = useAuth();

  useUpdatePageTitle(createTitleFromSegments([project?.title, "Cloud Storage Settings"]));

  // Guard: non-glidance users cannot view storage settings. Redirect them to the
  // general settings page for this project. This check runs after all hooks to
  // preserve the Rules of Hooks.
  if (authLoading) return null;
  if (!permissions.can(ABILITY.can_view_storage)) {
    return <Redirect to={`/projects/${project?.id}/settings`} />;
  }
```

**IMPORTANT:** Do NOT move the guard above the `useRef`/`useEffect`/`useUpdatePageTitle`/`useStorageCard` calls below it. The guard must come after all hooks have been called on this render. Scroll down in the file and confirm there are no additional hooks called *after* the return statement of the guard — if there are, move the guard *below* them.

- [ ] **Step 3: Verify compile**

Run: `cd web && yarn nx run labelstudio:build --configuration=development`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add web/apps/labelstudio/src/pages/Settings/index.jsx web/apps/labelstudio/src/pages/Settings/StorageSettings/StorageSettings.jsx
git commit -m "feat(settings): hide cloud storage settings from non-glidance users"
```

---

## Task 10: Full regression test run and final smoke-test checklist

**Files:** none modified

- [ ] **Step 1: Run the full core lib unit tests**

Run: `cd web && yarn nx run core:unit`
Expected: all PASS. Record any pre-existing unrelated failures.

- [ ] **Step 2: Run labelstudio app lint (if a target exists)**

Run: `cd web && yarn nx run labelstudio:lint`
Expected: exits 0. If the target does not exist, skip.

- [ ] **Step 3: Run the labelstudio app unit tests (if any)**

Run: `cd web && yarn nx run labelstudio:unit`
Expected: exits 0 or "no tests found". Record unrelated failures.

- [ ] **Step 4: Manual smoke test — preflight**

The implementing agent stops here. The human user deploys this branch to the test Label Studio instance and runs the smoke-test checklist below. The agent should print the checklist and wait.

**As a `@glidance.io` account:**

- [ ] Left sidebar shows "Organization"
- [ ] `/organization` loads the people page
- [ ] Data Manager toolbar shows the "Export" button
- [ ] "Export" button opens the export dialog
- [ ] Navigating to `/projects/:id/export` opens the modal
- [ ] Account & Settings page shows at least one token section (legacy and/or JWT)
- [ ] Project → Settings → "Cloud Storage" tab is visible in the sidebar
- [ ] Project → Settings → Cloud Storage page renders

**As a non-`@glidance.io` account:**

- [ ] Left sidebar does NOT show "Organization"
- [ ] Navigating directly to `/organization` redirects to `/projects`
- [ ] Data Manager toolbar does NOT show the "Export" button
- [ ] Navigating directly to `/projects/:id/export` redirects to `/projects`
- [ ] Account & Settings page shows no token sections
- [ ] Project → Settings → "Cloud Storage" tab is NOT in the sidebar
- [ ] Navigating directly to `/projects/:id/settings/storage` redirects to `/projects/:id/settings`

- [ ] **Step 5: (After smoke test passes) Push the branch**

Run:
```bash
git push -u origin glidance-account-restrictions
```

- [ ] **Step 6: Open a PR against `glidance`**

Run:
```bash
gh pr create --base glidance --title "feat: hide export/org/tokens/storage from non-glidance users" --body "$(cat <<'EOF'
## Summary
- Adds an `AuthProvider` overlay that force-denies a defined list of abilities for users whose email does not end in `@glidance.io`.
- Gates: Data Manager export button, `/export` modal, Menubar Organization link, `/organization` page, project Cloud Storage settings sidebar + page. Token sections in Account & Settings are covered automatically via the existing `can_create_tokens` check.
- Adds two new abilities (`can_export_data`, `can_access_organization`) and reuses four existing storage/token abilities in the restriction list.

## Security posture
This is a UX guardrail and defense-in-depth, **not a security boundary**. See `docs/superpowers/specs/2026-04-10-glidance-account-restrictions-design.md` § "Backend follow-up" for the endpoints that would need server-side enforcement.

## Test plan
- [x] Unit tests for `account-restrictions` helper
- [x] Unit tests for the `AuthProvider` restriction overlay
- [ ] Manual smoke test on test Label Studio deployment — see `docs/superpowers/plans/2026-04-10-glidance-account-restrictions.md` § Task 10
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**
- Architecture (spec §Architecture) → Tasks 3, 4
- Detection rule (spec §Detection rule) → Task 3 Step 3
- New module (spec §New module) → Task 3
- Abilities (spec §Abilities) → Tasks 2, 3
- Call site 1 (AuthProvider) → Task 4
- Call site 2 (account-restrictions module) → Task 3
- Call site 3 (Menubar) → Task 5
- Call site 4 (Organization page) → Task 6
- Call site 5 (DataManager export button) → Task 7
- Call site 6 (ExportPage) → Task 8
- Call site 7 (AccountSettings) → no task, verified no change needed
- Call site 8 (Cloud Storage) → Task 9
- Testing (unit + smoke) → Tasks 3, 4, 10
- Branch & workflow (spec §Branch & workflow) → Tasks 1, 10

**Naming consistency check:**
- `isGlidanceUser` / `isGlidanceEmail` / `RESTRICTED_FOR_NON_GLIDANCE` — used consistently in Tasks 3, 4.
- `ABILITY.can_export_data` / `ABILITY.can_access_organization` — used consistently in Tasks 2, 4, 5, 6, 7, 8.
- `ABILITY.can_view_storage` — used in Task 9 (both sidebar filter and page guard). `can_manage_storage` is left alone at `EmptyState.tsx:300`, which the overlay already covers.

**Rules of Hooks:**
- Tasks 8 and 9 both include explicit warnings to place the guard *after* all hooks have been called. This is consistent with the recent fix in commit `05e2964d6` ("move hooks above early returns in Controls").

**Not in scope:**
- Backend endpoint enforcement (documented as follow-up in the spec)
- Import button gating
- Row-level task download / labeling UI download actions
- E2E browser test updates (the implementing agent may find these need updating during Task 10 Step 2/3 if they break; follow-up separately)
