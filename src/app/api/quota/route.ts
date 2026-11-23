import { connection } from "next/server";
import { ownerFrom } from "@/lib/auth";
import { limit, usage } from "@/lib/quota";

export async function GET(request: Request) {
  await connection();
  const owner = ownerFrom(request.headers);
  const [used, max] = await Promise.all([usage(owner), limit(owner)]);
  return Response.json({ used, limit: max });
}
