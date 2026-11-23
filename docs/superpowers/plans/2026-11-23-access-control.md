# Access Control, Quotas, and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put crow behind Authentik with per-user boards, storage quotas, and a feedback button that creates sparrow tasks.

**Architecture:** Caddy `forward_auth` asks Authentik, then adds `X-Crow-Proxy-Secret` and forwards `X-authentik-*` headers. Crow trusts those headers only with the secret. `store.ts` gets an `owner` argument and keeps files under `DATA_DIR/<owner>/`. Crow's server posts feedback to sparrow on `127.0.0.1` with a service token.

**Tech Stack:** Next.js 16 (`proxy.ts`), vitest, Podman Quadlet, Postgres, Authentik, Caddy, systemd.

**Spec:** `docs/superpowers/specs/2026-11-23-access-control-design.md`. Project 4 (sparrow access control) is not in this plan.

## Global Constraints

- Authentik at `auth.andrewminghanjiang.com`, bound to `127.0.0.1`, existing Postgres, database `authentik`. Sign-up and self-enrollment off.
- Groups: `crow-admin`, `crow-user`, `sparrow-admin`, `sparrow-user`. Role is `admin` if `crow-admin` is in `X-authentik-groups`, else `user`.
- Crow rejects requests without `X-Crow-Proxy-Secret` (env `CROW_PROXY_SECRET`). No `X-authentik-username` → 401. Username must match `^[a-z0-9-]+$`, else 403.
- Dev: if `CROW_PROXY_SECRET` is unset, identity comes from env `CROW_DEV_USER` (default `dev`, role admin). Never in production.
- Data: `DATA_DIR/<username>/` holds boards and `assets/`. Quota default 500 MB; overrides in `DATA_DIR/quotas.json` as `{ "<username>": <megabytes> }`. Over quota → 413 `{ error }`.
- Feedback limits: 5 files per message, 25 MB per file, 20 messages per user per day (saved in `DATA_DIR/feedback.json`). Files go to sparrow, not the crow quota.
- Reporter set only if groups include `sparrow-user` or `sparrow-admin`. Otherwise no reporter. Task is still created.
- Sparrow project `CROW`. Crow → sparrow on `127.0.0.1` with `Authorization: Bearer $SPARROW_SERVICE_TOKEN`; crow env `SPARROW_URL`.
- Keep code simple, minimal comments and tests. Conventional commits; PR title is the commit message. Each task is one PR with a ticket key in the title.

## Review Focus

- Request with a forged `X-authentik-username` but no proxy secret → 401, not served.
- Username `../x` or `A b` → 403, never reaches the filesystem.
- User A requests `/files/<B>/assets/x.png` → 404.
- Upload that would pass the quota but is under it by `Content-Length` lie → rejected after write check, file removed.
- Feedback with sparrow down → 502 with the form's task id intact; retry makes no duplicate task.
- Feedback by a user without sparrow groups → task created, no `extra.reporter`.

---

### Task 1: Authentik on the mini PC

**Files:**
- Create: `deploy/authentik/authentik-server.container`, `deploy/authentik/authentik-worker.container`, `deploy/authentik/authentik.env.example`, `deploy/authentik/setup.sh`, `deploy/authentik/Caddyfile.snippet`
- Modify: `deploy/backup.sh` (add `pg_dump authentik` to the tarball dir)

**Interfaces:**
- Produces: Authentik outpost at `http://127.0.0.1:9000/outpost.goauthentik.io`; Caddy snippet `(crow_auth)` that runs `forward_auth`, copies `X-authentik-username`, `X-authentik-groups`, and sets `X-Crow-Proxy-Secret {env.CROW_PROXY_SECRET}`, deleting any client-sent `X-authentik-*` and `X-Crow-Proxy-Secret` first.

- [ ] **Step 1:** Write the two Quadlet units for the current Authentik release (check its docs for Redis/Postgres needs). Ports bound to `127.0.0.1`. Env from `/etc/authentik/authentik.env` (mode 600, from the example file).
- [ ] **Step 2:** `setup.sh`: create database and role `authentik` in Postgres, install units to `/etc/containers/systemd/`, `systemctl daemon-reload`, start both. Install the Caddy snippet and a site for `auth.andrewminghanjiang.com`.
- [ ] **Step 3:** In Authentik (browser): create admin (Andrew), the four groups, one proxy-provider application per app with a group policy, disable enrollment. Create a user token for Andrew.
- [ ] **Step 4:** Spike: `curl -si -H "Authorization: Bearer <token>" https://crow.andrewminghanjiang.com/api/canvas` returns 200 and crow sees `X-authentik-username`. If Authentik does not accept it, stop and add a per-user token check in crow (new task; tell Andrew).
- [ ] **Step 5:** `deploy/backup.sh`: add `sudo -u postgres pg_dump authentik > $tmp/authentik.sql`. Run `sudo systemctl start crow-backup`; tarball contains `authentik.sql`.
- [ ] **Step 6:** PR `feat(deploy): add Authentik with Podman Quadlet`.

