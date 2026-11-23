import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackError, sendFeedback } from "./feedback";

const ann = { username: "ann", admin: false, groups: ["crow-user", "sparrow-user"] };
const eve = { username: "eve", admin: false, groups: ["crow-user"] };
const calls: { url: string; init: RequestInit }[] = [];

beforeEach(async () => {
  process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "crow-"));
  process.env.SPARROW_URL = "http://sparrow";
  process.env.SPARROW_SERVICE_TOKEN = "tok";
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ id: "CROW-1" });
  });
});

const png = () => new File([new Uint8Array(10)], "a.png", { type: "image/png" });
const created = () => calls.filter((c) => c.url.endsWith("/api/tasks"));

describe("sendFeedback", () => {
  it("creates a CROW task with the reporter and uploads files", async () => {
    const r = await sendFeedback(ann, { text: "Zoom is jumpy\nmore detail", board: "b1", files: [png()] });
    expect(r.taskId).toBe("CROW-1");
    const body = JSON.parse(created()[0].init.body as string);
    expect(body).toMatchObject({ project: "CROW", title: "Zoom is jumpy", reporter: "ann" });
    expect(body.body).toContain("more detail");
    expect(body.body.startsWith("Reporter: ann")).toBe(true);
    expect(body.body).toContain("/c/b1");
    expect(calls.some((c) => c.url.endsWith("/api/tasks/CROW-1/attachments"))).toBe(true);
  });

  it("sends no reporter for a user without sparrow access", async () => {
    await sendFeedback(eve, { text: "hi", files: [] });
    const sent = JSON.parse(created()[0].init.body as string);
    expect(sent.reporter).toBeUndefined();
    expect(sent.body.startsWith("Reporter: none")).toBe(true);
  });

  it("retries with a task id without making a second task", async () => {
    const { taskId } = await sendFeedback(ann, { text: "hi", files: [] });
    await sendFeedback(ann, { text: "hi", taskId, files: [png()] });
    expect(created()).toHaveLength(1);
    await expect(sendFeedback(eve, { text: "hi", taskId, files: [png()] })).rejects.toMatchObject({ status: 400 });
  });

  it("returns 502 with the failed file numbers when an upload fails", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("attachments") ? new Response("no", { status: 500 }) : Response.json({ id: "CROW-1" }),
    );
    const err = await sendFeedback(ann, { text: "hi", files: [png()] }).catch((e) => e);
    expect(err).toBeInstanceOf(FeedbackError);
    expect(err).toMatchObject({ status: 502, taskId: "CROW-1", failed: [0] });
  });

  it("stops at 20 messages a day", async () => {
    for (let i = 0; i < 20; i++) await sendFeedback(ann, { text: "hi", files: [] });
    await expect(sendFeedback(ann, { text: "hi", files: [] })).rejects.toMatchObject({ status: 429 });
  });

  it("survives a damaged feedback.json", async () => {
    await fs.writeFile(path.join(process.env.DATA_DIR!, "feedback.json"), "{oops");
    await expect(sendFeedback(ann, { text: "hi", files: [] })).resolves.toMatchObject({ taskId: "CROW-1" });
  });

  it("does not count a message when sparrow is down", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    for (let i = 0; i < 25; i++) await sendFeedback(ann, { text: "hi", files: [] }).catch(() => {});
    vi.stubGlobal("fetch", async () => Response.json({ id: "CROW-1" }));
    await expect(sendFeedback(ann, { text: "hi", files: [] })).resolves.toMatchObject({ taskId: "CROW-1" });
  });

  it("rejects empty text and too many files", async () => {
    await expect(sendFeedback(ann, { text: " ", files: [] })).rejects.toMatchObject({ status: 400 });
    await expect(sendFeedback(ann, { text: "x", files: Array(6).fill(png()) })).rejects.toMatchObject({ status: 400 });
  });
});
