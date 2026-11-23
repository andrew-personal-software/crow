import { connection } from "next/server";
import { ownerFrom } from "@/lib/auth";
import { QuotaError } from "@/lib/quota";
import { type Change, applyChanges } from "@/lib/diff";
import { deleteCanvas, loadCanvas, renameCanvas, updateCanvas } from "@/lib/store";

export async function GET(request: Request, ctx: RouteContext<"/api/canvas/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const loaded = await loadCanvas(ownerFrom(request.headers), id);
  if (!loaded) return new Response("not found", { status: 404 });
  return Response.json(loaded.doc, { headers: { "x-version": loaded.version } });
}

const isChange = (c: unknown): c is Change =>
  typeof c === "object" &&
  c !== null &&
  ["node", "edge", "meta"].includes((c as Change).kind) &&
  typeof (c as Change).id === "string";

/** Applies a client's per-object changes on top of whatever is on disk now. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/canvas/[id]">) {
  const { id } = await ctx.params;
  const changes: unknown = await request.json().catch(() => null);
  if (!Array.isArray(changes) || !changes.every(isChange)) return new Response("bad request", { status: 400 });
  try {
    const version = await updateCanvas(ownerFrom(request.headers), id, (doc) => applyChanges(doc, changes, "after"));
    if (!version) return new Response("not found", { status: 404 });
    return new Response(null, { status: 204, headers: { "x-version": version } });
  } catch (e) {
    if (e instanceof QuotaError) return Response.json({ error: e.message }, { status: e.status });
    return new Response("save failed", { status: 500 });
  }
}

export async function PUT(request: Request, ctx: RouteContext<"/api/canvas/[id]">) {
  const { id } = await ctx.params;
  const owner = ownerFrom(request.headers);
  const body = await request.json().catch(() => null);
  if (typeof body?.name !== "string" || !body.name) return Response.json({ error: "missing name" }, { status: 400 });
  if (!(await loadCanvas(owner, id))) return Response.json({ error: `no board "${id}"` }, { status: 404 });
  await renameCanvas(owner, id, body.name);
  return Response.json({ id, name: body.name });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/canvas/[id]">) {
  const owner = ownerFrom(request.headers);
  const { id } = await ctx.params;
  if (!(await loadCanvas(owner, id))) return Response.json({ error: `no board "${id}"` }, { status: 404 });
  await deleteCanvas(owner, id);
  return Response.json({ deleted: id });
}
