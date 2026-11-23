import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, ownerDir } from "./store";

const MB = 1024 * 1024;
const DEFAULT_MB = 500;

export class QuotaError extends Error {
  status = 413 as const;
}

/** Bytes used per owner folder; cleared on every write and delete. */
const cache = new Map<string, number>();
export const invalidate = (owner: string) => cache.delete(ownerDir(owner));

/** Per-user override in DATA_DIR/quotas.json: { "<username>": <megabytes> }. */
export async function limit(owner: string): Promise<number> {
  const overrides = await fs.readFile(path.join(dataDir(), "quotas.json"), "utf8").then(JSON.parse, () => ({}));
  const mb = overrides[owner];
  return (typeof mb === "number" ? mb : DEFAULT_MB) * MB;
}

async function size(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? size(full) : fs.stat(full).then((s) => s.size, () => 0);
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

export async function usage(owner: string): Promise<number> {
  const key = ownerDir(owner);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const bytes = await size(ownerDir(owner));
  cache.set(key, bytes);
  return bytes;
}

export async function assertRoom(owner: string, extraBytes: number) {
  if (extraBytes <= 0) return;
  const [used, max] = await Promise.all([usage(owner), limit(owner)]);
  if (used + extraBytes > max) {
    throw new QuotaError(`storage full: ${Math.ceil(used / MB)} of ${Math.floor(max / MB)} MB used`);
  }
}
