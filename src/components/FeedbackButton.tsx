"use client";

import { nanoid } from "nanoid";
import { useRef, useState } from "react";

const MAX_FILES = 5;

/** Opens a form that sends text plus photos or videos to the feedback API. */
export default function FeedbackButton({ board, className = "" }: { board?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [taskId, setTaskId] = useState<string>();
  const [status, setStatus] = useState<"idle" | "sending" | "done" | string>("idle");
  const picker = useRef<HTMLInputElement>(null);

  const add = (list: File[]) => setFiles((f) => [...f, ...list.filter((x) => /^(image|video)\//.test(x.type))].slice(0, MAX_FILES));

  function close() {
    setOpen(false);
    if (status === "done") {
      setText("");
      setFiles([]);
      setTaskId(undefined);
    }
    setStatus("idle");
  }

  async function send() {
    setStatus("sending");
    const form = new FormData();
    form.set("id", nanoid());
    form.set("text", text);
    if (board) form.set("board", board);
    if (taskId) form.set("taskId", taskId);
    files.forEach((f) => form.append("files", f));
    const res = await fetch("/api/feedback", { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok) return setStatus("done");
    if (body?.taskId) {
      setTaskId(body.taskId);
      setFiles((f) => f.filter((_, i) => body.failed?.includes(i)));
    }
    setStatus(body?.error ?? "could not send, try again");
  }

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        Feedback
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={close}>
          <div
            className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onPaste={(e) => add([...e.clipboardData.files])}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add([...e.dataTransfer.files]);
            }}
          >
            {status === "done" ? (
              <>
                <p className="py-6 text-center">Thanks!</p>
                <button className="w-full rounded-md bg-stone-900 py-1.5 text-sm text-white" onClick={close}>
                  Close
                </button>
              </>
            ) : (
              <>
                <h2 className="mb-2 font-semibold">Send feedback</h2>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What is broken, confusing, or missing?"
                  className="h-32 w-full resize-none rounded-md border border-stone-300 p-2 text-sm"
                />
                <ul className="my-2 space-y-1 text-sm">
                  {files.map((f, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="truncate">{f.name}</span>
                      <button onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                    </li>
                  ))}
                </ul>
                <input
                  ref={picker}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    add([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
                <button className="text-sm text-stone-500" onClick={() => picker.current?.click()}>
                  ⬆ Add photos or videos (up to {MAX_FILES}, 25 MB each)
                </button>
                {status !== "idle" && status !== "sending" && <p className="mt-2 text-sm text-red-600">{status}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <button className="rounded-md px-3 py-1.5 text-sm" onClick={close}>
                    Cancel
                  </button>
                  <button
                    disabled={status === "sending" || !text.trim()}
                    onClick={send}
                    className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {status === "sending" ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
