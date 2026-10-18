# Social Blast লাইভ করার গাইড

এই গাইডে আছে: সার্ভার সেটআপ, প্রতিটা সোশ্যাল প্ল্যাটফর্মের app key নেওয়া, ওয়েবসাইট ক্রল, আসল পাবলিশিং, ছবি/ভিডিও, AI ছবি, Comment → DM, Evergreen, Weekly digest, Analytics, Auto-boost বিজ্ঞাপন আর PostgreSQL (পুরোনো ডেটা স্থানান্তরসহ)। কোড তৈরি আছে; বাকি কাজগুলো হলো **অ্যাকাউন্ট খোলা, অনুমোদন নেওয়া আর সার্ভারে সেটিং বসানো**।

> **গুরুত্বপূর্ণ:** প্রতিটা প্ল্যাটফর্মের সাথে সংযোগের কোড official API ডকুমেন্টেশন অনুযায়ী লেখা এবং নকল (simulated) রেসপন্স দিয়ে টেস্ট করা হয়েছে, কিন্তু **আসল প্ল্যাটফর্মে এখনো টেস্ট হয়নি** (app key ছাড়া সম্ভব না)। তাই প্রতিটা প্ল্যাটফর্ম চালুর পর ধাপ ৫-এর টেস্টটা অবশ্যই করবেন। কোনো API ভার্সন বদলালে `META_GRAPH_VERSION` বা `LINKEDIN_API_VERSION` সেটিং দিয়ে আপডেট করা যায়।

---

## ১. সার্ভার প্রস্তুত করা

**যা লাগবে**
- Node.js **22.5 বা নতুন** ভার্সন
- একটা ডোমেইন আর **HTTPS** (যেমন `https://app.yourdomain.com`)। সোশ্যাল প্ল্যাটফর্মগুলো HTTPS ছাড়া লগইন ফেরত পাঠায় না।
- স্থায়ী ডিস্ক — ডাটাবেস `data/social-blast.db` ফাইলে আর আপলোড করা ছবি/ভিডিও `data/uploads`-এ থাকে। এগুলো মুছে গেলে ডেটা চলে যাবে। (একাধিক সার্ভারে চালাতে চাইলে ধাপ ১১ দেখুন — PostgreSQL আর S3।)
- সার্ভার থেকে ইন্টারনেটে সরাসরি যাওয়ার সুবিধা (ক্রল আর পাবলিশের জন্য)।

**একটা সাধারণ VPS-এ (Ubuntu) উদাহরণ**
```bash
git clone https://github.com/Mostafijemon24/Social_Blast
cd Social_Blast
npm ci
cp .env.example .env.local     # তারপর নিচের সেটিংগুলো বসান
npm run build
npm start                      # পোর্ট 3000-এ চলবে
```
সার্ভার বন্ধ হলে আবার চালু রাখতে `pm2` বা `systemd` ব্যবহার করুন, আর সামনে **Caddy** বা **Nginx** দিয়ে HTTPS দিন। Caddy সবচেয়ে সহজ:
```
app.yourdomain.com {
    reverse_proxy localhost:3000
}
```

**প্রথম লগইন:** production-এ কোনো অ্যাকাউন্ট থাকে না। প্রথমবার `/login` খুললে Owner অ্যাকাউন্ট তৈরির ফর্ম আসবে — এটাই Super Admin।

**ব্যাকআপ আর সতর্কবার্তা:** ধাপ ১৪ দেখুন — `SB_BACKUP_DIR` দিলেই প্রতিদিন নিজে থেকে ব্যাকআপ হয়।

---

## ২. সার্ভারের সেটিং (`.env.local`)

| সেটিং | কেন দরকার |
| --- | --- |
| `APP_URL=https://app.yourdomain.com` | ইমেইল লিংক আর সোশ্যাল লগইন ফেরত আসার ঠিকানা। **বাধ্যতামূলক।** |
| `SB_ENCRYPTION_KEY=...` | সোশ্যাল অ্যাকাউন্টের token এনক্রিপ্ট করে রাখার চাবি। **বাধ্যতামূলক।** নিচের কমান্ডে তৈরি করুন। |
| `OPENROUTER_API_KEY=...` | OpenRouter দিয়ে পোস্ট লেখা ও AI ছবি (না দিলে টেমপ্লেট রাইটার চলে)। |
| `OPENROUTER_MODEL=...` | কোন মডেল দিয়ে লেখা হবে (ডিফল্ট `openai/gpt-4o-mini`)। |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | আমন্ত্রণ ও পাসওয়ার্ড রিসেট ইমেইল (যেমন Gmail Workspace, Brevo, Mailgun, Amazon SES)। |
| প্ল্যাটফর্মের key | নিচে ধাপ ৩-এ প্রতিটার জন্য আলাদা। |
| `SB_CRAWL_MAX_PAGES=60` | একবারে সর্বোচ্চ কত পেজ ক্রল হবে। |
| `SB_WORKER=off` | শুধু তখন, যখন worker আলাদা প্রসেসে চালাবেন (ধাপ ৬)। |
| `OPENROUTER_IMAGE_MODEL=...` | কোন মডেল দিয়ে ছবি তৈরি হবে (ধাপ ৮)। |
| `META_WEBHOOK_VERIFY_TOKEN`, `META_ENGAGEMENT=true` | Comment → DM (ধাপ ৯)। |
| `DATABASE_URL=postgres://...` | PostgreSQL (ধাপ ১১)। না দিলে SQLite। |
| `META_ADS=true` | Auto-boost বিজ্ঞাপন (ধাপ ১২)। |
| `SB_STORAGE=s3` + `S3_*` | ছবি/ভিডিও S3/R2-তে রাখা (ধাপ ১১)। |
| `SB_MAX_IMAGE_MB=15`, `SB_MAX_VIDEO_MB=200` | আপলোডের সর্বোচ্চ সাইজ। |

