<p align="center">
  <img src="docs/assets/banner.svg" alt="Social Blast — website-grounded social media content, scheduling and automation for marketing agencies" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Mostafijemon24/Social_Blast/actions/workflows/ci.yml"><img src="https://github.com/Mostafijemon24/Social_Blast/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <img src="https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs" alt="Next.js 15">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-22_LTS-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/database-SQLite%20%7C%20PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="SQLite or PostgreSQL">
  <img src="https://img.shields.io/badge/AI-OpenRouter-6366F1" alt="AI via OpenRouter">
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-integrations-api-setup">API setup</a> ·
  <a href="#-deployment-hosting">Deployment</a> ·
  <a href="#-user-guide">User guide</a> ·
  <a href="#-operations">Operations</a> ·
  <a href="docs/GOING-LIVE.md">বাংলা গাইড</a>
</p>

**Social Blast** is a self-hosted social media platform for marketing agencies that manage many local businesses.
It reads each client's website, turns the real pages into platform-ready posts with AI, and publishes them to
Facebook, Instagram, LinkedIn, X, Pinterest and Google Business Profile on schedule. It then keeps working on its own:
it answers comments with DMs, re-posts proven content, boosts top posts and emails a weekly report.

<p align="center">
  <img src="docs/screenshots/studio.png" alt="AI Content Studio with per-platform captions, image crop, live preview and validation" width="100%">
</p>

---

## Contents

