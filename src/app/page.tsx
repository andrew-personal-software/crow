import { Suspense } from "react";
import { connection } from "next/server";
import { currentIdentity, currentOwner } from "@/lib/auth";
import { limit, usage } from "@/lib/quota";
import { listCanvases, listOwners } from "@/lib/store";
import HomeGrid from "./HomeGrid";

async function Canvases() {
  await connection();
  const [id, owner] = await Promise.all([currentIdentity(), currentOwner()]);
  const [canvases, used, max] = await Promise.all([listCanvases(owner), usage(owner), limit(owner)]);
  const mb = (n: number) => Math.round(n / 1048576);
  return (
    <HomeGrid
      canvases={canvases}
      owner={owner}
      owners={id.admin ? await listOwners() : undefined}
      storage={`${mb(used)} of ${mb(max)} MB used`}
    />
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<p className="text-stone-400">Loading…</p>}>
        <Canvases />
      </Suspense>
    </main>
  );
}