**OpenRouter (AI দিয়ে লেখা ও ছবি):**
1. https://openrouter.ai → Sign in → **Keys** → *Create Key*। **Credits** পেজে কিছু ক্রেডিট যোগ করুন।
2. সার্ভারে বসান: `OPENROUTER_API_KEY=sk-or-...`
3. মডেল বাছুন (openrouter.ai/models থেকে মডেলের নাম কপি করুন): `OPENROUTER_MODEL=openai/gpt-4o-mini` (সস্তা ও দ্রুত; ভালো লেখা চাইলে আরও বড় মডেল দিন)। যে মডেল "structured outputs" সাপোর্ট করে সেগুলো সবচেয়ে নির্ভরযোগ্য।
4. প্রতিটা লেখার আসল খরচ OpenRouter থেকে এনে **Super Admin → AI provider usage**-এ দেখায়।

এনক্রিপশন চাবি তৈরি:
```bash
openssl rand -base64 48
```
> এই চাবি একবার বসানোর পর **আর বদলাবেন না** — বদলালে সব সোশ্যাল অ্যাকাউন্ট আবার কানেক্ট করতে হবে। চাবিটা নিরাপদ জায়গায় আলাদা করে রেখে দিন।

সেটিং বদলানোর পর সার্ভার রিস্টার্ট করুন।

---

## ৩. প্রতিটা প্ল্যাটফর্মের app key নেওয়া

সব প্ল্যাটফর্মে **Redirect / Callback URL** এই ফরম্যাটে দিতে হবে (নিজের ডোমেইন বসিয়ে):

```
https://app.yourdomain.com/api/oauth/<platform>/callback
```
যেখানে `<platform>` = `facebook`, `instagram`, `linkedin`, `x`, `pinterest`, বা `gbp`।

### ৩.১ Facebook Pages ও Instagram (Meta)
1. https://developers.facebook.com → **My Apps → Create App** → ধরন **Business**।
2. **Facebook Login for Business** প্রোডাক্ট যোগ করুন। *Valid OAuth Redirect URIs*-এ দুটোই দিন:
   - `https://app.yourdomain.com/api/oauth/facebook/callback`
   - `https://app.yourdomain.com/api/oauth/instagram/callback`
3. যে permission লাগবে: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `read_insights`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`। (Comment → DM-এর জন্য আরও কিছু — ধাপ ৯।)
4. নিজের পেজে টেস্ট করতে App Review লাগে না (আপনি app-এর admin হলে)। **ক্লায়েন্টদের পেজের জন্য** App Review আর **Business Verification** লাগবে — Meta-কে স্ক্রিনকাস্ট ভিডিও দিয়ে দেখাতে হয় অ্যাপ permission কীভাবে ব্যবহার করে।
5. Instagram অবশ্যই **Professional (Business/Creator) অ্যাকাউন্ট** হতে হবে এবং একটা Facebook Page-এর সাথে লিংক করা থাকতে হবে।
6. সার্ভারে বসান:
   ```
   META_APP_ID=...
   META_APP_SECRET=...
   # ঐচ্ছিক: META_GRAPH_VERSION=v23.0
   ```
7. **Instagram-এ ছবি বা ভিডিও বাধ্যতামূলক।** Studio-তে Upload / Create with AI / Library দিয়ে যোগ করুন। Instagram আর Facebook ছবিটা আপনার সার্ভারের `APP_URL/media/...` থেকে ডাউনলোড করে, তাই সার্ভার অবশ্যই ইন্টারনেট থেকে HTTPS-এ খোলা যেতে হবে।
8. ভিডিও: Facebook-এ Page video, Instagram-এ **Reel** হিসেবে যায় (MP4, 9:16 ভালো, Instagram-এর সীমা: সর্বোচ্চ প্রায় ১৫ মিনিট/৩০০ MB)। Instagram ভিডিও প্রসেস করতে সময় নেয়; worker অপেক্ষা করে, দেরি হলে পরে আবার চেষ্টা করে।

### ৩.২ LinkedIn
1. https://www.linkedin.com/developers/apps → **Create app** (একটা LinkedIn Company Page লাগবে)।
2. **Products** ট্যাবে যোগ করুন: **Sign In with LinkedIn using OpenID Connect** আর **Share on LinkedIn**। এতে ব্যক্তিগত প্রোফাইলে পোস্ট করা যায়।
3. **Company Page-এ পোস্ট** করতে **Community Management API** প্রোডাক্টের জন্য আবেদন করতে হয় (LinkedIn অনুমোদন দেয়)। অনুমোদন পেলে `LINKEDIN_ORG_ACCESS=true` দিন।
4. **Auth** ট্যাবে Redirect URL: `https://app.yourdomain.com/api/oauth/linkedin/callback`
5. সার্ভারে বসান:
   ```
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   # অনুমোদন পেলে: LINKEDIN_ORG_ACCESS=true
   # ঐচ্ছিক: LINKEDIN_API_VERSION=202509   (YYYYMM ফরম্যাট)
   ```
