import { type NextRequest, NextResponse } from "next/server";
import { AuthError, identityFrom } from "@/lib/auth";
import { VERSION, VERSION_HEADER, compareVersions } from "@/lib/version";

/** Checks the proxy identity, then rejects API calls from CLIs on a different major version. */
export function proxy(req: NextRequest) {
  const headers = { [VERSION_HEADER]: VERSION };
  const path = req.nextUrl.pathname;
  if (path !== "/api/version") {
    try {
      identityFrom(req.headers);
    } catch (e) {
      if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status, headers });
      throw e;
    }
  }
  const client = req.headers.get(VERSION_HEADER);
  if (client && path !== "/api/version" && compareVersions(client, VERSION) === "incompatible") {
    const error = `client version ${client} is incompatible with server version ${VERSION}. Run: crow upgrade`;
    return Response.json({ error }, { status: 426, headers });
  }
  return NextResponse.next({ headers });
}

export const config = { matcher: ["/api/:path*", "/files/:path*", "/", "/c/:path*"] };
