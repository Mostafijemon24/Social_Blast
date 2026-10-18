# Social Blast

A website-grounded social media manager for agencies. It's built from the
Claude Design handoff in [`design/`](design/HANDOFF.md) (`Social Blast.dc.html`).

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 3 with the design tokens
(`src/styles/tokens.css`, `tailwind.config.js`) · Phosphor icons · Inter · SQLite via Node's built-in `node:sqlite`.

## Run it

Requires **Node 22.5+**. No database server is needed.

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # unit tests (validation, CSV/Excel import rules, time zones)
npm run typecheck
npm run build && npm start
```

The first request creates `data/social-blast.db` and fills it with the demo workspace
(Northgate HVAC, Bloom & Co Floral, Peak Dental Studio). Dates are relative to that moment.
`npm run db:reset` deletes the database so it is re-seeded on the next start.

### Signing in

- **Development (`npm run dev`):** a demo owner is created and the login page shows its details:
  `rhea@agency.example` / `socialblast-demo`.
- **Production (`npm start`):** no account exists at first. The first person to open `/login` creates the
  owner account, which is also the platform operator (Super Admin). Set `SB_DEMO_PASSWORD` only if you
  deliberately want the demo owner in production.
- Owners and admins add teammates in **Settings → Team**, either by **email invite** (they choose their own
  password; the link works once and expires in 7 days) or by setting a temporary password.
- **Client access:** editors and viewers can be limited to specific clients. They then can't see other
  clients anywhere: the client switcher, every API route, record lookups and Overview totals are all filtered.
  Owners and admins always see every client.
- **Password reset:** "Forgot password?" on the login page emails a one-time link (60 minutes). Admins can also
  send a member a reset link from Team. Resetting signs the account out everywhere.
- **Email:** set `SMTP_HOST` (and the other `SMTP_*` settings) to deliver invite and reset emails. Without SMTP,
  nothing is emailed: the admin is shown the link to share, and messages are kept in **Super Admin → Email outbox**.

| Role | Can do |
| --- | --- |
| Owner | Everything, including managing other owners |
| Admin | Add clients, connect accounts, manage the team |
| Editor | Create, edit, generate and schedule content, change rules |
| Viewer | Read only |
| Platform operator (flag) | Super Admin page and `/api/admin/*` |

### AI writing

Set `OPENROUTER_API_KEY` on the server and drafts are written by the OpenRouter model in `OPENROUTER_MODEL`
(any model listed at openrouter.ai/models). It also unlocks Bengali, Spanish, Hindi, Arabic and French in the
Generate wizard. Without a key, the
template writer is used (English only). The prompt forbids invented prices, offers, reviews or locations,
and every draft still goes through the normal validation before it can be scheduled. Spend appears in Super Admin.

| Setting | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Turns on AI writing (and AI images) through OpenRouter |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Model for writing posts |
| `OPENROUTER_IMAGE_MODEL` | `google/gemini-2.5-flash-image` | Model for AI images (must output images) |
| `SB_AI_PROVIDER` | auto | Set `template` to force the template writer even with a key |
| `SB_DB_PATH` | `data/social-blast.db` | SQLite file location |
| `SB_SEED` | `true` | Set `false` to start with an empty database (no demo data or demo user) |
| `SB_DEMO_PASSWORD` | `socialblast-demo` in dev | Demo owner password; setting it in production creates the demo owner there too |
| `APP_URL` | request address in dev | Public address used in email links; **required in production** |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | unset | Mail server for invites and password resets |
| `SB_ENCRYPTION_KEY` | unset | Encrypts stored social tokens; required to connect accounts |
| `META_APP_ID`/`_SECRET`, `LINKEDIN_CLIENT_ID`/`_SECRET`, `X_CLIENT_ID`/`_SECRET`, `PINTEREST_APP_ID`/`_SECRET`, `GOOGLE_CLIENT_ID`/`_SECRET` | unset | Platform OAuth apps (see the guide) |
| `META_GRAPH_VERSION`, `LINKEDIN_API_VERSION`, `LINKEDIN_ORG_ACCESS` | `v23.0`, `202509`, off | Platform API versions; company-page posting on LinkedIn |
| `SB_WORKER`, `SB_WORKER_TICK_MS` | on, `15000` | Background worker in the web process (`off` when running `npm run worker`) |
| `SB_CRAWL_MAX_PAGES` | `60` | Pages per crawl |

Session cookies are `Secure` in production, so serve the app over HTTPS (localhost is fine).

## Screens

| Route | What works |
| --- | --- |
| `/content` | **AI Content Studio**: brief, per-platform captions/titles/hashtags, live preview, validation, destination picker, save, schedule. Also has **All content** (status filters, paging) and **Bulk import** (CSV/Excel templates, upload, row-by-row validation, error report, import) |
| `/overview` | Stats are computed from the database, with upcoming posts, crawl status and activity |
| `/calendar` | Week / month / day views in the client's time zone. Drag a future post to another day to reschedule it |
| `/automations` | Toggle rules. Configure Comment → DM (keywords, reply, DM, lead tag, safeguards, preview), Evergreen rotation and Weekly digest |
| `/contacts` | Captured leads, with search |
| `/settings` | Connect accounts through each platform's OAuth, switch destinations on/off, disconnect; Team |
| `/website` | Knowledge library: crawl the site (live progress), include or exclude pages, edit keywords, set the target location |
| `/admin` | Super Admin (platform operators only): job queues, AI spend, system logs |
| `/login` | Sign in, or create the first owner account |
| Header | Client switcher (with Add client), Demo/Empty preview toggle, theme toggle, and the 6-step **Generate posts** wizard |

## Backend

API routes live in `src/app/api/**` and use `src/server/repo.ts` (data access) and `src/server/db.ts` (schema, SQLite or
PostgreSQL via `DATABASE_URL`; all queries are async and run inside `tx()` transactions where needed).
Shared rules are in `src/lib`:

- `validation.ts`: character limits, near-duplicate detection (word-trigram similarity, 60% threshold),
  Google Business Profile "no hashtags" rule, source grounding. The Studio runs these live, and
  `POST /api/posts/:id/schedule` runs them again on the server and refuses blocked posts.
- `platforms.ts`: versioned per-platform limits and media sizes.
- `bulk.ts` / `csv.ts`: import template, header mapping, row validation, and formula-injection-safe CSV export.

Scheduling creates one publish job per destination, keyed by post × destination × time, so retrying
never queues a post twice.

## Going live

**[docs/GOING-LIVE.md](docs/GOING-LIVE.md)** (Bengali) covers server setup, each platform's app keys and
approvals, the first live publish test, crawling, and what is still to build.

- **Social connections:** official OAuth for Facebook Pages, Instagram professional accounts (via Meta),
  LinkedIn, X (PKCE), Pinterest boards and Google Business Profile locations. Tokens are AES-256-GCM encrypted
  (`SB_ENCRYPTION_KEY`). Newly found destinations start switched off until someone turns them on.
- **Publishing worker:** runs with the server (`src/instrumentation.ts`) or alone (`npm run worker`); publishes due
  posts, retries temporary errors (1/5/15 min), never re-sends an interrupted publish, flags accounts whose token is
  rejected, and sets the post to published / failed from the real results.
- **Crawler:** robots.txt, sitemaps and internal links, SSRF-safe fetching, page text/headings/type extraction,
  keyword suggestions; crawled text grounds the AI drafts.
- Platform calls are tested against simulated responses only — run the first live test per platform (guide step 5).

- **Media:** uploads and AI images (OpenAI Images, `OPENAI_API_KEY`) are normalised to JPEG and cropped per platform
  with sharp; stored on disk or in an S3-compatible bucket (`SB_STORAGE=s3`) and served to platforms from `/media/...`.
  Images and video publish to every platform (LinkedIn Images/Videos API, X v2 media and chunked video upload,
  Pinterest video pins, Facebook Page videos, Instagram Reels; on Google Business the video goes to the profile's media).
- **Automations (worker):** Comment → DM from Meta webhooks (`/api/webhooks/meta`, signature-checked), Evergreen
  re-posting, weekly digest email, captions for bulk-imported rows, and analytics refresh. Pending posts have
  Approve / Send back.
- **Auto-boost:** promotes the best Facebook/Instagram post through the Meta Marketing API (`META_ADS=true`), with a
  monthly cap, weekly limit and ads created paused by default; a Boost button does the same by hand.
- **Scale:** set `DATABASE_URL=postgres://…` to run several web servers and workers; every job is claimed with a
  conditional update so it runs once. `npm run db:to-postgres` copies an existing SQLite database (and, with
  `--media`, uploaded files to S3). `npm test` runs on SQLite, `DATABASE_URL=… npm run test:pg` on PostgreSQL.

## Operations

- `GET /api/health` (200/503) for uptime monitors; workers send heartbeats, and a watchdog emails `SB_ALERT_EMAIL` or
  posts to `SB_ALERT_WEBHOOK_URL` when a worker stops, posts run late, publishing fails repeatedly or backups fail.
- Daily backups with `SB_BACKUP_DIR` (SQLite copy or `pg_dump`, plus uploads), optional S3 copy, pruning;
  `npm run backup` runs one now. Restore steps are in the guide.
- Outbound HTTP proxy support (`SB_PROXY_URL` or `HTTPS_PROXY`/`NO_PROXY`) for crawling and all API calls, with the
  crawler's private-address checks kept.
- CI (`.github/workflows/ci.yml`): typecheck, ESLint, tests on SQLite and PostgreSQL, build.

## Layout

```
design/            Claude Design handoff (prototype, chat transcript, tokens, component specs)
src/app/(app)/     screens
src/app/api/       route handlers
src/components/    shell, UI primitives, studio, wizard, picker, rule drawer
src/lib/           shared types and rules (used by browser and server)
src/server/        database, data access, auth, generator, media, publisher, worker, automations, platform adapters
tests/             node:test unit tests
```
