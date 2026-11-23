import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, hasSparrow, identityFrom } from "./auth";

const h = (o: Record<string, string>) => new Headers(o);
const ok = { "x-crow-proxy-secret": "s", "x-authentik-username": "bob", "x-authentik-groups": "crow-user|sparrow-user" };

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CROW_PROXY_SECRET;
  delete process.env.CROW_DEV_USER;
});

describe("identityFrom", () => {
  it("rejects a request without the proxy secret", () => {
    process.env.CROW_PROXY_SECRET = "s";
    expect(() => identityFrom(h({ ...ok, "x-crow-proxy-secret": "wrong" }))).toThrowError(expect.objectContaining({ status: 401 }));
  });

  it("reads username and groups", () => {
    process.env.CROW_PROXY_SECRET = "s";
    const id = identityFrom(h(ok));
    expect(id).toMatchObject({ username: "bob", admin: false });
    expect(hasSparrow(id)).toBe(true);
  });

  it("rejects unsafe usernames", () => {
    process.env.CROW_PROXY_SECRET = "s";
    for (const bad of ["../x", "A b"]) {
      expect(() => identityFrom(h({ ...ok, "x-authentik-username": bad }))).toThrowError(expect.objectContaining({ status: 403 }));
    }
  });

  it("rejects the reserved name assets with 403", () => {
    process.env.CROW_PROXY_SECRET = "s";
    expect(() => identityFrom(h({ ...ok, "x-authentik-username": "assets" }))).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("treats the example secret as misconfigured in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.CROW_PROXY_SECRET = "change-me";
    expect(() => identityFrom(h({ ...ok, "x-crow-proxy-secret": "change-me" }))).toThrowError(expect.objectContaining({ status: 401 }));
  });

  it("makes crow-admin an admin", () => {
    process.env.CROW_PROXY_SECRET = "s";
    expect(identityFrom(h({ ...ok, "x-authentik-groups": "crow-admin" })).admin).toBe(true);
  });

  it("fails closed in production when the secret is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => identityFrom(h(ok))).toThrowError(expect.objectContaining({ status: 401 }));
  });

  it("uses CROW_DEV_USER when no secret is configured", () => {
    process.env.CROW_DEV_USER = "dana";
    expect(identityFrom(h({}))).toMatchObject({ username: "dana", admin: true });
  });
});

it("AuthError carries a status", () => {
  expect(new AuthError(401, "x").status).toBe(401);
});
