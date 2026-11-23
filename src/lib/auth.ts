import { headers } from "next/headers";

export type Identity = { username: string; admin: boolean; groups: string[] };

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

const USERNAME = /^[a-z0-9-]+$/;

/** Reads the user Authentik put in the headers. Without CROW_PROXY_SECRET (dev only) it uses CROW_DEV_USER. */
export function identityFrom(h: Headers): Identity {
  const secret = process.env.CROW_PROXY_SECRET;
  if (!secret) return { username: process.env.CROW_DEV_USER ?? "dev", admin: true, groups: ["crow-admin"] };
  if (h.get("x-crow-proxy-secret") !== secret) throw new AuthError(401, "not signed in");
  const username = h.get("x-authentik-username");
  if (!username) throw new AuthError(401, "not signed in");
  if (!USERNAME.test(username)) throw new AuthError(403, "invalid username");
  const groups = (h.get("x-authentik-groups") ?? "").split("|").filter(Boolean);
  return { username, admin: groups.includes("crow-admin"), groups };
}

export const currentIdentity = async () => identityFrom(await headers());

export const hasSparrow = (id: Identity) => id.groups.some((g) => g === "sparrow-user" || g === "sparrow-admin");