6. বর্তমানে LinkedIn-এ **টেক্সট (আর লিংক) পোস্ট** যায়; ছবি আপলোড এখনো যুক্ত হয়নি।

> LinkedIn-এ এখন **ছবি আর ভিডিও** যায় (Images API ও Videos API; ভিডিও ৩ সেকেন্ড – ৩০ মিনিট, MP4)। Likes/comments সংখ্যা আসে; reach শুধু Company page-এর জন্য LinkedIn দেয়, তাই দেখানো হয় না।

### ৩.৩ X (Twitter)
1. https://developer.x.com → Project আর App তৈরি করুন।
2. **User authentication settings** → OAuth 2.0 চালু করুন, App type: **Web App (Confidential client)**, permission: **Read and write**।
3. Callback URI: `https://app.yourdomain.com/api/oauth/x/callback`, Website URL দিন।
4. **Keys and tokens** থেকে OAuth 2.0 Client ID আর Client Secret নিন।
5. X-এর API-তে পোস্ট করার সীমা আপনার প্ল্যান (Free/Basic/Pro) অনুযায়ী। নিয়মিত পোস্টের জন্য সাধারণত paid plan লাগে — বর্তমান সীমা X-এর সাইটে দেখে নিন।
6. সার্ভারে বসান:
   ```
   X_CLIENT_ID=...
   X_CLIENT_SECRET=...
   ```
7. X-এ টেক্সট আর **ছবি** যায় (v2 media upload, `media.write` permission)। আগে কানেক্ট করা X অ্যাকাউন্ট একবার **Reconnect** করুন, যাতে নতুন permission পায়। **ভিডিও**-ও যায় (chunked upload); বেশিরভাগ X অ্যাকাউন্টে সর্বোচ্চ ২ মিনিট ২০ সেকেন্ড আর ৫১২ MB, MP4 (H.264/AAC)।

### ৩.৪ Pinterest
1. https://developers.pinterest.com → **My apps → Connect app**।
2. Redirect URI: `https://app.yourdomain.com/api/oauth/pinterest/callback`
3. শুরুতে **Trial access** পাবেন (শুধু নিজের অ্যাকাউন্টে টেস্ট)। ক্লায়েন্টদের জন্য **Standard access**-এর আবেদন করতে হবে — Pinterest একটা ডেমো ভিডিও চায়।
4. সার্ভারে বসান:
   ```
   PINTEREST_APP_ID=...
   PINTEREST_APP_SECRET=...
   ```
5. Pinterest-এ **ছবি বাধ্যতামূলক** (Image URL)। Pin যায় আপনি যে বোর্ড চালু করবেন সেখানে।

### ৩.৫ Google Business Profile
1. https://console.cloud.google.com → নতুন Project।
2. **APIs & Services → Library** থেকে চালু করুন: *My Business Account Management API*, *My Business Business Information API*, আর *Google My Business API* (local posts-এর জন্য)।
3. এই API-গুলো ব্যবহারের জন্য Google-এর কাছে **access request** ফর্ম জমা দিতে হয় (Business Profile APIs access request)। অনুমোদন না পাওয়া পর্যন্ত কাজ করবে না।
4. **OAuth consent screen** তৈরি করুন, scope যোগ করুন: `https://www.googleapis.com/auth/business.manage`। এটা sensitive scope, তাই অন্যদের জন্য চালুর আগে Google-এর **app verification** লাগবে।
5. **Credentials → Create OAuth client ID** → Web application → Authorized redirect URI: `https://app.yourdomain.com/api/oauth/gbp/callback`
6. সার্ভারে বসান:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
7. Google Business-এ হ্যাশট্যাগ যায় না; অ্যাপ নিজেই সরিয়ে দেয়।

---

## ৪. অ্যাপের ভেতরে অ্যাকাউন্ট কানেক্ট করা

1. Owner বা Admin হিসেবে লগইন করুন, উপরের বাম দিক থেকে সঠিক **ক্লায়েন্ট** বেছে নিন।
2. **Settings → Connect Facebook** (বা অন্য প্ল্যাটফর্ম) চাপুন → প্ল্যাটফর্মের অনুমতি পেজে **Allow** দিন।
3. ফিরে আসার পর নতুন পেজ/প্রোফাইল/বোর্ড/লোকেশনগুলো **বন্ধ (off)** অবস্থায় থাকে। **Manage** খুলে শুধু যেগুলোতে পোস্ট করতে চান সেগুলো **চালু** করুন।
4. Token মেয়াদ শেষ হলে বা প্রত্যাখ্যাত হলে অ্যাকাউন্টে **Reconnect** দেখাবে — আবার কানেক্ট করলেই ঠিক হবে। ডেমো ডেটার অ্যাকাউন্টগুলোর কোনো আসল token নেই, তাই সেগুলোতে পাবলিশ ব্যর্থ হবে — আসল অ্যাকাউন্ট কানেক্ট করুন।

---

## ৫. প্রথম লাইভ টেস্ট (প্রতিটা প্ল্যাটফর্মে একবার)

