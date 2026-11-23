# Access control, quotas, and feedback for crow and sparrow

Date: 2026-11-23. Status: draft, awaiting approval.

## Intent

Andrew wants a few known, trusted people to use crow (and later sparrow and other apps). Andrew is the only admin. He approves each person, controls which apps each person can use, and limits storage per person. Users can send feedback from crow; it lands as a sparrow task.

## Goals

- One account system for all apps: Authentik, run with Podman and Postgres on the mini PC.
- Accounts and role groups. Andrew manages access to every app from Authentik.
- Crow: each user sees only their own boards. Admin sees all. Storage limit per user.
- Crow feedback: button in the UI, text plus photos, videos and other media, becomes a sparrow task.
- Sparrow: same pattern as crow (Project 4).

## Non-goals

- Public sign-up, strangers, billing, multiple admins. (Andrew's call: only known users.)
- Sharing a board between users. (Claude's call: not asked for; add later if wanted.)
- A `crow feedback` CLI command. (Andrew: do not add.)
- OIDC login inside each app. (Option B, rejected.)

## Anti-goals

- Any app reachable without going through the Caddy sign-in check.
- A user forging identity headers.
- Anonymous feedback pretending to be a named user.

## Approaches

- **A. Caddy checks, apps trust headers (chosen by Andrew).** Caddy `forward_auth` asks Authentik first. Apps read user headers. Least code per app.
- **B. Each app does OIDC.** More code per app, works without Caddy. Rejected.

Hosting: Authentik in Podman Quadlet units (systemd), existing Postgres with a database `authentik`. (Claude's call.)

## Project 1: Authentik on the mini PC

- Domain `auth.andrewminghanjiang.com` through Caddy. Port bound to `127.0.0.1`.
- Quadlet units: authentik server and worker. Secrets in a root-only env file. Builder checks the current Authentik release for Redis and Postgres needs.
- Sign-up and self-enrollment off. Andrew creates users (or sends an invite link).
- Groups: `crow-admin`, `crow-user`, `sparrow-admin`, `sparrow-user`. One Authentik application per app, with a policy that allows only that app's groups. A user in no group is denied at Caddy.
- Caddy: `forward_auth` to the Authentik outpost for crow and sparrow. Caddy must overwrite any client-sent `X-authentik-*` headers. Apps keep listening only on `127.0.0.1`.
- CLI access: the Authentik proxy provider accepts a token in a header for non-browser clients. Each user makes a token in Authentik. Crow CLI sends it from env `CROW_TOKEN`.
- Backups: add an Authentik database dump to the nightly backup. Keep 7 days, newest 3 always.
- Risk accepted: if Authentik is down, nobody signs in. Andrew can still reach the apps on the mini PC itself.

## Project 2: Crow access control

- Identity: `src/proxy.ts` reads `X-authentik-username` and `X-authentik-groups`. No header means 401. Role is `admin` if group `crow-admin` is present, else `user`.
- Storage: `DATA_DIR/<username>/` holds that user's boards and assets. Existing boards move to Andrew's folder in a one-time migration.
- Admin sees every user's boards (a `?user=` filter in UI and API). Users see only their own. A user cannot read another user's folder or `/files/...` path.
- Quota: bytes of boards plus assets per user. Default 500 MB (Claude's call), overridable per user in `DATA_DIR/quotas.json`, which Andrew edits. A write over the limit returns 413 with a clear message. The UI shows used/limit.
- The existing CLI over HTTP plan (CROW-1) stays. The CLI sends `CROW_TOKEN` instead of nothing.

## Feedback to sparrow

- Crow UI: a "Feedback" button opens a form with text and a file picker (`image/*`, `video/*`, other media). Drag and drop, and paste, also work.
- Limits (Claude's call): 5 files per message, 25 MB per file (sparrow's current limit), 20 messages per user per day. Feedback files do not count toward the crow quota. They live in sparrow.
- Flow: browser posts to `POST /api/feedback` on crow. Crow creates a task in sparrow project `CROW`, then uploads each file to that task's attachments.
- Task content: title is the first line, cut to 80 characters. Body is the full text, the board link, and the crow version.
- Author: the reporter is the crow username, but only if the user is in `sparrow-user` or `sparrow-admin`. Otherwise there is no author (Andrew's rule). The task is still created.
- Sparrow has no task author field today. Store it as `extra.reporter` and show it in the task view and CLI. (Claude's call.)
- Crow calls sparrow on `127.0.0.1` with a shared secret in `SPARROW_SERVICE_TOKEN`. Sparrow accepts the reporter only with that secret. (Claude's call.)
- If sparrow is down, crow returns an error and keeps the form content so the user can retry.

## Project 4: Sparrow access control (sketch)

Same header pattern. Sparrow has one SQLite database and no owner on tasks, so it gets its own spec after crow ships. Starting ideas: groups limit which projects a user sees, and attachment bytes count per uploader.

## Left to the builder

- Exact Authentik version, Quadlet file layout, flow and policy setup.
- Exact Caddy `forward_auth` snippet and header copy list.
- Error text, UI layout for the feedback form and quota display.
- Whether sparrow's mime list already accepts video types.
- Whether sparrow is reached over Tailscale today and how outside users reach it.

## Calls added after builder review (Claude's calls)

- **Header trust.** Caddy adds a secret header (`X-Crow-Proxy-Secret`, from env). Crow rejects any request without it. Andrew uses Authentik like everyone else. Same for sparrow. This stops forged `X-authentik-*` headers from other local processes.
- **CLI token.** First build step: spike that the Authentik proxy provider accepts a token header and still returns the `X-authentik-*` headers. If not, crow checks its own per-user tokens. Tokens must be revocable per user.
- **Folder name.** `DATA_DIR/<username>/`. Username must match `^[a-z0-9-]+$`, else 403. Only Andrew creates users, and users are never renamed.
- **Migration.** A script, run once with the service stopped, after the predeploy backup. It is safe to run twice. The builder checks whether boards embed `/files/` paths and rewrites them if so.
- **Quota.** Directory scan per user, cached, cleared on each write. Crow checks `Content-Length` before it writes. Admin writes into a user's folder count for that user. Deletes free space.
- **Admin rights.** Admin can read and write every user's boards.
- **Feedback retries.** The form has a client-made id. If the task is made but a file fails, crow keeps the task id. A retry uploads only the missing files to the same task. The daily count is saved in `DATA_DIR/feedback.json`.
- **Sparrow scope.** The small sparrow change is part of this project: `extra.reporter`, the service token, the `CROW` project, and video types if missing. Full access control stays in Project 4.
- **Sparrow groups.** Crow reads sparrow groups from the same `X-authentik-groups` header. The builder confirms Authentik sends all of the user's groups.
- **Board link.** Uses the public crow URL.
