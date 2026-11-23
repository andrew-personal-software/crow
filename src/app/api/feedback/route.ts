import { identityFrom } from "@/lib/auth";
import { FeedbackError, sendFeedback } from "@/lib/feedback";

/** Multipart: text, optional board and taskId (set on a retry), and files. */
export async function POST(request: Request) {
  const id = identityFrom(request.headers);
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected multipart form data" }, { status: 400 });
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
  try {
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    return Response.json(await sendFeedback(id, { text: str("text") ?? "", board: str("board"), taskId: str("taskId"), files }));
  } catch (e) {
    if (e instanceof FeedbackError) {
      return Response.json({ error: e.message, taskId: e.taskId, failed: e.failed }, { status: e.status });
    }
    throw e;
  }
}
