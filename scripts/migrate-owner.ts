// One-time move of the old flat layout into DATA_DIR/<username>/. Stop crow first.
// Usage: DATA_DIR=/var/lib/crow pnpm tsx scripts/migrate-owner.ts <username>
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, ownerDir } from "../src/lib/store";

async function main() {
  const owner = process.argv[2];
  if (!owner) throw new Error("usage: migrate-owner.ts <username>");
  const dest = ownerDir(owner);
  const root = dataDir();
  const moves = (await fs.readdir(root)).filter((f) => f.endsWith(".canvas") || f === "assets");
  if (!moves.length) {
    console.log("nothing to migrate");
    return;
  }
  await fs.mkdir(dest, { recursive: true });
  for (const f of moves) {
    const to = path.join(dest, f);
    if (f === "assets" && (await fs.stat(to).then(() => true, () => false))) {
      for (const a of await fs.readdir(path.join(root, f))) await fs.rename(path.join(root, f, a), path.join(to, a));
      await fs.rmdir(path.join(root, f));
    } else {
      await fs.rename(path.join(root, f), to);
    }
    console.log(`moved ${f} -> ${owner}/`);
  }
}

main();