1. একটা টেস্ট পেজ/অ্যাকাউন্ট কানেক্ট করে চালু করুন।
2. Content Studio-তে একটা ছোট পোস্ট লিখুন (Instagram/Pinterest হলে Image URL দিন)।
3. **Schedule** → সেই destination বেছে নিন → সময় দিন **২-৩ মিনিট পরে**।
4. সময় পার হলে দেখুন:
   - **All content**-এ পোস্ট **Published** হয়েছে কিনা।
   - প্ল্যাটফর্মে পোস্টটা আসলে এসেছে কিনা।
   - ব্যর্থ হলে **Super Admin → System logs**-এ `publish.failed` লাইনে কারণ লেখা থাকে, আর Overview-এর Recent activity-তেও দেখায়।
5. অস্থায়ী সমস্যা (rate limit, সার্ভার এরর) হলে অ্যাপ নিজেই ১, ৫ ও ১৫ মিনিট পর আবার চেষ্টা করে। স্থায়ী সমস্যা হলে সাথে সাথে ব্যর্থ দেখায় — একই পোস্ট কখনো দুবার পাঠায় না।

---

## ৬. Background worker (পাবলিশ ও ক্রল)

- Worker সার্ভারের সাথেই চালু হয় এবং প্রতি ১৫ সেকেন্ডে দেখে কোন পোস্টের সময় হয়েছে আর কোন ক্রল অপেক্ষায় আছে। ব্রাউজার খোলা রাখার দরকার নেই।
- Worker যা করে: সময় হওয়া পোস্ট পাঠানো, ক্রল, bulk import-এর ক্যাপশন লেখা, Comment → DM-এর উত্তর, Evergreen, Weekly digest আর Analytics (likes/reach) আনা।
- SQLite-এ **শুধু একটা সার্ভার চালান**। একাধিক সার্ভার লাগলে PostgreSQL ব্যবহার করুন (ধাপ ১১) — তখন worker যতগুলো খুশি চালাতে পারেন, একই কাজ দুবার হবে না।
- চাইলে worker আলাদা প্রসেসে চালাতে পারেন: ওয়েব সার্ভারে `SB_WORKER=off` দিন আর আলাদাভাবে চালান:
  ```bash
  npm run worker
  ```
- সার্ভার রিস্টার্টের সময় কোনো পোস্ট পাঠানোর মাঝপথে থাকলে সেটা আবার পাঠানো হয় না (ডুপ্লিকেট এড়াতে)। সেটা "Interrupted" হিসেবে ব্যর্থ দেখায় — প্ল্যাটফর্মে দেখে নিয়ে দরকার হলে আবার শিডিউল করুন।

---

## ৭. ওয়েবসাইট ক্রল

1. ক্লায়েন্ট যোগ করার সময় (বা পরে) **Website URL** দিন।
2. **Website Intelligence → Crawl now / Rescan** চাপুন। ক্রল background-এ চলে, পেজে progress দেখায়।
3. ক্রলার যা করে:
   - `robots.txt` মেনে চলে (`SocialBlastBot` নামে), sitemap আর ভেতরের লিংক থেকে পেজ খোঁজে।
   - প্রতিটা পেজের title, description, heading, মূল লেখা, পেজের ধরন (Service, Location, Blog…) সংরক্ষণ করে।
   - keyword সাজেস্ট করে (search volume বানিয়ে দেখায় না)।
   - আপনার Include/Exclude বাছাই পরের ক্রলেও বজায় থাকে; বদলে যাওয়া পেজ চিহ্নিত হয়।
   - নিরাপত্তার জন্য localhost, প্রাইভেট নেটওয়ার্ক বা cloud metadata ঠিকানায় যায় না।
4. ক্রল করা পেজের লেখা AI মডেলকে পাঠানো হয়, তাই পোস্টগুলো ওয়েবসাইটের আসল তথ্যের উপর ভিত্তি করে লেখা হয়।
5. সার্ভার যদি HTTP proxy দিয়ে ইন্টারনেটে যায়, ধাপ ১৫ দেখুন।

---

## ৮. ছবি, ভিডিও আর AI ছবি

- Studio-তে **Upload** দিয়ে JPEG/PNG/WebP/GIF ছবি বা MP4/MOV ভিডিও দিন। ছবি স্বয়ংক্রিয়ভাবে JPEG করে প্রতিটা প্ল্যাটফর্মের মাপে কাটা হয় (Instagram 4:5, LinkedIn 1200×627, X 16:9, Pinterest 2:3, Google 4:3; Facebook আসল আকারে)। ছবির লোকেশন তথ্য (GPS) মুছে ফেলা হয়।
- **From a link**: লিংক থেকে ছবি একবার ডাউনলোড করে লাইব্রেরিতে রাখে।
- **Create with AI** চালু করতে:
  1. লেখার জন্য যে `OPENROUTER_API_KEY` দিয়েছেন, ছবিও সেটা দিয়েই হয় — আলাদা key লাগে না।
  2. ছবি বানাতে পারে এমন মডেল বেছে বসান: `OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image` (ডিফল্ট এটাই)। openrouter.ai/models-এ "image output" ফিল্টার দিয়ে অন্য মডেল দেখতে পারেন।
  3. খরচ OpenRouter যা জানায় তা **Super Admin → AI provider usage → AI images**-এ জমা হয়; budget শেষ হলে নতুন ছবি তৈরি বন্ধ থাকে।
  4. চাইলে OpenRouter-এর বদলে সরাসরি OpenAI: `SB_IMAGE_PROVIDER=openai` আর `OPENAI_API_KEY=sk-...`।
