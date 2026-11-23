import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { QuotaError, limit } from "./quota";
import { createCanvas, deleteCanvas, saveAsset } from "./store";

beforeEach(async () => {
  process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "crow-"));
});

describe("quota", () => {
  it("defaults to 500 MB and reads overrides", async () => {
    expect(await limit("ann")).toBe(500 * 1024 * 1024);
    await fs.writeFile(path.join(process.env.DATA_DIR!, "quotas.json"), JSON.stringify({ ann: 1 }));
    expect(await limit("ann")).toBe(1024 * 1024);
  });

  it("refuses an asset over the limit", async () => {
    await fs.writeFile(path.join(process.env.DATA_DIR!, "quotas.json"), JSON.stringify({ ann: 1 }));
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "big.bin");
    await expect(saveAsset("ann", big)).rejects.toBeInstanceOf(QuotaError);
  });

  it("frees space when a board is deleted", async () => {
    await fs.writeFile(path.join(process.env.DATA_DIR!, "quotas.json"), JSON.stringify({ ann: 1 }));
    const id = await createCanvas("ann", "x");
    await saveAsset("ann", new File([new Uint8Array(900 * 1024)], "a.bin"));
    await expect(saveAsset("ann", new File([new Uint8Array(900 * 1024)], "b.bin"))).rejects.toBeInstanceOf(QuotaError);
    await fs.rm(path.join(process.env.DATA_DIR!, "ann/assets"), { recursive: true });
    await deleteCanvas("ann", id);
    await saveAsset("ann", new File([new Uint8Array(900 * 1024)], "b.bin"));
  });
});