- [Why Social Blast](#-why-social-blast)
- [Features](#-features)
- [Screenshots](#-screenshots)
- [Supported platforms](#-supported-platforms)
- [Quick start](#-quick-start)
- [Configuration](#-configuration)
- [Integrations (API setup)](#-integrations-api-setup)
- [Deployment (hosting)](#-deployment-hosting)
- [Going live checklist](#-going-live-checklist)
- [User guide](#-user-guide)
- [Operations](#-operations)
- [Architecture](#-architecture)
- [Security](#-security)
- [Development](#-development)
- [Troubleshooting](#-troubleshooting)
- [Known limitations](#-known-limitations)
- [License](#-license)

---

## 💡 Why Social Blast

| Problem | How Social Blast solves it |
| --- | --- |
| AI posts that invent prices, offers or services | Every draft is **grounded in pages crawled from the client's own website**. The prompt forbids invented facts, and drafts are validated before they can be scheduled. |
| One caption pasted everywhere | A **separate version per platform**: its own character limit, hashtag rules, title and image crop. |
| Posting depends on someone's browser being open | A **background worker** publishes on time, retries temporary errors and never posts twice. |
| Agencies juggling dozens of clients | **Multi-client workspace** with per-client access for editors and viewers. |
| Engagement work that never ends | **Comment → DM**, **Evergreen re-posting**, **Auto-boost** and a **weekly digest**, all running unattended. |

---

## ✨ Features

### Content
- **Website intelligence:** crawls the client's site (robots.txt, sitemaps, internal links), extracts page text and type, and suggests keywords. You choose which pages the AI may use.
- **AI Content Studio:** a brief plus source pages becomes one post per platform. You can regenerate everything, vary the tone, and write in English, Bengali, Spanish, Hindi, Arabic or French.
- **Live validation:** character limits, near-duplicate detection (90 days), image requirements, Google Business "no hashtags" rule, and grounding checks. The same rules run again on the server before scheduling.
- **Media library:** upload images or video, import from a link, or **create images with AI**. Every image is converted to JPEG, rotated upright, stripped of location data and **cropped per platform** (Instagram 4:5, LinkedIn 1.91:1, X 16:9, Pinterest 2:3, Google 4:3).
- **Bulk import:** CSV/Excel template, row-by-row validation, downloadable error report. Imported rows become *Pending* posts, and their captions are written automatically.
- **Approvals:** owners and admins **Approve** or **Send back** (with a note) posts that wait for review.

### Publishing
- **Official OAuth** for every platform. Tokens are encrypted at rest (AES-256-GCM).
- **Scheduler and calendar:** week, month and day views in each client's time zone. Drag a post to reschedule it.
- **Reliable worker:** retries temporary errors (1, 5 and 15 minutes), flags expired accounts for reconnection, and **never publishes a post twice**, even with several servers.
- **Images and video on every platform:** Instagram Reels, Facebook Page videos, LinkedIn native video, X video, Pinterest video pins.

### Automations
- **Comment → DM:** keyword comments on Facebook or Instagram get a public reply and a private message, and the person is saved to Contacts. Safeguards: one reply per person, the 7-day messaging window, and hand-off to a human for complaints.
- **Evergreen rotation:** re-posts your best published content on chosen weekdays, with weekly limits and a minimum gap before reuse.
- **Auto-boost:** promotes the best-performing Facebook or Instagram post through Meta Ads, with a monthly cap and weekly limit. Ads are **created paused** by default.
- **Weekly digest:** an email to the client with posts, reach, likes, top posts, DMs and new contacts.

### Insight and operations
- **Analytics:** likes, comments, shares, reach and impressions from each platform, shown per post and on the Overview.
- **Team and permissions:** owner, admin, editor and viewer roles, per-client access, email invites, password reset.
- **Super Admin:** job queues, AI spend meters, system logs, email outbox and system health.
- **Production-ready operations:** health endpoint, email or chat alerts, daily backups, PostgreSQL for several servers, HTTP proxy support, and CI.

---

## 🖼 Screenshots

| | |
| :---: | :---: |
| <img src="docs/screenshots/overview.png" alt="Overview dashboard"><br>**Overview:** workspace stats, upcoming posts, crawl status, activity | <img src="docs/screenshots/calendar.png" alt="Calendar month view"><br>**Calendar:** week, month and day, drag to reschedule |
| <img src="docs/screenshots/content-list.png" alt="All content list"><br>**All content:** status filters, approvals, per-post analytics | <img src="docs/screenshots/bulk-import.png" alt="Bulk import"><br>**Bulk import:** CSV/Excel with row-by-row validation |
| <img src="docs/screenshots/website.png" alt="Website intelligence"><br>**Website intelligence:** crawled pages and keyword library | <img src="docs/screenshots/comment-dm.png" alt="Comment to DM rule"><br>**Comment → DM:** keywords, reply, DM, lead capture, safeguards |
| <img src="docs/screenshots/automations.png" alt="Automations"><br>**Automations:** Evergreen, Comment → DM, Auto-boost, Weekly digest | <img src="docs/screenshots/settings.png" alt="Settings"><br>**Settings:** connected accounts and team |
| <img src="docs/screenshots/admin.png" alt="Super Admin"><br>**Super Admin:** queues, system health, AI spend, logs | <img src="docs/screenshots/overview-dark.png" alt="Dark mode"><br>**Dark mode** |

<p align="center">
  <img src="docs/screenshots/mobile-studio.png" alt="Mobile studio" width="260">
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-overview.png" alt="Mobile overview" width="260">
  <br><em>Fully responsive: every screen works on a phone.</em>
</p>

---

## 🌐 Supported platforms

| Platform | Destinations | Text | Image | Video | Analytics | Comment → DM | Auto-boost |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Facebook** | Pages | ✅ | ✅ | ✅ Page video | ✅ likes, comments, shares, reach | ✅ | ✅ |
| **Instagram** | Professional accounts | — ¹ | ✅ | ✅ Reels | ✅ likes, comments, shares, reach | ✅ | ✅ |
| **LinkedIn** | Profile; company pages ² | ✅ | ✅ | ✅ | ✅ likes, comments | — | — |
| **X** | Account | ✅ | ✅ | ✅ | ✅ likes, replies, reposts, impressions | — | — |
| **Pinterest** | Boards | — ¹ | ✅ | ✅ Video pins | ✅ saves, impressions | — | — |
| **Google Business Profile** | Locations | ✅ | ✅ | ✅ ³ | — | — | — |

¹ Instagram and Pinterest require an image or video. ² Company pages need LinkedIn's Community Management API approval.
³ Google doesn't allow video inside posts, so the video is added to the profile's *Photos & videos* and the post is text.

---

## 🚀 Quick start

### Requirements
- **Node.js 22 LTS** (22.13 or newer recommended; the built-in SQLite database needs 22.5+).
- Nothing else for local use: SQLite is built into Node. PostgreSQL is optional.

### Run locally

```bash
git clone https://github.com/Mostafijemon24/Social_Blast.git
cd Social_Blast
npm ci
npm run dev
```

Open <http://localhost:3000> and sign in with the demo owner shown on the login page:

| Email | Password |
| --- | --- |
| `rhea@agency.example` | `socialblast-demo` |

The first start creates `data/social-blast.db` with a demo workspace of three clients, posts, pages, contacts and automations.
`npm run db:reset` deletes it so it is recreated on the next start.

> [!TIP]
> Everything works without API keys. Without `OPENROUTER_API_KEY`, a built-in template writer creates drafts from your facts, so you can explore the whole app first.

### Production build

```bash
cp .env.example .env.local   # then fill in the settings below
npm run build
npm start                    # http://localhost:3000
```

In production there is **no demo account**. The first person to open `/login` creates the **owner** account, which is also the platform operator (Super Admin).

---

## ⚙️ Configuration

All settings are environment variables. Copy [`.env.example`](.env.example) to `.env.local`; it lists every option with comments.

### Essentials

| Variable | Required | Description |
| --- | :---: | --- |
| `APP_URL` | **Production** | Public HTTPS address, e.g. `https://app.example.com`. Used for OAuth callbacks, email links and media URLs that platforms download. |
| `SB_ENCRYPTION_KEY` | **To connect accounts** | 32+ random characters that encrypt stored tokens. Generate with `openssl rand -base64 48`. **Never change it** after accounts are connected. |
| `OPENROUTER_API_KEY` | Recommended | Turns on AI writing and AI images. |
| `OPENROUTER_MODEL` | — | Writing model, default `openai/gpt-4o-mini`. Any model from [openrouter.ai/models](https://openrouter.ai/models). |
| `OPENROUTER_IMAGE_MODEL` | — | Image model, default `google/gemini-2.5-flash-image`. It must be a model that outputs images. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Recommended | Mail server for invites, password resets, digests and alerts. Without it, emails wait in *Super Admin → Email outbox*. |

### Database, storage and worker

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | — | `postgres://user:pass@host:5432/db` switches to PostgreSQL (needed for several servers). |
| `SB_DB_PATH` | `data/social-blast.db` | SQLite file location. |
| `SB_DB_SSL`, `SB_DB_POOL` | `false`, `10` | PostgreSQL TLS and pool size. |
| `SB_SEED`, `SB_DEMO_PASSWORD` | `true`, — | Demo data and demo owner (development). |
| `SB_STORAGE` | `local` | `s3` stores media in an S3-compatible bucket (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`). |
| `SB_UPLOAD_DIR` | `data/uploads` | Local media folder. |
| `SB_MAX_IMAGE_MB`, `SB_MAX_VIDEO_MB` | `15`, `200` | Upload limits. |
| `SB_WORKER` | `on` | `off` on web servers when the worker runs separately (`npm run worker`). |
| `SB_WORKER_TICK_MS` | `15000` | How often the worker checks for work. |
| `SB_CRAWL_MAX_PAGES` | `60` | Pages per crawl. |

### Platforms and automations

| Variable | Description |
| --- | --- |
| `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` | Facebook and Instagram (Graph API version, default `v23.0`). |
| `META_ENGAGEMENT=true`, `META_WEBHOOK_VERIFY_TOKEN` | Comment → DM. |
| `META_ADS=true` | Auto-boost (Meta Marketing API). |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ORG_ACCESS`, `LINKEDIN_API_VERSION` | LinkedIn (company pages need `LINKEDIN_ORG_ACCESS=true`). |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X (OAuth 2.0 with PKCE). |
| `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` | Pinterest. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Business Profile. |
| `SB_IMAGE_PROVIDER=openai`, `OPENAI_API_KEY` | Optional: create AI images directly with OpenAI instead of OpenRouter. |

### Operations

| Variable | Description |
| --- | --- |
| `SB_HEALTH_TOKEN` | Shows health details at `/api/health?token=…`. |
| `SB_ALERT_EMAIL`, `SB_ALERT_WEBHOOK_URL` | Where alerts go (email list, and/or a Slack, Discord, Teams or Google Chat incoming webhook). |
| `SB_WORKER_STALE_SEC`, `SB_ALERT_FAILURES`, `SB_ALERT_REPEAT_MIN` | Alert thresholds (180 s, 5 failures per hour, repeat every 360 min). |
| `SB_BACKUP_DIR`, `SB_BACKUP_HOUR`, `SB_BACKUP_KEEP_DAYS` | Daily backups (folder, UTC hour, retention). |
| `SB_BACKUP_S3_BUCKET`, `SB_BACKUP_S3_PREFIX` | Optional off-site copy of each backup. |
| `SB_PROXY_URL`, `SB_NO_PROXY`, `SB_USE_ENV_PROXY`, `SB_PROXY_RESOLVES_DNS` | Outbound HTTP proxy (otherwise `HTTPS_PROXY`/`NO_PROXY` are used). |

---

## 🔌 Integrations (API setup)

Each platform needs a developer app. The **redirect URL** for every platform follows this pattern:

```
https://app.example.com/api/oauth/<facebook|instagram|linkedin|x|pinterest|gbp>/callback
```

After adding keys, restart the app and go to **Settings → Connect …** (see [Connecting accounts](#connecting-accounts)).

<details open>
<summary><strong>OpenRouter: AI writing and AI images</strong></summary>

1. Sign in at [openrouter.ai](https://openrouter.ai), open **Keys → Create key**, and add credits under **Credits**.
2. Set `OPENROUTER_API_KEY=sk-or-…`.
3. Pick a writing model with `OPENROUTER_MODEL`. Models that support *structured outputs* are the most reliable. Larger models write better posts; smaller ones are cheaper and faster.
4. Pick an image model with `OPENROUTER_IMAGE_MODEL`. Filter the model list by **image output**.
5. The real cost of every request is read from OpenRouter and shown in *Super Admin → AI provider usage*. Image generation stops when the image budget is reached.
</details>

<details>
<summary><strong>Facebook Pages and Instagram (Meta)</strong></summary>

1. At [developers.facebook.com](https://developers.facebook.com), go to **My Apps → Create app**, type **Business**.
2. Add **Facebook Login for Business**. In *Valid OAuth Redirect URIs*, add both `…/api/oauth/facebook/callback` and `…/api/oauth/instagram/callback`.
3. Permissions used: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `read_insights`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`.
4. Your own pages work while you are an app admin. **Client pages need App Review and Business Verification**: Meta asks for a screencast showing how each permission is used.
5. Instagram accounts must be **Professional (Business or Creator)** and linked to a Facebook Page.
6. Set `META_APP_ID` and `META_APP_SECRET`.
7. Media is downloaded by Meta from `APP_URL/media/…`, so the server must be reachable over public HTTPS.
</details>

<details>
<summary><strong>Comment → DM (Meta webhooks)</strong></summary>

1. Request these extra permissions in App Review: `pages_manage_metadata`, `pages_manage_engagement`, `pages_read_user_content`, `pages_messaging`, `instagram_manage_comments`, `instagram_manage_messages`.
2. Set `META_ENGAGEMENT=true` and `META_WEBHOOK_VERIFY_TOKEN=<long random string>`.
3. In the Meta app, open **Webhooks** and subscribe:
   - **Page**, field `feed`
   - **Instagram**, field `comments`

   Use callback `https://app.example.com/api/webhooks/meta` and your verify token for both.
4. Reconnect Facebook and Instagram in Settings, so pages are subscribed and the new permissions are granted.
5. Every webhook is verified with `X-Hub-Signature-256` using `META_APP_SECRET`.
</details>

<details>
<summary><strong>Auto-boost (Meta Marketing API)</strong></summary>

1. Have a Meta **ad account** with a payment method. The person who connects must be an advertiser or admin on it.
2. Add the **Marketing API** product and request `ads_management` and `ads_read`.
3. Set `META_ADS=true`, restart, and reconnect Facebook and Instagram.
4. In **Automations → Auto-boost → Configure**, choose the ad account and set the daily budget, number of days, monthly cap, audience (countries, ages) and the "Create ads paused" safety switch.
</details>

<details>
<summary><strong>LinkedIn</strong></summary>

1. At [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps), click **Create app** (a LinkedIn company page is required).
2. Under **Products**, add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**. This allows posting to personal profiles.
3. To post to **company pages**, apply for the **Community Management API**, then set `LINKEDIN_ORG_ACCESS=true`.
4. Under **Auth**, set the redirect URL `…/api/oauth/linkedin/callback`.
5. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. `LINKEDIN_API_VERSION` (YYYYMM) is optional.
</details>

<details>
<summary><strong>X (Twitter)</strong></summary>

1. At [developer.x.com](https://developer.x.com), create a project and app.
2. Under **User authentication settings**, enable OAuth 2.0: type **Web App (confidential client)**, permissions **Read and write**.
3. Set callback `…/api/oauth/x/callback` and a website URL.
4. Copy the OAuth 2.0 **Client ID** and **Client Secret** into `X_CLIENT_ID` and `X_CLIENT_SECRET`.
5. Scopes used: `tweet.read`, `tweet.write`, `users.read`, `offline.access` and `media.write`. Posting limits depend on your X API plan; regular posting usually needs a paid plan.
</details>

<details>
<summary><strong>Pinterest</strong></summary>

1. At [developers.pinterest.com](https://developers.pinterest.com), go to **My apps → Connect app**.
2. Set redirect URI `…/api/oauth/pinterest/callback`.
3. New apps get **Trial access** (your own account only). Apply for **Standard access** for clients; Pinterest asks for a demo video.
4. Set `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET`.
</details>

<details>
<summary><strong>Google Business Profile</strong></summary>

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable:
   - *My Business Account Management API*
   - *My Business Business Information API*
   - *Google My Business API*
2. Submit the **Business Profile APIs access request** form. The APIs don't work until Google approves it.
3. Configure the **OAuth consent screen** with scope `https://www.googleapis.com/auth/business.manage`. It is a sensitive scope, so Google app verification is needed before other people can use it.
4. Under **Credentials**, create an OAuth client of type *Web application* with redirect URI `…/api/oauth/gbp/callback`.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Hashtags are removed automatically from Google posts.
</details>

<details>
<summary><strong>Email (SMTP)</strong></summary>

Any SMTP provider works (Google Workspace, Amazon SES, Brevo, Mailgun, Postmark…):

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=…
SMTP_PASS=…
SMTP_FROM=Social Blast <no-reply@example.com>
```
</details>

<details>
<summary><strong>S3-compatible storage (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO)</strong></summary>

```env
SB_STORAGE=s3
S3_BUCKET=socialblast-media
S3_REGION=auto                                        # e.g. us-east-1 on AWS
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com  # leave empty on AWS
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

The bucket can stay private: the app serves files itself from `/media/…` using long random file names.
</details>

---

## ☁️ Deployment (hosting)

Social Blast runs as a **long-lived Node.js server** with a background worker, so it needs a VPS or a container platform with a persistent disk (or PostgreSQL + S3).
Serverless-only hosts that stop the process between requests are **not suitable**.

### Option A: a single VPS (recommended start)

A 2 vCPU / 2–4 GB RAM server (Hetzner, DigitalOcean, Linode, AWS Lightsail…) running Ubuntu 22.04 or 24.04 handles many clients.

**1. Install Node.js 22 and the app**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo useradd --system --create-home --home-dir /opt/social-blast socialblast
sudo -u socialblast git clone https://github.com/Mostafijemon24/Social_Blast.git /opt/social-blast/app
cd /opt/social-blast/app
sudo -u socialblast npm ci
sudo -u socialblast cp .env.example .env.local   # edit: APP_URL, SB_ENCRYPTION_KEY, OPENROUTER_API_KEY, SMTP_*, platform keys
sudo -u socialblast npm run build
```

**2. Run it as a service** in `/etc/systemd/system/social-blast.service`:

```ini
[Unit]
Description=Social Blast
After=network.target

[Service]
User=socialblast
WorkingDirectory=/opt/social-blast/app
EnvironmentFile=/opt/social-blast/app/.env.local
Environment=NODE_ENV=production PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now social-blast
sudo journalctl -u social-blast -f     # logs
```

**3. HTTPS with Caddy** (automatic certificates). Put this in `/etc/caddy/Caddyfile`:

```caddyfile
app.example.com {
    request_body {
        max_size 210MB          # video uploads
    }
    reverse_proxy localhost:3000 {
        transport http {
            read_timeout 200s   # AI image generation can take a while
        }
    }
}
```

<details>
<summary>Prefer Nginx?</summary>

```nginx
server {
    server_name app.example.com;
    client_max_body_size 210m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 200s;
    }
    listen 443 ssl; # managed by certbot (sudo certbot --nginx -d app.example.com)
}
```
</details>

**4. Open `https://app.example.com/login`** and create the owner account.

**Updating to a new version**

```bash
cd /opt/social-blast/app
sudo -u socialblast git pull
sudo -u socialblast npm ci
sudo -u socialblast npm run build
sudo systemctl restart social-blast
```

### Option B: several servers (scale out)

```mermaid
flowchart LR
  U[Users] --> LB[Load balancer / HTTPS]
  LB --> W1[Web server 1<br/>SB_WORKER=off]
  LB --> W2[Web server 2<br/>SB_WORKER=off]
  WK[Worker<br/>npm run worker] --> PG[(PostgreSQL)]
  W1 --> PG
  W2 --> PG
  W1 --> S3[(S3 / R2 media)]
  W2 --> S3
  WK --> S3
  WK --> P[Social platforms<br/>OpenRouter · SMTP]
  P -. webhooks .-> LB
```

1. Create a PostgreSQL 14+ database (self-hosted, Neon, Supabase, RDS…) and set `DATABASE_URL` on every server.
2. Set `SB_STORAGE=s3` and the `S3_*` variables so every server sees the same media.
3. Run web servers with `SB_WORKER=off`, and one or more workers with `npm run worker` (as another systemd service with the same `EnvironmentFile`). Every job is claimed atomically, so extra workers never duplicate posts, DMs, boosts or emails.
4. Moving from SQLite? Stop the app and copy everything across in one verified transaction:

```bash
SQLITE_PATH=data/social-blast.db DATABASE_URL=postgres://… npm run db:to-postgres -- --dry-run   # preview
SQLITE_PATH=data/social-blast.db DATABASE_URL=postgres://… npm run db:to-postgres               # copy
SB_STORAGE=s3 S3_BUCKET=… SQLITE_PATH=… DATABASE_URL=… npm run db:to-postgres -- --media         # also copy uploads to S3
```

Keep the same `SB_ENCRYPTION_KEY`, or connected accounts must be reconnected.

---

## ✅ Going live checklist

- [ ] App served over **HTTPS** with `APP_URL` set
- [ ] `SB_ENCRYPTION_KEY` generated and stored somewhere safe
- [ ] Owner account created
- [ ] SMTP configured (invites, resets, digests, alerts)
- [ ] `OPENROUTER_API_KEY` and model chosen
- [ ] Platform apps created, redirect URLs added, keys set
- [ ] App Review / access requests submitted (Meta, LinkedIn, Pinterest, Google)
- [ ] **First live test on each platform** (below)
- [ ] `SB_BACKUP_DIR` set and backups copied off the server
- [ ] Uptime monitor on `/api/health` and `SB_ALERT_EMAIL` / `SB_ALERT_WEBHOOK_URL` set

**First live test, per platform:** connect a test account and turn its destination on. Write a short post (add an image for Instagram and Pinterest). Schedule it 2–3 minutes ahead, then confirm:

1. The post shows **Published** in *All content*.
2. The post really appears on the platform.
3. If it failed, read the reason in *Super Admin → System logs* (`publish.failed`) and in Recent activity.

> [!IMPORTANT]
> Every platform integration follows the official API documentation and is covered by automated tests with simulated platform responses. Run the live test above on each platform with your own keys before onboarding clients.

---

## 📘 User guide

### Roles

| Role | Can do |
| --- | --- |
| **Owner** | Everything, including managing other owners |
| **Admin** | Add clients, connect accounts, manage the team, approve posts, boost |
| **Editor** | Create, generate, edit and schedule content; change automation rules |
| **Viewer** | Read only |
| **Platform operator** (flag) | Super Admin page (the first owner gets it) |

Editors and viewers can be limited to specific clients. They then never see other clients anywhere in the app.

### 1. Add a client
Use the **client switcher** (top left) and choose **Add client**: name, location, website and time zone. Each client has its own accounts, content, calendar and automations.

### 2. Teach it the website
Open **Website Intelligence** and click **Rescan** (the first crawl can also run from the Generate wizard). Then:
- **Include or exclude** pages. The AI only uses included pages.
- Edit the **keyword library** (primary, secondary, optional).
- Set the **target location** (it is only ever set by you, never guessed).

### Connecting accounts
Go to **Settings → Connect Facebook** (or another platform) and approve access on the platform. New pages, boards and locations arrive **switched off**: open **Manage** and turn on only the ones you want to publish to. If a token expires, the account shows **Reconnect**.

### 3. Create posts
- Click **Generate posts** (top right) for the 6-step wizard: client & website → crawl → target location → keywords & sources → content requirements (platforms, tone, language) → generate.
- Or work in the **AI Content Studio**: write a brief, **Regenerate all platforms**, **Vary tone**, edit each platform's caption, title and hashtags, and watch the **live preview** and **validation**.
- **Image or video:** use **Upload**, **Create with AI** (describe the picture, pick square, portrait or landscape), **Library**, or **From a link**. Add a description (alt text) for accessibility.

### 4. Schedule
Click **Schedule**, pick destinations and a time (in the client's time zone). Blocking issues must be fixed first. The worker publishes on time; you can close the browser. Drag posts on the **Calendar** to reschedule.

### 5. Bulk import
In **Content → Bulk import**, download the CSV or Excel template, fill in topics, platforms, destinations and dates, then upload. Check the row-by-row validation (download the error report if needed) and import the valid rows. They become **Pending** posts, and their captions are written automatically.

### 6. Approve
In **All content → Pending**, owners and admins click **Approve** (validated and scheduled) or **Send back** (returned to drafts with your note).

### 7. Automations
| Automation | Set up in *Automations → Configure* |
| --- | --- |
| **Evergreen rotation** | Posts per week, allowed days, days before reuse, and whether each re-post needs approval |
| **Comment → DM** | Trigger keywords, public reply, DM text (`{name}` inserts the person's name), lead tag, safeguards |
| **Auto-boost** | Ad account, minimum interactions, daily budget, days, monthly cap, boosts per week, audience, and "create paused" |
| **Weekly digest** | Recipients and send day. Use *Send a test to me* to preview it. |

### 8. Contacts and analytics
**Contacts** lists everyone captured by Comment → DM, with tags and status (cases handed to a human show as *Pending*). Likes, comments, shares and reach appear on each published post in *All content* and in **Overview → Performance** (refreshed hourly for two days, then every 12 hours, for 30 days).

### 9. Team
In **Settings → Team**, invite people by email (they set their own password; the link expires in 7 days) or set a temporary password. Choose their role and which clients they may see. You can also send a password reset link from here.

---

## 🛠 Operations

### Health check and alerts
- `GET /api/health` returns **200** when the database works and a worker is alive, and **503** otherwise. Point an uptime monitor (UptimeRobot, Better Stack, Uptime Kuma) at it. A server that is completely down can't send its own alert.
- With `SB_HEALTH_TOKEN` set, `/api/health?token=…` shows workers, problems and the last backup. The same data is shown in **Super Admin → System health**.
- Alerts go to `SB_ALERT_EMAIL` and/or `SB_ALERT_WEBHOOK_URL` when:
  - the worker stops
  - posts are more than 10 minutes late
  - 5+ posts fail within an hour
  - a backup fails or is overdue
  - the database is unreachable

  Each problem alerts once, repeats every 6 hours while it lasts, and sends **Resolved** when fixed. With several servers, only one server sends each alert.

### Backups and restore
Set `SB_BACKUP_DIR`. The worker then backs up daily at `SB_BACKUP_HOUR` (UTC):
- the database: a SQLite copy (`.sqlite.gz`), or `pg_dump` (`.dump`) for PostgreSQL, which needs PostgreSQL client tools
- the local uploads folder (`.tar.gz`)

Optionally each backup is also copied to `SB_BACKUP_S3_BUCKET`. Files older than `SB_BACKUP_KEEP_DAYS` are removed. To back up right now:

```bash
SB_BACKUP_DIR=/var/backups/socialblast npm run backup
```

Restore (stop the app first):

```bash
# SQLite
gunzip -k socialblast-db-<date>.sqlite.gz && cp socialblast-db-<date>.sqlite data/social-blast.db
# PostgreSQL
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" socialblast-db-<date>.dump
# Media
mkdir -p data/uploads && tar -xzf socialblast-uploads-<date>.tar.gz -C data/uploads
```

### Outbound proxy
For networks that only reach the internet through a proxy, set `SB_PROXY_URL=http://user:pass@proxy:3128` (or rely on `HTTPS_PROXY`/`NO_PROXY`).
Crawling, platform APIs, OpenRouter and alert webhooks go through it; SMTP and S3 connect directly. The crawler still refuses private and local addresses. If the server can only resolve names through the proxy, set `SB_PROXY_RESOLVES_DNS=true`, and make sure the proxy itself blocks your internal network.

---

## 🏗 Architecture

```mermaid
flowchart TB
  subgraph Browser
    UI[Next.js React UI]
  end
  subgraph Server[Node.js server]
    API[API routes<br/>auth · roles · validation]
    W[Background worker]
  end
  DB[(SQLite or PostgreSQL)]
  ST[(Local disk or S3)]
  UI --> API --> DB
  API --> ST
  W --> DB
  W -->|publish · stats · DMs · boosts| SP[Facebook · Instagram · LinkedIn<br/>X · Pinterest · Google]
  W -->|captions| OR[OpenRouter]
  API -->|drafts · images| OR
  W -->|crawl| SITE[Client websites]
  W -->|digests · alerts| MAIL[SMTP / chat webhook]
  SP -. comment webhooks .-> API
```

**Stack:**
- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS with design tokens (`src/styles/tokens.css`), Phosphor icons
- SQLite through Node's built-in `node:sqlite`, or PostgreSQL through `pg`
- sharp for image processing, ExcelJS for spreadsheets, undici for SSRF-safe fetching, nodemailer for email

```
src/app/(app)/        screens (overview, content, calendar, automations, contacts, settings, website, admin)
src/app/(public)/     login, forgot password, invite and reset pages
src/app/api/          route handlers (auth, clients, posts, media, oauth, webhooks, health…)
src/app/media/        public media file serving for platforms
src/components/       app shell, UI primitives, studio, media panel, wizard, rule drawer, team
src/lib/              shared types and rules used by browser and server (validation, platforms, time, CSV)
src/server/           database, data access, auth, AI generator, crawler, media, publisher, worker,
                      automations, engagement, boost, monitor, backup, proxy
src/server/platforms/ one adapter per platform (OAuth, publish, stats)
scripts/              db:to-postgres migration, backup
tests/                node:test suites (run on SQLite and PostgreSQL)
docs/                 GOING-LIVE.md (Bengali), screenshots, assets
```

**How publishing stays safe:**
- Scheduling creates one job per destination, keyed by *post × destination × time*.
- A worker claims a job with a conditional update, so no two workers can take the same job.
- Temporary failures retry with backoff.
- A job interrupted by a restart is marked failed instead of being re-sent, because it might already be live.

---

## 🔒 Security

- **Passwords:** salted scrypt hashes.
- **Sessions:** random tokens stored as SHA-256 hashes, in `HttpOnly`, `SameSite=Lax` cookies (`Secure` in production).
- **Login:** lockout after repeated failures.
- **Requests:** cross-site write protection (Origin check), and role and per-client access checks on every API route.
- **Social tokens:** encrypted with AES-256-GCM (`SB_ENCRYPTION_KEY`).
- **OAuth:** single-use state bound to the user; PKCE for X.
- **Invite and reset links:** one-time, expiring, stored hashed.
- **Crawler:** blocks private networks, localhost and cloud metadata addresses (including DNS rebinding) and respects robots.txt.
- **Webhooks:** Meta signatures verified with HMAC-SHA256.
- **Media:** unguessable file names, and images re-encoded with location data removed.

---

## 🧑‍💻 Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with demo data |
| `npm run build` / `npm start` | Production build and server |
| `npm run worker` | Standalone background worker |
| `npm test` | Test suite on SQLite |
| `DATABASE_URL=postgres://… npm run test:pg` | Same suite on PostgreSQL |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run db:reset` | Delete the local SQLite database (re-seeded on next start) |
| `npm run db:to-postgres` | Copy a SQLite database into PostgreSQL |
| `npm run backup` | Make a backup now |

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs typecheck, lint, both test suites and the production build on every push and pull request.

---

## 🩺 Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Set APP_URL on the server" | Set `APP_URL` to the public HTTPS address and restart. |
| Connect says "… isn't set up yet" | Add that platform's client ID and secret, plus `SB_ENCRYPTION_KEY`, then restart. |
| OAuth error "redirect URI mismatch" | The redirect URL in the platform app must exactly match `APP_URL/api/oauth/<platform>/callback`. |
| Instagram or Facebook can't fetch the image | The server must be publicly reachable over HTTPS at `APP_URL`. Check that `/media/…` opens from outside. |
| Post failed with "Account needs to be reconnected" | The token expired or was revoked. Use **Reconnect** in Settings. |
| X image or video upload refused | Reconnect the X account so it grants `media.write`. |
| AI says "out of credits" or rejects the key | Check `OPENROUTER_API_KEY` and add credits on OpenRouter. |
| "returned no image" | `OPENROUTER_IMAGE_MODEL` must be a model that outputs images. |
| No comments arrive for Comment → DM | Check the webhook subscriptions, `META_ENGAGEMENT=true` and the verify token, then reconnect the accounts. |
| Emails never arrive | Set `SMTP_*`. Until then, messages wait in *Super Admin → Email outbox*. |
| Uploads of large videos fail | Raise the reverse proxy body limit (210 MB in the examples) and `SB_MAX_VIDEO_MB`. |
| Health shows "No worker is running" | The worker is off (`SB_WORKER=off`) and `npm run worker` isn't running, or it crashed. Check the service logs. |

---

## ⚠️ Known limitations

- Platform integrations have not yet been verified against the live platforms with production keys; run the [first live test](#-going-live-checklist) on each.
- Google Business Profile posts can't contain video (the video goes to the profile's media instead).
- Facebook **video** posts can't be boosted from Social Blast; boost them in Meta Ads Manager.
- Video length is checked by each platform, not before upload.
- SMTP and S3 connections don't go through the HTTP proxy.

---

## 📄 License

No license has been chosen for this project yet. Until one is added, all rights are reserved by the repository owner.

<p align="center"><sub>Built for agencies that want social media to run itself, without making things up.</sub></p>