- ভিডিও সব প্ল্যাটফর্মে যায়:
  - Facebook → Page video; Instagram → Reel; LinkedIn → নেটিভ ভিডিও; X → ভিডিও টুইট; Pinterest → Video Pin (৪ সেকেন্ড – ১৫ মিনিট, cover ছবি ভিডিওর ১ম সেকেন্ড থেকে)।
  - **Google Business Profile:** Google-এর পোস্টে ভিডিও রাখা যায় না, তাই ভিডিওটা প্রোফাইলের **Photos & videos**-এ যোগ হয় আর পোস্টটা টেক্সট হিসেবে যায়। Validation-এ এটা হলুদ "Review" হিসেবে দেখায়।
  - প্রতিটা প্ল্যাটফর্ম ভিডিও প্রসেস করতে সময় নেয়; worker অপেক্ষা করে, বেশি দেরি হলে পোস্ট না করেই পরে আবার চেষ্টা করে (তাই ডুপ্লিকেট হয় না)।
  - ভিডিওর দৈর্ঘ্য অ্যাপ নিজে মাপে না — প্ল্যাটফর্মের সীমা পেরোলে প্ল্যাটফর্ম ফেরত দেয় আর কারণটা Recent activity-তে দেখায়।

---

## ৯. Comment → DM (Meta webhooks)

কেউ Facebook Page বা Instagram পোস্টে keyword (যেমন "price") লিখলে অ্যাপ নিজে থেকে কমেন্টের নিচে উত্তর দেয়, একটা DM পাঠায়, আর লোকটাকে Contacts-এ রাখে।

1. **Permission** (Meta App → App Review): `pages_manage_metadata`, `pages_manage_engagement`, `pages_read_user_content`, `pages_messaging`, `instagram_manage_comments`, `instagram_manage_messages`। ক্লায়েন্টদের পেজের জন্য App Review আর Business Verification লাগবে।
2. সার্ভারে বসান:
   ```
   META_ENGAGEMENT=true
   META_WEBHOOK_VERIFY_TOKEN=একটা-লম্বা-গোপন-লেখা   # openssl rand -hex 24
   ```
3. Meta App → **Webhooks**:
   - **Page** অবজেক্ট: Callback URL `https://app.yourdomain.com/api/webhooks/meta`, Verify token = উপরের টোকেন, field **feed** subscribe করুন।
   - **Instagram** অবজেক্ট: একই URL আর টোকেন, field **comments** subscribe করুন।
4. সেটিং বদলের পর Settings থেকে Facebook আর Instagram **আবার কানেক্ট** করুন — তখন নতুন permission নেয় এবং Page-কে webhook-এ যুক্ত করে।
5. Automations → Comment → DM → Configure: keyword, পাবলিক উত্তর, DM লেখা (`{name}` লিখলে মানুষের নাম বসে), tag। তারপর চালু করুন।
6. নিরাপত্তা নিয়ম:
   - একই মানুষকে একই পোস্টে একবারই উত্তর।
   - Meta-র নিয়মে কমেন্টের ৭ দিনের মধ্যে একটাই DM।
   - অভিযোগ (refund, scam, worst…) বা খুব লম্বা কমেন্ট হলে অটো-উত্তর না দিয়ে Contacts-এ "Needs reply" হিসেবে রাখে।
7. Automations পেজে **Recent comments** অংশে প্রতিটা কমেন্টের ফলাফল দেখা যায়। Webhook-এর সিগনেচার (`X-Hub-Signature-256`) `META_APP_SECRET` দিয়ে যাচাই হয়, নকল অনুরোধ বাতিল হয়।

---

## ১০. Evergreen, Weekly digest, Approve আর Analytics

- **Evergreen:** নির্বাচিত দিনে সকাল ১০টায় (ক্লায়েন্টের টাইমজোন) একটা পুরোনো পাবলিশড পোস্ট আবার দেয় — দিনে সর্বোচ্চ একটা, সপ্তাহে সেটিং অনুযায়ী। যে পোস্টে likes/comments বেশি সেটা আগে। "Require approval" চালু থাকলে কপিটা Pending-এ অপেক্ষা করে।
- **Pending → Approve:** All content → Pending-এ Owner/Admin **Approve** চাপলে পোস্ট যাচাই হয়ে শিডিউল হয়; সমস্যা থাকলে কী ঠিক করতে হবে দেখায়। **Send back** দিলে নোটসহ Drafts-এ ফেরত যায়।
- **Bulk import:** প্রতিটা সারি Pending পোস্ট হয়, worker নিজে ক্যাপশন লিখে দেয়, তারপর Approve করুন।
- **Weekly digest:** নির্বাচিত দিনে সকাল ৮টার পর প্রাপকদের ইমেইল যায় (গত ৭ দিনের পোস্ট, likes, reach, top পোস্ট, DM, নতুন contacts)। SMTP সেট না থাকলে Super Admin → Email outbox-এ থাকে। Configure-এ **Send a test to me** দিয়ে দেখে নিন।
- **Analytics:** পাবলিশ হওয়া পোস্টের likes, comments, shares, reach প্ল্যাটফর্ম থেকে আনা হয় (প্রথম ২ দিন ঘণ্টায় একবার, তারপর ১২ ঘণ্টায়, ৩০ দিন পর্যন্ত)। All content আর Overview → Performance-এ দেখায়। কোন প্ল্যাটফর্ম কী দেয়: Facebook (সব, reach-এর জন্য `read_insights`), Instagram (সব, `instagram_manage_insights`), X (likes, replies, reposts, impressions), LinkedIn (likes, comments), Pinterest (saves, impressions), Google Business (নেই)।

