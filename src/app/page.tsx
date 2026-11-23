import { Suspense } from "react";
import { connection } from "next/server";
import { currentIdentity, currentOwner } from "@/lib/auth";
import { listCanvases, listOwners } from "@/lib/store";
import HomeGrid from "./HomeGrid";

async function Canvases() {
  await connection();
  const [id, owner] = await Promise.all([currentIdentity(), currentOwner()]);
  return <HomeGrid canvases={await listCanvases(owner)} owner={owner} owners={id.admin ? await listOwners() : undefined} />;
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
