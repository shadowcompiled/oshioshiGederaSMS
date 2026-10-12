# Oshioshi Gedera SMS – Next.js

VIP club registration with SMS broadcast and birthday reminders. Refactored from Flask to Next.js (App Router) with the same behavior.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env.local` and set:
     - `SECRET_KEY` – required in production
     - `ADMIN_PASSWORD` – admin dashboard
     - `POSTGRES_URL` or `DATABASE_URL` – for production (Vercel). Omit for local SQLite (`customers.db`).
     - `SMS_019_TOKEN` / `SMS_019_USERNAME` / `SMS_019_SOURCE` – 019 SMS
     - `QSTASH_TOKEN` – for queuing broadcast/birthday SMS
     - `CRON_SECRET` – for `/api/cron/birthday_check`
     - `WAITER_USERNAME` / `WAITER_PASSWORD` – optional waiter login for `/waiter` (both required to enable it)

3. **Run**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Deploy (Vercel)

1. **Connect the repo** to Vercel (Import Git Repository). Framework Preset: Next.js.

2. **Environment variables** (Project → Settings → Environment Variables). Set these for **Production** (and Preview if you want):

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `SECRET_KEY` | Yes | Long random string (session + tokens). Generate with `openssl rand -hex 32` |
| `REQUIRE_PHONE_VERIFICATION` | No | `true` to require an SMS code at signup. Default **off**. See [Phone verification](#phone-verification-sms-2fa). |
   | `ADMIN_PASSWORD` | Yes | Password for `/login` (admin dashboard) |
   | `WAITER_USERNAME` | No* | Username for the waiter login on `/login` |
   | `WAITER_PASSWORD` | No* | Password for the waiter login |
   | `POSTGRES_URL` or `DATABASE_URL` | Yes | Postgres connection string (e.g. Vercel Postgres). Add `?sslmode=require` if missing. |
   | `SMS_019_TOKEN` | Yes* | 019 API token |
   | `SMS_019_USERNAME` | Yes* | 019 account username |
   | `SMS_019_SOURCE` | Yes* | Sender name, 1-11 English letters/digits/spaces (e.g. `OSHI GEDERA`) |
   | `SMS_019_API_URL` | No | Default `https://019sms.co.il/api`; `https://019sms.co.il/api/test` validates without sending |
   | `QSTASH_TOKEN` | Yes* | Upstash QStash token for broadcast/birthday SMS queue |
   | `QSTASH_URL` | No | Only for QStash EU region (e.g. `https://eu1-xxxx.upstash.io`). Default: global host. |
   | `UPSTASH_REDIS_REST_URL` | No* | Upstash Redis REST URL for distributed rate limiting. |
   | `UPSTASH_REDIS_REST_TOKEN` | No* | Upstash Redis REST token. |
   | `APP_URL` | No | Public base URL fallback for unsubscribe links / QStash callbacks. |
   | `CRON_SECRET` | Yes* | Secret for cron endpoint (e.g. `openssl rand -hex 24`) |

   \* Required if you use SMS or cron.

   \* Rate limiting falls back to per-instance in-memory storage when Upstash Redis is not configured. On Vercel (serverless), set the Upstash Redis vars so limits hold across instances and cold starts.

   \* Waiter login is disabled unless both `WAITER_USERNAME` and `WAITER_PASSWORD` are set.

3. **Database**: Use **Postgres** only on Vercel (e.g. Vercel Postgres). SQLite is not supported in serverless.

4. **Cron (birthday check)**  
   The app has a cron in `vercel.json` that runs at 10:00 on the 1st of each month. Besides queuing birthday SMS, this run also issues that month's birthday and anniversary gifts and queues the anniversary SMS. So the cron job is created automatically. You must authorize the request:
   - In Vercel: **Project → Settings → Crons** (or **Integrations**), open the cron for `/api/cron/birthday_check` and add an **HTTP Header**: `Authorization` = `Bearer` + your `CRON_SECRET` (or use a serverless function that adds the header). Alternatively, Vercel Cron may allow setting the URL to include `?secret=YOUR_CRON_SECRET` (less secure if logs are exposed).
   - Ensure `CRON_SECRET` is set in Environment Variables to the same value.

5. **Deploy**: Push to the connected branch; Vercel will build and deploy. The first deploy will run `npm run build`; ensure all required env vars are set so DB and APIs work.

6. **Static assets**: Commit the `public/` folder (logo and hero images) so they are deployed. The app expects `logo.png` in `public/` and `bg1.jpg`–`bg7.jpg` in `public/hero/` (generated from raw originals by `node scripts/optimize-heroes.mjs`; the raw sources live only in git history).

## Routes (unchanged logic)