---

## ১১. অনেক ক্লায়েন্ট / একাধিক সার্ভার: PostgreSQL আর S3

**PostgreSQL**
1. একটা PostgreSQL 14+ ডাটাবেস নিন (নিজের সার্ভারে, অথবা Neon, Supabase, AWS RDS, DigitalOcean)।
2. সার্ভারে বসান: `DATABASE_URL=postgres://user:password@host:5432/socialblast` (হোস্টেড ডাটাবেসে সাধারণত `SB_DB_SSL=true`)।
3. সার্ভার চালু করলে টেবিল নিজেই তৈরি হয়।
4. **পুরোনো SQLite ডেটা সরানো:** অ্যাপ বন্ধ করুন, তারপর:
   ```bash
   # কী কী কপি হবে দেখুন (কিছু বদলায় না)
   SQLITE_PATH=data/social-blast.db DATABASE_URL=postgres://... npm run db:to-postgres -- --dry-run
   # আসল কপি
   SQLITE_PATH=data/social-blast.db DATABASE_URL=postgres://... npm run db:to-postgres
   # ছবি/ভিডিও-ও S3-তে নিতে চাইলে (S3 সেটিং বসানো থাকতে হবে)
   SB_STORAGE=s3 S3_BUCKET=... SQLITE_PATH=... DATABASE_URL=... npm run db:to-postgres -- --media
   ```
   - সব টেবিল (ক্লায়েন্ট, ইউজার ও পাসওয়ার্ড, কানেক্ট করা অ্যাকাউন্টের এনক্রিপ্ট করা token, পোস্ট, জব, contacts, লগ…) একটা transaction-এ কপি হয়, তারপর প্রতিটা টেবিলের সারির সংখ্যা মিলিয়ে দেখে।
   - PostgreSQL-এ আগে থেকে ডেটা থাকলে থেমে যায়; সেটা মুছে আবার কপি করতে `--force` দিন।
   - SQLite ফাইল শুধু পড়া হয়, বদলায় না — সমস্যা হলে আগের মতো ফিরে যেতে পারবেন।
   - **একই `SB_ENCRYPTION_KEY` রাখুন**, নইলে কানেক্ট করা অ্যাকাউন্ট আবার কানেক্ট করতে হবে।
5. এখন যতগুলো ওয়েব সার্ভার আর `npm run worker` চালাতে পারেন; প্রতিটা কাজ (পাবলিশ, DM, digest, Evergreen) একবারই হয়।

**ফাইল (ছবি/ভিডিও) একাধিক সার্ভারে**
সব সার্ভার যেন একই ফাইল দেখে, তাই S3-ধরনের storage লাগবে (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO):
```
SB_STORAGE=s3
S3_BUCKET=socialblast-media
S3_REGION=auto                 # R2-তে auto, AWS-এ যেমন us-east-1
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # AWS-এ খালি রাখুন
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# S3_FORCE_PATH_STYLE=true      # MinIO-তে
```
Bucket public করার দরকার নেই — অ্যাপ নিজেই `/media/...` দিয়ে ফাইল দেয়।

---

## ১২. Auto-boost (Meta বিজ্ঞাপন)

ভালো চলা Facebook বা Instagram পোস্টকে ছোট, সীমিত বাজেটে প্রচার (boost) করে।

**কীভাবে কাজ করে**
- প্রতিদিন সকাল ৯টার পর (ক্লায়েন্টের টাইমজোন) গত ৭ দিনের সবচেয়ে বেশি likes + comments + shares পাওয়া Facebook/Instagram পোস্ট বাছাই হয়, যদি সেটা আপনার দেওয়া সংখ্যা (Minimum interactions) পেরোয়।
- Meta-তে Campaign (Engagement) → Ad set (দৈনিক বাজেট, দিন, দেশ, বয়স) → Creative (আসল পোস্টটাই) → Ad তৈরি হয়।
- **টাকা খরচের নিরাপত্তা:** মাসিক সীমা (Monthly cap), সপ্তাহে কয়টা boost, আর ডিফল্টভাবে বিজ্ঞাপন **Paused** অবস্থায় তৈরি হয় — Ads Manager-এ গিয়ে কেউ চালু না করলে খরচ হয় না। নিশ্চিত হলে "Create ads paused" বন্ধ করতে পারেন।
- All content-এ পাবলিশড Facebook/Instagram পোস্টের পাশে **Boost** বাটন আছে (শুধু Owner/Admin), একই সীমা মেনে।
- Automations → Auto-boost → **Recent boosts**-এ প্রতিটার অবস্থা আর "Open in Ads Manager" লিংক।
- সীমাবদ্ধতা: Facebook-এ ভিডিও পোস্ট এখান থেকে boost হয় না (Ads Manager থেকে করুন); বাজেট ad account-এর মুদ্রায়।

