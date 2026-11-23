import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { QuotaError, limit, usage } from "./quota";
import { createCanvas, deleteCanvas, saveAsset, updateCanvas } from "./store";

beforeEach(async () => {
  process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "crow-"));
});

describe("quota", () => {
  it("defaults to 500 MB and reads overrides", async () => {
    expect(await limit("ann")).toBe(500 * 1024 * 1024);
    await fs.writeFile(path.join(process.env.DATA_DIR!, "quotas.json"), JSON.stringify({ ann: 1 }));
    expect(await limit("ann")).toBe(1024 * 1024);
  });

  it("ignores a damaged quotas.json", async () => {
    await fs.writeFile(path.join(process.env.DATA_DIR!, "quotas.json"), "{oops");
    expect(await limit("ann")).toBe(500 * 1024 * 1024);
  });

  it("refuses an asset over the limit", async () => {
    await fs.writeFile(path.join(process.env.DATA_DIR!, "quotas.json"), JSON.stringify({ ann: 1 }));
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "big.bin");
    await expect(saveAsset("ann", big)).rejects.toBeInstanceOf(QuotaError);
  });

  it("deletes a board's own assets but keeps ones another board uses", async () => {
    const mk = async (name: string, files: string[]) => {
      const id = await createCanvas("ann", name);
      await updateCanvas("ann", id, (d) => {
        d.nodes.push(...files.map((file, i) => ({ id: `${id}${i}`, type: "file" as const, file, x: 0, y: 0, width: 1, height: 1 })));
      });
      return id;
    };
    const own = await saveAsset("ann", new File(["a"], "own.bin"));
    const shared = await saveAsset("ann", new File(["b"], "shared.bin"));
    const one = await mk("one", [own, shared]);
    await mk("two", [shared]);
    const before = await usage("ann");
    await deleteCanvas("ann", one);
    expect(await usage("ann")).toBeLessThan(before);
    const exists = (p: string) => fs.stat(path.join(process.env.DATA_DIR!, "ann", p)).then(() => true, () => false);
    expect(await exists(own)).toBe(false);
    expect(await exists(shared)).toBe(true);
  });
});