### Task 2: Identity and proxy secret

**Files:**
- Create: `src/lib/auth.ts`
- Modify: `src/proxy.ts`
- Test: `src/lib/lib.test.ts`

**Interfaces:**
- Produces: `type Identity = { username: string; admin: boolean; groups: string[] }`; `identityFrom(headers: Headers): Identity` (throws `AuthError` with `.status` 401 or 403); `currentIdentity(): Promise<Identity>` (reads `headers()` from `next/headers`); `hasSparrow(id: Identity): boolean`.

- [ ] **Step 1: Failing tests.** `identityFrom` with: no secret header when `CROW_PROXY_SECRET=s` → status 401; secret ok + username `bob` + groups `crow-user,sparrow-user` → `{ username: "bob", admin: false }` and `hasSparrow` true; username `../x` → status 403; groups containing `crow-admin` → `admin: true`; secret unset → `CROW_DEV_USER` admin. Groups header is split on `|` (Authentik's separator; confirm in Task 1 spike).
- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implement `auth.ts` as above. In `src/proxy.ts` call `identityFrom` for `/api/*`, `/files/*`, and pages; return its status as JSON on `AuthError`. Keep the version check. `/api/version` stays open.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** PR `feat: read user identity from proxy headers`.

### Task 3: Per-user storage and migration

**Files:**
- Modify: `src/lib/store.ts`, `src/app/actions.ts`, `src/app/page.tsx`, `src/app/c/[id]/page.tsx`, `src/app/api/canvas/route.ts`, `src/app/api/canvas/[id]/route.ts`, `src/app/api/canvas/[id]/events/route.ts`, `src/app/api/canvas/[id]/ops/route.ts`, `src/app/api/assets/route.ts`, `src/app/files/[...path]/route.ts`, `src/app/HomeGrid.tsx`
- Create: `scripts/migrate-owner.ts`
- Test: `src/lib/lib.test.ts`

**Interfaces:**
- Consumes: `currentIdentity`, `Identity` from Task 2.
- Produces: every `store.ts` function that touches disk takes `owner: string` first (`listCanvases(owner)`, `readCanvas(owner, id)`, `createCanvas(owner, name)`, `saveAsset(owner, file)`, etc.). `ownerDir(owner): string` = `dataDir()/owner`. `resolveDataPath(owner, rel)` stays inside `ownerDir(owner)`. Asset paths returned as `<owner>/assets/<name>`.
- Routes and actions take the owner from `currentIdentity()`. Admin may pass `?user=<name>` (API) or the `user` search param (pages) to act as another owner; non-admin `?user=` is ignored.

- [ ] **Step 1: Failing tests:** two owners with the same board name have separate lists; `resolveDataPath("a", "../b/x")` returns `null`; `/files/<other>/...` returns 404 for a non-admin (test the route handler with a mocked identity).
- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Add `owner` to the store functions and update every call site above. `HomeGrid` shows an owner switcher for admin only (list of folders under `DATA_DIR`).
- [ ] **Step 4:** `scripts/migrate-owner.ts <username>`: moves `DATA_DIR/*.canvas` and `DATA_DIR/assets` into `DATA_DIR/<username>/`, rewrites `assets/` and `/files/assets/` strings inside the moved boards to `<username>/assets/`. Idempotent: skip when nothing to move. Check first whether boards embed `/files/` paths with `rg "files/" data | head`.
- [ ] **Step 5:** `pnpm test && pnpm typecheck` → PASS. Manual: `DATA_DIR=$(mktemp -d)` with old-layout fixtures, run the script twice; second run prints `nothing to migrate`.
- [ ] **Step 6:** PR `feat: store boards per user`. Deploy note in PR: stop service, run script for `andrew`, start service.

### Task 4: Quota

**Files:**
- Create: `src/lib/quota.ts`, `src/app/api/quota/route.ts`
- Modify: `src/lib/store.ts` (`writeCanvas`, `saveAsset`), `src/app/HomeGrid.tsx` (used/limit text)
- Test: `src/lib/lib.test.ts`

**Interfaces:**
- Produces: `usage(owner: string): Promise<number>` (bytes, directory scan, cached, cleared on write); `limit(owner: string): Promise<number>` (bytes; default 500 MB, `quotas.json` override); `assertRoom(owner: string, extraBytes: number): Promise<void>` throws `QuotaError` (`.status` 413, message `storage full: <used> of <limit> MB`). `GET /api/quota` → `{ used, limit }` for the current owner.

- [ ] **Step 1: Failing tests:** with limit 1 MB (`quotas.json`), `saveAsset` of 2 MB throws `QuotaError`; deleting a board frees usage; `limit("x")` reads override.
- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implement. `saveAsset` and `writeCanvas` call `assertRoom` before writing. `/api/assets` also checks `Content-Length`; after writing, re-check and delete the file if over. Map `QuotaError` to 413 in routes.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** PR `feat: per-user storage quota`.

### Task 5: CLI token

**Files:**
- Modify: `src/cli/http.ts`, `src/cli/crow.ts` (help text)

**Interfaces:**
- Produces: `api()` sends `Authorization: Bearer ${CROW_TOKEN}` when `CROW_TOKEN` is set. A 401 or 403 becomes `{"error":"not signed in. Set CROW_TOKEN"}` on stderr, exit 1.

- [ ] **Step 1:** Implement as above.
- [ ] **Step 2:** Verify with Task 1's token: `CROW_TOKEN=<token> crow ls` → your boards. Without it → the error line.
- [ ] **Step 3:** PR `feat: crow CLI sends an auth token`.

### Task 6: Sparrow reporter and service token (sparrow repo, `~/Desktop/personal/productivity`)

**Files:**
- Modify: `src/app/api/tasks/route.ts`, `src/app/api/tasks/[id]/attachments/route.ts`, `src/core/mime.ts`, task view components and CLI show output
- Test: `src/core/ops.test.ts`

**Interfaces:**
- Produces: `POST /api/tasks` accepts optional `reporter: string` and stores it in `extra.reporter`, only when the request has `Authorization: Bearer $SPARROW_SERVICE_TOKEN`; without the token it is ignored. Task view and `sparrow show` print `reporter` when set. Attachment mime list accepts `video/mp4`, `video/webm`, `video/quicktime`. Project `CROW` exists.

- [ ] **Step 1: Failing test:** creating a task with `reporter` and no token leaves `extra.reporter` unset; with the token it is set.
- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implement. Add `SPARROW_SERVICE_TOKEN` to `deploy/sparrow.service` env file. Create project `CROW` with `sparrow` CLI.
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** PR in the sparrow repo `feat: accept reporter from service token`. Follow its CLAUDE.md shipping flow.

### Task 7: Feedback API in crow

**Files:**
- Create: `src/lib/feedback.ts`, `src/app/api/feedback/route.ts`
- Test: `src/lib/lib.test.ts`

**Interfaces:**
- Consumes: `Identity`, `hasSparrow` (Task 2); sparrow contract (Task 6).
- Produces: `POST /api/feedback` multipart: `id` (client nanoid), `text`, `board` (optional id), `taskId` (optional, set on retry), `files[]`. Returns `{ taskId }` or an error JSON. `sendFeedback(id: Identity, input: { text: string; board?: string; taskId?: string; files: File[] }): Promise<{ taskId: string }>` in `feedback.ts`. Errors: 400 (empty text, >5 files, file >25 MB), 429 (daily limit), 502 (sparrow failed; body includes `taskId` if the task exists).

- [ ] **Step 1: Failing tests** (mock `fetch` to sparrow): creates task with title = first line cut to 80 chars and body containing text and board link; reporter sent only when `hasSparrow`; retry with `taskId` uploads files without creating a second task; 21st message in a day → 429.
- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implement. Calls `POST ${SPARROW_URL}/api/tasks` in project `CROW`, then `POST /api/tasks/<key>/attachments` per file. Daily count in `DATA_DIR/feedback.json`, keyed by username and UTC date. Board link uses `CROW_PUBLIC_URL` (default `https://crow.andrewminghanjiang.com`).
- [ ] **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** PR `feat: send feedback to sparrow`.

### Task 8: Feedback UI

**Files:**
- Create: `src/components/FeedbackButton.tsx`
- Modify: `src/components/board/Toolbar.tsx`, `src/app/layout.tsx` or `src/app/page.tsx` (button on home too)

**Interfaces:**
- Consumes: `POST /api/feedback` (Task 7).
- Produces: `<FeedbackButton board?: string />` opens a dialog: text box, file picker (`accept="image/*,video/*"`; paste and drag-drop also add files), file list with remove, Send. Keeps text, files, and `taskId` on error and shows the error message. Closes with "Thanks" on success.

- [ ] **Step 1:** Build the component. Generate the client `id` with `nanoid` once per open dialog.
- [ ] **Step 2:** Manual check with `pnpm dev` and a local sparrow: send text + one image + one video; a sparrow task appears in `CROW` with 2 attachments. Stop sparrow, send again → error shows, text kept. Start sparrow, retry → one task only.
- [ ] **Step 3:** PR `feat: feedback button`.

### Task 9: Turn it on in production

**Files:**
- Modify: `deploy/crow.service` (`EnvironmentFile=/etc/crow/crow.env`), `deploy/setup.sh` (create `/etc/crow/crow.env` mode 600 with `CROW_PROXY_SECRET`, `SPARROW_URL`, `SPARROW_SERVICE_TOKEN`)

- [ ] **Step 1:** Add the env file wiring. PR `ci: load crow secrets from an env file`.
- [ ] **Step 2 (Andrew, mini PC):** Generate secrets, set the Caddy secret to match, apply the Task 3 migration for `andrew`, create users in Authentik, add them to `crow-user`.
- [ ] **Step 3:** Verify: a browser without sign-in is sent to Authentik; a user in only `sparrow-user` is denied; a `crow-user` sees only their boards; `curl` to `127.0.0.1:3418/api/canvas` with a forged username returns 401.
