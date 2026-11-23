import { ownerFrom } from "@/lib/auth";
import { QuotaError, assertRoom } from "@/lib/quota";
import { saveAsset } from "@/lib/store";

export async function POST(request: Request) {
  const owner = ownerFrom(request.headers);
  try {
    await assertRoom(owner, Number(request.headers.get("content-length") ?? 0));
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return Response.json({ error: "missing file" }, { status: 400 });
    return Response.json({ path: await saveAsset(owner, file) });
  } catch (e) {
    if (e instanceof QuotaError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
