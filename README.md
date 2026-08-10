# Comflex — College Community Platform

**[🚀 Live Demo / Deployment](https://comflex.vercel.app)**

> A modern, real-time college community platform with group chat, cohort management, friend system, and direct messaging.

## Features

- **Google OAuth Registration** — Students sign up with their college Google account
- **Immersive Landing Page** — High-end GSAP scroll animations, SVG path wiping, and Framer Motion elements
- **Real-time Group Chat** — WebSocket-powered messaging with typing indicators
- **Cohort Auto-Tagging** — Automatic year/branch detection from college email
- **Friends System** — Send/accept/reject friend requests 
- **Direct Messaging** — 1-on-1 DMs between friends
- **Ring-based RBAC** — Hierarchical permission system (Admin → Manager → Elevated → Member)
- **Event Management & Rewards** — Create events with size limits, handle registrations, and distribute tiered rewards
- **Virtual Badge Store** — Manage platform inventory, allow students to redeem medals (Gold/Silver/Bronze) for their profile
- **AI Chatbot Integration** — Smart context-aware bot paths for student assistance
- **Resource Sharing** — Direct file/link sharing dedicated within system resources
- **Admin Dashboard** — Institution setup, user management, cohort configuration
- **Auto-Join Rules** — Configure which groups users automatically join based on year/branch
- **Pluggable Web Deployments** — Fully configured Vercel SPA routing (`vercel.json`) alongside standard setups

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, Socket.IO |
| Database | MongoDB (Prisma ORM) |
| Frontend | React 19, Vite, Tailwind CSS 4 |
| Auth | JWT + Google OAuth 2.0 |
| Email | Nodemailer (SMTP) / Console |

---

## Prerequisites

- **Node.js** ≥ 18.x ([download](https://nodejs.org))
- **MongoDB** ≥ 6.x with replica set enabled
- **npm** ≥ 9.x (comes with Node.js)
- **Google Cloud** project with OAuth 2.0 credentials (for registration)

---

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/comflex.git
cd comflex
```

### 2. MongoDB Setup

Comflex requires MongoDB with **replica set** enabled (required for Prisma transactions).

<details>
<summary><strong>🐧 Linux</strong></summary>

**Ubuntu/Debian-based:**
```bash
# Install MongoDB Community Edition
sudo apt-get install -y gnupg curl
curl -fsSL https://www.mongodb.com/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org
```

**Fedora-based:**
```bash
# Create the repository file
cat <<EOF | sudo tee /etc/yum.repos.d/mongodb-org-7.0.repo
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/9/mongodb-org/7.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.com/static/pgp/server-7.0.asc
EOF

# Install MongoDB
sudo dnf install -y mongodb-org
```

**Arch-based:**
```bash
# Install MongoDB Community Edition via AUR (using yay as an example)
yay -S mongodb-bin mongodb-tools-bin
```

**Configuration (All Linux Distributions):**
```bash
# Enable replica set: add to /etc/mongod.conf
# replication:
#   replSetName: rs0

# Enable, start, and initialize
sudo systemctl enable --now mongod
mongosh --eval "rs.initiate()"
```
</details>

<details>
<summary><strong>🍎 macOS</strong></summary>

```bash
# Install via Homebrew
brew tap mongodb/brew
brew install mongodb-community@7.0

# Start with replica set
mongod --replSet rs0 --dbpath /usr/local/var/mongodb --logpath /usr/local/var/log/mongodb/mongo.log --fork

# Initialize the replica set
mongosh --eval "rs.initiate()"
```
</details>

<details>
<summary><strong>🪟 Windows</strong></summary>

1. Download MongoDB Community from [mongodb.com](https://www.mongodb.com/try/download/community)
2. During install, choose "Complete" and install MongoDB Compass
3. Edit `C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg`:
   ```yaml
   replication:
     replSetName: rs0
   ```
4. Restart the MongoDB service from Services panel
5. Open MongoDB Shell (mongosh) and run: `rs.initiate()`
</details>

### 3. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env and fill in your values (see Environment Variables below)

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Start development server
npm run dev
```

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Add your VITE_GOOGLE_CLIENT_ID

# Start development server
npm run dev
```

### 5. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Set Application type: **Web application**
6. Add Authorized origins:
   - `http://localhost:5173` (frontend dev)
   - `http://localhost:5001` (backend dev)
7. Copy the **Client ID** to:
   - `backend/.env` → `GOOGLE_CLIENT_ID`
   - `frontend/.env` → `VITE_GOOGLE_CLIENT_ID`

### 6. First Boot

1. Start both backend (`npm run dev` in `/backend`) and frontend (`npm run dev` in `/frontend`)
2. Open `http://localhost:5173/login`
3. Login with the seed admin credentials from `.env` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
4. Navigate to `/setup` to configure your institution (name, email domain)
5. Go to `/admin` to configure email parsing rules and cohort settings
6. Once configured, registration is enabled for students

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | MongoDB connection string with `?replicaSet=rs0` | ✅ |
| `JWT_ACCESS_SECRET` | Secret for signing access tokens | ✅ |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | ✅ |
| `SEED_ADMIN_EMAIL` | Initial admin email (created on first boot) | ✅ |
| `SEED_ADMIN_PASSWORD` | Initial admin password | ✅ |
| `FRONTEND_URL` | Frontend origin for CORS | ✅ |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | For registration |
| `EMAIL_PROVIDER` | `console` (dev) or `smtp` | ❌ |
| `EMAIL_FROM` | Sender email address | ❌ |
| `SMTP_HOST/PORT/USER/PASS` | SMTP credentials | If `smtp` |

### Frontend (`frontend/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_GOOGLE_CLIENT_ID` | Same Google Client ID as backend |

---

## API Overview

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/auth/google` | Google OAuth login/register |
| `POST /api/v1/auth/login` | Email/password login |
| `POST /api/v1/auth/set-password` | Set password (Google users) |
| `POST /api/v1/auth/set-username` | Choose username |
| `GET /api/v1/friends` | List friends |
| `POST /api/v1/friends/request` | Send friend request |
| `GET /api/v1/dm` | List DM conversations |
| `POST /api/v1/dm/:userId` | Send a DM |
| `USE /api/v1/events` | Events, team formation & submissions |
| `USE /api/v1/store` | Badge inventory, rewards & purchases |
| `USE /api/v1/groups` | Group chats, members & ring checks |
| `USE /api/v1/resources` | File sharing and resource nodes |
| `USE /api/v1/chatbot` | Conversational AI interfaces |
| `GET /api/v1/admin/auto-join-rules` | Get auto-join rules |
| `PUT /api/v1/admin/auto-join-rules` | Set auto-join rules |

See `RULES.md` for the complete API contract and data model documentation.

---

## Architecture

```
comflex/
├── backend/
│   ├── prisma/schema.prisma     # Data models (MongoDB)
│   ├── src/
│   │   ├── config/env.js        # Environment config
│   │   ├── middleware/           # Auth, RBAC, error handling
│   │   ├── routes/              # REST API routes
│   │   ├── services/            # Business logic
│   │   └── utils/               # JWT, password, response helpers
│   └── .env                     # Environment variables
├── frontend/
│   ├── src/
│   │   ├── api/                 # API client modules
│   │   ├── components/          # Reusable UI components
│   │   ├── context/             # React context (Auth)
│   │   ├── pages/               # Route pages
│   │   └── App.jsx              # Root routing
│   └── .env                     # Frontend env
├── RULES.md                     # Design rules & API contracts
├── doNext.md                    # Next-phase roadmap
└── README.md                    # This file
```

## License

MIT