| Path | Description |
|------|-------------|
| `/` | VIP signup form (details → SMS code → membership) |
| `/terms` | Club terms, privacy & SMS consent (draft, pending lawyer review) |
| `/login` | Admin/waiter login (username field selects which) |
| `/admin` | Customer list, broadcast SMS, CSV export, block/unblock, permanent delete |
| `/waiter` | Waiter screen: search customers, view/redeem gifts |
| `/unsubscribe/[phone]?token=...` | Unsubscribe link from SMS |
| `POST /api/signup/start` | Validate the form, text a one-time code |
| `POST /api/signup/verify` | Check the code, mint a single-use signup token |
| `POST /api/submit` | Create the membership (requires that token) |
| `POST /api/login` | Admin/waiter login |
| `GET /api/logout` | Logout |
| `GET /api/admin/export-csv` | Export CSV |
| `POST /api/admin/broadcast` | Queue broadcast SMS via QStash |
| `GET /api/admin/toggle?phone=&action=block\|unblock` | Block/unblock customer |
| `POST /api/admin/delete-customer` | Permanently delete one customer and their gifts |
| `GET /api/admin/force-init` | Recreate `customers` table |
| `GET /api/waiter/customers?q=` | Waiter search – name/phone + gifts only |
| `POST /api/waiter/redeem` | Waiter – atomically mark a gift used |
| `POST /api/send_sms_task` | QStash worker – send one SMS (internal) |
| `GET|POST /api/cron/birthday_check` | Cron – issue birthday/anniversary gifts, send birthday + anniversary SMS |

## Phone verification (SMS 2FA)

**Master switch: `REQUIRE_PHONE_VERIFICATION`** (default: **off**).

| Value | Signup flow |
|-------|-------------|
| unset / `false` / `0` / `off` / `no` | Customer fills the form and joins immediately — the pre-2FA behaviour. No SMS is sent and no code is asked for. |
| `true` / `1` / `on` / `yes` | A code is texted and must be entered before the membership is created. |

Only turn it **on** when the SMS gateway is known to be up: with it on and the
gateway unreachable, `/api/signup/start` returns `sms_unavailable` and nobody
can join. That is why it defaults to off — a forgotten variable should not
silently close the club to new members.

The switch is read server-side on every request and reported to the browser by
`/api/signup/start` (`verificationRequired` in the response). It is deliberately
not baked into the statically rendered landing page, so a cached page can never
offer a flow the server has stopped accepting; `/api/submit` applies the same
switch itself, so a stale tab cannot talk the server out of verifying. Vercel
injects environment variables at deploy time, so **redeploy after changing it**
(Deployments → ⋯ → Redeploy).

Whichever way the switch is set, one number still maps to exactly one
membership: `customers.phone` is the primary key, and both `/api/signup/start`
and `/api/submit` reject a number that already belongs to an active member.
What the switch controls is only whether the person must *prove* the number is
theirs.

### When the switch is on

Joining the club requires proving control of the phone number.

1. `POST /api/signup/start` validates the whole form (so nobody gets an SMS only
   to be told their email is malformed), rejects a number that already belongs to
   an **active** member, then stores an HMAC of a fresh 6-digit code in
   `phone_verifications` and texts the code.
2. `POST /api/signup/verify` checks the code, destroys it, and returns a
   single-use **signup token** bound to that number.
3. `POST /api/submit` spends the token atomically and only then writes the
   customer row. Without a valid token it returns `verification_required` — the
   browser cannot assert "verified" on its own.

Limits (all server-side; see `lib/otp.ts` for the constants):

| Control | Value | Enforced in |
|---------|-------|-------------|
| Code lifetime | 10 minutes | `phone_verifications.code_expires_at` |
| Guesses per code | 5, counted before the comparison | `phone_verifications.attempts` |
| Resend cooldown | 60 s per number | `phone_verifications.last_sent_at` |
| Sends per number | 5 per rolling hour | `phone_verifications.send_count` |
| Signup token | single use, 15 minutes, bound to the phone | atomic conditional `UPDATE` |
| Per-IP | 5 starts/min, 12 verifies/min | `lib/ratelimit.ts` |

The per-number limits live in the database rather than in the IP rate limiter,
so rotating IP addresses or a serverless cold start cannot reset them. Codes are
never stored or logged in the clear, and are compared in constant time.

Uniqueness is enforced at the database level too: `customers.phone` is the
primary key. A previously unsubscribed member who signs up again re-activates
that same row (still one membership per number) — and still has to pass
verification to do it.

## SMS consent, gifts & waiter role

- **SMS consent**: Signup requires an explicit, unchecked-by-default consent checkbox (`VIPForm.tsx`). The verification SMS itself is transactional, not promotional, so it carries no opt-out footer. On success, the consent timestamp, the exact consent text version, and the submitter's IP are stored on the customer row as proof. Club terms + privacy policy live at `/terms` — this page is a **DRAFT and requires lawyer review before launch**.
- **Gifts**: A `gifts` table tracks per-customer rewards. A Joining Reward is auto-issued at signup, becomes redeemable the day **after** signup (Israel time), and never expires. Birthday and anniversary gifts are issued by the monthly cron and are valid only during their calendar month. Redemption is a single, atomic update — a gift can never be redeemed twice, even under concurrent requests.
- **Waiter role**: Set `WAITER_USERNAME` + `WAITER_PASSWORD` to enable a restricted login. The waiter signs in with the username field on `/login` and lands on `/waiter`, which shows only a customer's name, phone, and gifts (no other customer data), and lets them mark a gift as used.
- **Cron**: The existing 1st-of-month cron (`/api/cron/birthday_check`) now also issues that month's birthday/anniversary gifts and queues both birthday and anniversary SMS. All outgoing SMS use the brand name "Oshi Oshi Gedera".

## Static assets

Put `logo.png` in the `public/` folder. The landing-page slideshow reads `public/hero/bg1.jpg`–`bg7.jpg`, generated from raw photos with `node scripts/optimize-heroes.mjs` (drop the raw `bg1.png`…`bg7.png`/`bg3.jpg` originals into `public/` first, or restore them from git history).
