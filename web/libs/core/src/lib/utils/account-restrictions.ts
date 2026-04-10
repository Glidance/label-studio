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
  "users.token.any",     // ABILITY.can_create_tokens
  "projects.export",     // ABILITY.can_export_data
  "projects.danger_zone",// ABILITY.can_access_danger_zone
  "organization.view",   // ABILITY.can_access_organization
  "storages.view",       // ABILITY.can_view_storage
  "storages.change",     // ABILITY.can_manage_storage
  "storages.sync",       // ABILITY.can_sync_storage
];
