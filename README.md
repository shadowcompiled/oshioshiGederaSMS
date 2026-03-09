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
     - `ANDROID_SMS_GATEWAY_*` – SMS gateway
     - `QSTASH_TOKEN` – for queuing broadcast/birthday SMS
     - `CRON_SECRET` – for `/api/cron/birthday_check`

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
   | `ADMIN_PASSWORD` | Yes | Password for `/login` (admin dashboard) |
   | `POSTGRES_URL` or `DATABASE_URL` | Yes | Postgres connection string (e.g. Vercel Postgres). Add `?sslmode=require` if missing. |
   | `ANDROID_SMS_GATEWAY_LOGIN` | Yes* | SMS gateway login |
   | `ANDROID_SMS_GATEWAY_PASSWORD` | Yes* | SMS gateway password |
   | `ANDROID_SMS_GATEWAY_API_URL` | No | Default: `https://api.sms-gate.app/3rdparty/v1` |
   | `QSTASH_TOKEN` | Yes* | Upstash QStash token for broadcast/birthday SMS queue |
   | `CRON_SECRET` | Yes* | Secret for cron endpoint (e.g. `openssl rand -hex 24`) |

   \* Required if you use SMS or cron.

3. **Database**: Use **Postgres** only on Vercel (e.g. Vercel Postgres). SQLite is not supported in serverless.

4. **Cron (birthday check)**  
   The app has a cron in `vercel.json` that runs at 10:00 on the 1st of each month. So the cron job is created automatically. You must authorize the request:
   - In Vercel: **Project → Settings → Crons** (or **Integrations**), open the cron for `/api/cron/birthday_check` and add an **HTTP Header**: `Authorization` = `Bearer` + your `CRON_SECRET` (or use a serverless function that adds the header). Alternatively, Vercel Cron may allow setting the URL to include `?secret=YOUR_CRON_SECRET` (less secure if logs are exposed).
   - Ensure `CRON_SECRET` is set in Environment Variables to the same value.

5. **Deploy**: Push to the connected branch; Vercel will build and deploy. The first deploy will run `npm run build`; ensure all required env vars are set so DB and APIs work.

6. **Static assets**: Commit the `public/` folder (logo and bg images) so they are deployed. The app expects `logo.png` and `bg1.png`–`bg7.png` in `public/`.

## Routes (unchanged logic)

| Path | Description |
|------|-------------|
| `/` | VIP signup form |
| `/login` | Admin login |
| `/admin` | Customer list, broadcast SMS, CSV export, block/unblock |
| `/unsubscribe/[phone]?token=...` | Unsubscribe link from SMS |
| `POST /api/submit` | Form submit |
| `POST /api/login` | Admin login |
| `GET /api/logout` | Logout |
| `GET /api/admin/export-csv` | Export CSV |
| `POST /api/admin/broadcast` | Queue broadcast SMS via QStash |
| `GET /api/admin/toggle?phone=&action=block\|unblock` | Block/unblock customer |
| `GET /api/admin/force-init` | Recreate `customers` table |
| `POST /api/send_sms_task` | QStash worker – send one SMS (internal) |
| `GET|POST /api/cron/birthday_check` | Cron – send birthday SMS |

## Static assets

Put `logo.png` and `bg1.png`–`bg5.png` (and optional `bg2`–`bg5`) in the `public/` folder.
