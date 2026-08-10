# 🚀 Comflex — 100% Free Deployment Guide

Everything below is free tier. Total cost: **$0/month**.

| Piece | Provider | Free tier |
|-------|----------|-----------|
| Frontend (React) | **Vercel** | Unlimited |
| Backend (Express + Socket.IO) | **Render** | 750 hrs/mo, sleeps on idle |
| Database (MongoDB) | **MongoDB Atlas** | 512 MB |
| File/Image storage | **Cloudinary** | 25 GB, 25k credits |
| Keep-alive bot (wakes Render) | **UptimeRobot** | 50 monitors |

---

## 0. Why this setup works

- **Render's `/tmp` is wiped** on deploy & after inactivity → that's why **every file upload
  now goes to Cloudinary** (see `backend/src/utils/fileStorage.js`). If Cloudinary env vars
  are missing it falls back to local disk, which is fine for dev only.
- **Render free instances sleep** after ~15 min idle → **UptimeRobot pings
  `/api/health` every 5 minutes**, which wakes the instance and keeps it running.
  (The backend itself cannot self-ping: a sleeping process is fully suspended.)
- **Images display cross-origin**: the frontend `resolveAsset()` util prefixes the
  Render URL to any `/uploads/...` path so avatars/badges/files render on Vercel.

---

## 1. MongoDB Atlas (database)

1. Go to https://www.mongodb.com/atlas → sign up → **Build a Database** → **Free** (M0).
2. Choose a region near you → create.
3. **Database Access** → Add New User (e.g. `comflex`) with a strong password.
4. **Network Access** → Add IP `0.0.0.0/0` (allow all — fine for this project).
5. **Databases** → Connect → Drivers → copy the connection string, e.g.
   `mongodb+srv://comflex:<password>@cluster0.xxxxx.mongodb.net/comflex`
   (replace `<password>` and set the DB name to `comflex`).

---

## 2. Cloudinary (images/files)

1. https://cloudinary.com → free signup.
2. Dashboard shows `Cloud name`, `API Key`, `API Secret`.
3. You'll paste all three into Render below. When set, every upload (avatars,
   group avatars, badges, chat files, resources) is stored on Cloudinary and
   served from `res.cloudinary.com` — immune to Render restarts.

---

## 3. Render (backend) — 10 minutes

**Option A — Blueprint (easiest):**
1. Push this repo to GitHub (it already has `render.yaml` at the root).
2. Render → **New → Blueprint** → pick the repo → Render reads `render.yaml`
   and creates the `comflex-backend` service.
3. For every `sync: false` env var, click **Edit** and fill it in:
   - `DATABASE_URL` → from step 1
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` → generate:
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_DISPLAY_NAME` → your admin login
   - `GOOGLE_CLIENT_ID` → from Google Cloud console (see section 5)
   - `FRONTEND_URL` → your Vercel URL, e.g. `https://comflex.vercel.app`
   - `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` → from step 2
   - `EMAIL_PROVIDER=console` (reset links print in Render logs) — or `smtp` + SMTP vars for real mail
4. **Apply**.

**Option B — Manual:** Render → New → Web Service → point at the repo, root dir `backend`,
build `npm install && npx prisma generate`, start `npm start`, then add the same env vars.

When it's live you'll get `https://comflex-backend.onrender.com`. Check
`https://comflex-backend.onrender.com/api/health` → `{"status":"ok"}`.

---

## 4. UptimeRobot (keep-alive bot) — 2 minutes

1. https://uptimerobot.com → free signup.
2. **Add New Monitor**:
   - Monitor Type: **HTTP(S)**
   - Friendly Name: `Comflex backend`
   - URL: `https://comflex-backend.onrender.com/api/health`
   - Interval: **5 minutes** (free tier minimum)
   - Save.
3. Done — Render now receives a ping every 5 min and never sleeps.
   (Alternative: cron-job.org or Kinsta's uptime monitor. Any HTTPS ping works.)

---

## 5. Vercel (frontend) — 5 minutes

1. https://vercel.com → import the GitHub repo → framework **Vite**.
2. Root directory: `frontend`. Build: `npm run build`. Output: `dist`.
3. **Environment Variables** (Settings → Environment Variables):
   - `VITE_BACKEND_URL` → `https://comflex-backend.onrender.com`
   - `VITE_GOOGLE_CLIENT_ID` → from Google Cloud (below)
   - `VITE_TREASURY_ADDRESS` → your EVM wallet (optional, for crypto credits)
4. **Deploy**. The included `vercel.json` handles SPA routing.

### Google OAuth (needed for register/login)
1. https://console.cloud.google.com → create project → **APIs & Services → Credentials → OAuth client ID → Web app**.
2. Authorized JavaScript origins: `https://<your-app>.vercel.app` (+ `http://localhost:5173`).
3. Copy the Client ID into `VITE_GOOGLE_CLIENT_ID` (Vercel) and `GOOGLE_CLIENT_ID` (Render).

---

## 6. First boot

1. Open the Vercel URL → log in as the Seed Admin (from `SEED_ADMIN_*`).
2. You'll land on the **Setup wizard** → institution name, email domain, regex. Done.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Images broken on Vercel | Cloudinary not set on Render — uploads fell back to `/tmp`; add the 3 `CLOUDINARY_*` vars and redeploy. |
| Backend slow first click | Render sleeping → UptimeRobot should prevent this; otherwise it wakes in ~30 s. |
| Socket not connecting | `VITE_BACKEND_URL` must be set on Vercel (the socket uses it too now). |
| Reset link "sent" but no email | `EMAIL_PROVIDER=console` → read the Render logs for the link. |
| `prisma generate` fails on Render | Nothing — just redeploy; ensure `buildCommand` includes `npx prisma generate`. |
