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
        ABILITY.can_access_danger_zone,
        ABILITY.can_access_organization,
        ABILITY.can_view_storage,
        ABILITY.can_manage_storage,
        ABILITY.can_sync_storage,
      ]),
    );
  });
});
