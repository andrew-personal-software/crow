import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/canvas/[id]/ops/route";
import { proxy } from "../proxy";
import { compareVersions, VERSION } from "./version";
import { parsePreview } from "./preview";
import { createCanvas, listCanvases, resolveDataPath, slug } from "./store";
import { GET as getFile } from "../app/files/[...path]/route";

describe("parsePreview", () => {
  it("reads og tags and resolves relative images", () => {
    const html = `<meta property="og:title" content="ColBERT &amp; friends"><meta content="/img.png" property="og:image"><meta name="description" content="Late interaction">`;
    expect(parsePreview(html, "https://www.arxiv.org/abs/1")).toEqual({
      title: "ColBERT & friends",
      description: "Late interaction",
      image: "https://www.arxiv.org/img.png",
      site: "arxiv.org",
    });
  });

  it("falls back to <title> and hostname", () => {
    expect(parsePreview("<title>Hi</title>", "https://example.com/x")).toEqual({
      title: "Hi",
      image: undefined,
      site: "example.com",
    });
  });
});

describe("store paths", () => {
  it("blocks paths outside the owner dir", () => {
    expect(resolveDataPath("ann", "../package.json")).toBeNull();
    expect(resolveDataPath("ann", "../bob/assets/a.png")).toBeNull();
    expect(resolveDataPath("ann", "assets/a.png")).toMatch(/data\/ann\/assets\/a\.png$/);
  });

  it("keeps each owner's boards apart", async () => {
    process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "crow-"));
    await createCanvas("ann", "same");
    await createCanvas("bob", "same");
    expect(await listCanvases("ann")).toHaveLength(1);
    expect(await listCanvases("bob")).toHaveLength(1);
  });

  it("does not serve another owner's files", async () => {
    process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "crow-"));
    process.env.CROW_PROXY_SECRET = "s";
    await fs.mkdir(path.join(process.env.DATA_DIR, "bob/assets"), { recursive: true });
    await fs.writeFile(path.join(process.env.DATA_DIR, "bob/assets/x.png"), "x");
    const as = (u: string) => new Request("http://x", { headers: { "x-crow-proxy-secret": "s", "x-authentik-username": u } });
    const get = (u: string, p: string[]) => getFile(as(u), { params: Promise.resolve({ path: p }) } as never);
    expect((await get("bob", ["assets", "x.png"])).status).toBe(200);
    expect((await get("ann", ["assets", "x.png"])).status).toBe(404);
    expect((await get("ann", ["..", "bob", "assets", "x.png"])).status).toBe(404);
    delete process.env.CROW_PROXY_SECRET;
  });

  it("slugs names", () => {
    expect(slug("RAG research!")).toBe("rag-research");
    expect(slug("???")).toBe("canvas");
  });
});

describe("compareVersions", () => {
  it("matches majors", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe("same");
    expect(compareVersions("1.2.3", "1.9.0")).toBe("compatible");
    expect(compareVersions("1.2.3", "2.0.0")).toBe("incompatible");
  });
});

describe("proxy", () => {
  const req = (version?: string) =>
    new NextRequest("http://x/api/canvas", { headers: version ? { "X-Crow-Version": version } : {} });

  it("rejects an incompatible CLI", async () => {
    const res = proxy(req("99.0.0"));
    expect(res.status).toBe(426);
    expect((await res.json()).error).toMatch(/crow upgrade/);
  });

  it("lets browsers and matching CLIs through", () => {
    expect(proxy(req()).status).toBe(200);
    expect(proxy(req(VERSION)).headers.get("X-Crow-Version")).toBe(VERSION);
  });
});

describe("ops route", () => {
  it("returns 400 with the op error", async () => {
    process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "crow-"));
    const id = await createCanvas("dev", "t");
    const body = JSON.stringify([{ op: "rm", ids: ["nope"] }]);
    const res = await POST(new Request("http://x", { method: "POST", body }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nope/);
  });
});
