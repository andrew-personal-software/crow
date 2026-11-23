"use server";

import { cookies } from "next/headers";
import { currentIdentity, currentOwner } from "@/lib/auth";
import { QuotaError } from "@/lib/quota";
import { createCanvas, deleteCanvas, renameCanvas } from "@/lib/store";

/** Admin only: work in another user's boards. An empty name goes back to your own. */
export async function actAsAction(user: string) {
  if (!(await currentIdentity()).admin) return;
  (await cookies()).set("crow-as", /^[a-z0-9-]+$/.test(user) ? user : "", { path: "/", httpOnly: true, sameSite: "lax" });
}

export async function createCanvasAction(name: string): Promise<{ id: string } | { error: string }> {
  try {
    return { id: await createCanvas(await currentOwner(), name) };
  } catch (e) {
    if (e instanceof QuotaError) return { error: e.message };
    throw e;
  }
}

export async function renameCanvasAction(id: string, name: string) {
  await renameCanvas(await currentOwner(), id, name);
}

export async function deleteCanvasAction(id: string) {
  await deleteCanvas(await currentOwner(), id);
}

