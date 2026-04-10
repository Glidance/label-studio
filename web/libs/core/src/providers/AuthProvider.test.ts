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

  it("overlay beats wildcard '*' for a non-glidance user", () => {
    const checker = makePermissionChecker(["*"], makeUser("bob@example.com"));
    // Restricted abilities: overlay denies them even though backend gave "*".
    expect(checker.can(ABILITY.can_export_data)).toBe(false);
    expect(checker.can(ABILITY.can_access_organization)).toBe(false);
    expect(checker.can(ABILITY.can_create_tokens)).toBe(false);
    // Non-restricted ability: wildcard still grants it.
    expect(checker.can(ABILITY.can_delete_projects)).toBe(true);
  });

  it("canAny and canAll correctly incorporate the overlay", () => {
    const checker = makePermissionChecker(ALL_PERMS, makeUser("bob@example.com"));
    expect(checker.canAny([ABILITY.can_export_data, ABILITY.can_delete_projects])).toBe(true);
    expect(checker.canAll([ABILITY.can_export_data, ABILITY.can_delete_projects])).toBe(false);
    expect(checker.canAny([ABILITY.can_export_data, ABILITY.can_create_tokens])).toBe(false);
  });
});