**চালু করতে যা লাগবে**
1. Meta Business Manager-এ একটা **Ad account**, যাতে পেমেন্ট পদ্ধতি যোগ করা আছে, আর যে ব্যক্তি অ্যাপে কানেক্ট করবেন তার ওই ad account-এ Advertiser/Admin অনুমতি।
2. Meta App-এ permission: `ads_management`, `ads_read` (ক্লায়েন্টদের জন্য App Review লাগবে)। Marketing API প্রোডাক্ট যোগ করুন।
3. সার্ভারে `META_ADS=true` বসান, রিস্টার্ট করুন, তারপর Settings থেকে Facebook/Instagram **আবার কানেক্ট** করুন।
4. Automations → Auto-boost → Configure: ad account বাছুন, বাজেট, দিন, মাসিক সীমা, দেশ (যেমন `US`), বয়স দিন → Save → চালু করুন।

---

## ১৪. সার্ভার পর্যবেক্ষণ, সতর্কবার্তা আর ব্যাকআপ

**Health check**
- `https://app.yourdomain.com/api/health` — সব ঠিক থাকলে `200 {"status":"ok"}`, worker বন্ধ বা ডাটাবেস না চললে `503`।
- একটা বিনামূল্যের uptime monitor (UptimeRobot, Better Stack, Uptime Kuma) দিয়ে প্রতি ১–৫ মিনিটে এই ঠিকানা চেক করুন। **পুরো সার্ভার বন্ধ হলে সার্ভার নিজে সতর্কবার্তা পাঠাতে পারে না** — তখন এই বাইরের monitor-ই আপনাকে জানাবে।
- বিস্তারিত (কোন worker কখন চেক-ইন করেছে, কী সমস্যা) দেখতে `SB_HEALTH_TOKEN=গোপন-লেখা` বসান, তারপর `/api/health?token=গোপন-লেখা`। একই তথ্য **Super Admin → System health**-এ দেখায়।

**সতর্কবার্তা (Alert)** — সার্ভার নিজে প্রতি মিনিটে চেক করে:
| সমস্যা | কখন |
| --- | --- |
| Worker বন্ধ | ৩ মিনিট কোনো worker চেক-ইন করেনি (`SB_WORKER_STALE_SEC`) |
| পোস্ট দেরিতে | শিডিউল করা পোস্ট ১০ মিনিটের বেশি দেরি |
| অনেক ব্যর্থ পোস্ট | এক ঘণ্টায় ৫টা বা বেশি পাবলিশ ব্যর্থ (`SB_ALERT_FAILURES`) |
| ব্যাকআপ | শেষ ব্যাকআপ ব্যর্থ, বা ৩৬ ঘণ্টায় কোনো সফল ব্যাকআপ নেই |
| ডাটাবেস | ডাটাবেসে যাওয়া যাচ্ছে না |

কোথায় পাঠাবে:
```
SB_ALERT_EMAIL=you@agency.com,ops@agency.com     # SMTP সেট থাকতে হবে
SB_ALERT_WEBHOOK_URL=https://hooks.slack.com/...  # Slack / Discord / Teams / Google Chat-এর incoming webhook
```
প্রতিটা সমস্যায় একবার বার্তা যায়, সমস্যা চলতে থাকলে ৬ ঘণ্টা পরপর আবার (`SB_ALERT_REPEAT_MIN`), আর ঠিক হলে "Resolved" বার্তা। একাধিক সার্ভার থাকলেও বার্তা একবারই যায়।

**ব্যাকআপ**
```
SB_BACKUP_DIR=/var/backups/socialblast   # অন্য ডিস্কে হলে ভালো
SB_BACKUP_HOUR=3                         # প্রতিদিন কয়টায় (UTC)
SB_BACKUP_KEEP_DAYS=14                   # কত দিনের ব্যাকআপ রাখবে
SB_BACKUP_S3_BUCKET=my-backups           # ঐচ্ছিক: S3/R2-তেও কপি (S3_* সেটিং ব্যবহার করে)
```
- Worker প্রতিদিন নিজে থেকে ব্যাকআপ নেয়: SQLite হলে ডাটাবেসের কপি (`.sqlite.gz`), PostgreSQL হলে `pg_dump` (`.dump`; সার্ভারে PostgreSQL client tools লাগবে), আর লোকাল আপলোড ফোল্ডারের `.tar.gz`।
- এখনই নিতে: `SB_BACKUP_DIR=/var/backups/socialblast npm run backup`। চাইলে cron-এও দিতে পারেন।
- পুরোনো ব্যাকআপ `SB_BACKUP_KEEP_DAYS` পর মুছে যায় (শুধু `socialblast-` দিয়ে শুরু হওয়া ফাইল)।
- **ব্যাকআপ একই সার্ভারে থাকলে সার্ভার নষ্ট হলে সেটাও যাবে** — S3 কপি চালু রাখুন বা ফোল্ডারটা অন্য জায়গায় সিঙ্ক করুন।

**ব্যাকআপ থেকে ফেরত আনা (Restore)** — আগে অ্যাপ বন্ধ করুন:
```bash
# SQLite
gunzip -k socialblast-db-<তারিখ>.sqlite.gz
cp socialblast-db-<তারিখ>.sqlite data/social-blast.db
# PostgreSQL
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" socialblast-db-<তারিখ>.dump
# আপলোড করা ছবি/ভিডিও
mkdir -p data/uploads && tar -xzf socialblast-uploads-<তারিখ>.tar.gz -C data/uploads
```
মাঝে মাঝে একটা আলাদা কম্পিউটারে restore করে দেখে নিন ব্যাকআপ আসলেই কাজ করে।

