import fs from "node:fs/promises";
import path from "node:path";
import { type Identity, hasSparrow } from "./auth";
import { dataDir } from "./store";
import { VERSION } from "./version";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DAILY_LIMIT = 20;

export class FeedbackError extends Error {
  constructor(
    public status: 400 | 429 | 502,
    message: string,
    public taskId?: string,
    public failed?: number[],
  ) {
    super(message);
  }
}

type Input = { text: string; board?: string; taskId?: string; files: File[] };

type State = Record<string, { day: string; n: number; tasks: string[] }>;
const stateFile = () => path.join(dataDir(), "feedback.json");
const load = (): Promise<State> => fs.readFile(stateFile(), "utf8").then(JSON.parse, () => ({}));
async function save(all: State) {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify(all));
}

/** Counts a message for today (429 past the daily limit). State lives in DATA_DIR/feedback.json. */
async function count(username: string) {
  const all = await load();
  const day = new Date().toISOString().slice(0, 10);
  const cur = all[username]?.day === day ? all[username].n : 0;
  if (cur >= DAILY_LIMIT) throw new FeedbackError(429, `limit of ${DAILY_LIMIT} feedback messages a day reached`);
  all[username] = { day, n: cur + 1, tasks: all[username]?.tasks ?? [] };
  await save(all);
}

/** A retry may only add files to a task this user's earlier message made. */
async function remember(username: string, taskId: string) {
  const all = await load();
  all[username].tasks = [...all[username].tasks, taskId].slice(-50);
  await save(all);
}

const sparrow = (p: string, init: RequestInit) =>
  fetch(process.env.SPARROW_URL + p, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${process.env.SPARROW_SERVICE_TOKEN}` },
  });

/** Makes a sparrow task in project CROW (or reuses `taskId` on a retry) and uploads the files to it. */
export async function sendFeedback(id: Identity, input: Input): Promise<{ taskId: string }> {
  const text = input.text.trim();
  if (!text) throw new FeedbackError(400, "write a message first");
  if (input.files.length > MAX_FILES) throw new FeedbackError(400, `at most ${MAX_FILES} files`);
  if (input.files.some((f) => f.size > MAX_FILE_BYTES)) throw new FeedbackError(400, "each file must be under 25 MB");

  let taskId = input.taskId;
  if (taskId && !(await load())[id.username]?.tasks.includes(taskId)) throw new FeedbackError(400, "unknown feedback task");
  if (!taskId) {
    await count(id.username);
    const reporter = hasSparrow(id) ? id.username : undefined;
    const site = (process.env.CROW_PUBLIC_URL ?? "https://crow.andrewminghanjiang.com").replace(/\/+$/, "");
    const lines = [text, "", "---", ...(reporter ? [`Reporter: ${reporter}`] : []), ...(input.board ? [`Board: ${site}/c/${input.board}`] : []), `Crow: ${VERSION}`];
    const res = await sparrow("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "CROW", title: text.split("\n")[0].slice(0, 80), body: lines.join("\n"), reporter }),
    }).catch(() => null);
    if (!res?.ok) throw new FeedbackError(502, "could not reach sparrow, try again");
    taskId = ((await res.json()) as { id: string }).id;
    await remember(id.username, taskId);
  }

  const failed: number[] = [];
  for (const [i, file] of input.files.entries()) {
    const form = new FormData();
    form.set("file", file);
    const res = await sparrow(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form }).catch(() => null);
    if (!res?.ok) failed.push(i);
  }
  if (failed.length) throw new FeedbackError(502, "some files did not upload, try again", taskId, failed);
  return { taskId };
}
