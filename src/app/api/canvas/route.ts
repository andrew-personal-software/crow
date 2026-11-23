import { connection } from "next/server";
import { ownerFrom } from "@/lib/auth";
import { QuotaError } from "@/lib/quota";
import { createCanvas, listCanvases } from "@/lib/store";

export async function GET(request: Request) {
  await connection();
  return Response.json(await listCanvases(ownerFrom(request.headers)));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.name !== "string" || !body.name) return Response.json({ error: "missing name" }, { status: 400 });
  try {
    return Response.json({ id: await createCanvas(ownerFrom(request.headers), body.name) });
  } catch (e) {
    if (e instanceof QuotaError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