---

## ১৫. HTTP proxy দিয়ে ইন্টারনেট

কিছু কোম্পানির নেটওয়ার্ক বা হোস্টিংয়ে সার্ভার শুধু proxy দিয়ে ইন্টারনেটে যায়।
```
SB_PROXY_URL=http://user:password@proxy.company.com:3128
SB_NO_PROXY=localhost,.company.internal     # এগুলো proxy ছাড়া সরাসরি
```
- `SB_PROXY_URL` না দিলে সার্ভারের সাধারণ `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` ব্যবহার হয় (বন্ধ করতে `SB_USE_ENV_PROXY=false`)।
- যা proxy দিয়ে যায়: ওয়েবসাইট ক্রল, সব সোশ্যাল প্ল্যাটফর্মের API, OpenRouter (AI লেখা ও ছবি), alert webhook।
- যা যায় না: SMTP ইমেইল আর S3 storage — এগুলোর সরাসরি সংযোগ লাগে।
- **নিরাপত্তা:** proxy দিয়ে ক্রল করার সময় অ্যাপ আগে নিজে ঠিকানা খুঁজে দেখে সেটা প্রাইভেট নেটওয়ার্কের নয়। যদি সার্ভার নিজে নাম খুঁজতে না পারে (শুধু proxy পারে), `SB_PROXY_RESOLVES_DNS=true` দিন — তখন অ্যাপ শুধু IP আর `localhost`/`.internal`-এর মতো নাম আটকাতে পারে, তাই proxy যেন আপনার ভেতরের নেটওয়ার্কে যেতে না দেয় সেটা নিশ্চিত করুন।
- proxy যদি নিজের সার্টিফিকেট দিয়ে HTTPS খোলে, সার্ভারে `NODE_EXTRA_CA_CERTS=/path/ca.pem` দিন।

---

## ১৬. কোড যাচাই (CI)

- GitHub-এ প্রতিবার কোড পুশ বা Pull Request হলে নিজে থেকে চলে: টাইপ চেক, lint, SQLite আর PostgreSQL-এ সব টেস্ট, আর production build (`.github/workflows/ci.yml`)।
- GitHub-এ repo-র **Actions** ট্যাবে ফলাফল দেখা যায়; সবুজ ✓ মানে সব ঠিক, লাল ✗ মানে কিছু ভেঙেছে — ক্লিক করলে কোন ধাপে সমস্যা দেখায়।
- নিজের কম্পিউটারে একই চেক: `npm run typecheck && npm run lint && npm test && npm run build`।

---

## ১৭. যা এখনো বাকি / সীমাবদ্ধতা

| বিষয় | অবস্থা |
| --- | --- |
| আসল প্ল্যাটফর্মে লাইভ টেস্ট | কোড API ডকুমেন্টেশন অনুযায়ী লেখা ও নকল রেসপন্সে টেস্ট করা; আপনার key দিয়ে ধাপ ৫-এর টেস্ট দরকার (ভিডিও আর Auto-boost-ও) |
| Google Business-এ ভিডিও পোস্টের ভেতরে | Google দেয় না — প্রোফাইলের Photos & videos-এ যায় |
| Facebook ভিডিও পোস্ট boost | Ads Manager থেকে করতে হবে |
| ভিডিওর দৈর্ঘ্য আগে থেকে যাচাই | হয় না (প্ল্যাটফর্ম যাচাই করে) |
| SMTP আর S3 proxy দিয়ে | যায় না (সরাসরি সংযোগ লাগে) |

---

## দ্রুত চেকলিস্ট

- [ ] HTTPS ডোমেইনে অ্যাপ চালু, `APP_URL` বসানো
- [ ] `SB_ENCRYPTION_KEY` তৈরি করে বসানো ও আলাদা জায়গায় রাখা
- [ ] Owner অ্যাকাউন্ট তৈরি
- [ ] SMTP সেটিং (আমন্ত্রণ/রিসেট ইমেইলের জন্য)
- [ ] `OPENROUTER_API_KEY` আর `OPENROUTER_MODEL` (AI দিয়ে লেখার জন্য)
- [ ] প্রতিটা প্ল্যাটফর্মের app তৈরি, redirect URL, key বসানো
- [ ] Meta / LinkedIn / Pinterest / Google-এর অনুমোদন (App Review / access request) জমা
- [ ] প্রতিটা প্ল্যাটফর্মে ধাপ ৫-এর লাইভ টেস্ট
- [ ] ক্লায়েন্টের ওয়েবসাইট ক্রল
- [ ] `SB_BACKUP_DIR` (প্রতিদিনের ব্যাকআপ) আর S3 কপি বা অন্য জায়গায় সিঙ্ক
- [ ] Uptime monitor → `/api/health`, আর `SB_ALERT_EMAIL` / `SB_ALERT_WEBHOOK_URL`
- [ ] (ঐচ্ছিক) `OPENROUTER_IMAGE_MODEL` — AI ছবি
- [ ] (ঐচ্ছিক) Meta webhook + `META_ENGAGEMENT=true` — Comment → DM
- [ ] (একাধিক সার্ভার) `DATABASE_URL` আর `SB_STORAGE=s3`; পুরোনো ডেটা `npm run db:to-postgres` দিয়ে সরানো
- [ ] (ঐচ্ছিক) Ad account + `META_ADS=true` — Auto-boost
