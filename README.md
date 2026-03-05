# 🌱 Grassion

**Know your config. Ship with confidence.**

Grassion is a config intelligence platform for engineering teams. Powered by EnvGuard — an environment variable analysis engine that maps every variable in your codebase, flags dead config, detects staging-production drift, and scores deployment risk.

---

## What's Included

| File | Purpose |
|------|---------|
| `index.html` | Landing page with waitlist signup |
| `app.html` | Scanner dashboard (the product) |
| `style.css` | Shared stylesheet |
| `scanner.js` | EnvGuard analysis engine (runs in browser) |
| `dashboard.js` | Dashboard UI and results rendering |
| `server.js` | Node.js/Express backend API |
| `database.sql` | PostgreSQL schema |
| `package.json` | Node.js dependencies |
| `.env.example` | Environment config template |

---

## Quick Start — Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Set up database (optional for basic testing)

If you have PostgreSQL running:
```bash
psql -U postgres -c "CREATE DATABASE grassion;"
psql -U postgres -d grassion -f database.sql
```

If you **don't** have PostgreSQL yet, the server still works — signups are logged to console instead. Set up the database when you're ready.

### 4. Start the server

```bash
npm run dev    # development (auto-restart on changes)
# or
npm start      # production
```

### 5. Open the site

```
http://localhost:3001
```

---

## Deploying — Step by Step

### Option A: Railway (Recommended — easiest, free tier available)

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway auto-detects Node.js and installs dependencies
4. Add a PostgreSQL database: + New → Database → PostgreSQL
5. Set environment variables in Railway dashboard:
   - `DATABASE_URL` — Railway provides this automatically when you add Postgres
   - `NODE_ENV=production`
   - `ALLOWED_ORIGINS=https://yourdomain.com`
6. Run the database schema: Railway dashboard → your Postgres service → Query → paste `database.sql` contents
7. Your app is live at `https://your-app.railway.app`

**Estimated cost:** Free tier covers ~500 hours/month. Paid starts at $5/month.

---

### Option B: Render

1. Push to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
5. Add a PostgreSQL database: New → PostgreSQL
6. Set environment variables (copy from `.env.example`)
7. Run `database.sql` in the Render PostgreSQL shell

---

### Option C: VPS (DigitalOcean, Hetzner, AWS EC2)

```bash
# On your server
git clone https://github.com/yourrepo/grassion.git
cd grassion
npm install
cp .env.example .env
nano .env  # fill in values

# Install PostgreSQL
sudo apt install postgresql -y
sudo -u postgres createdb grassion
sudo -u postgres psql grassion < database.sql

# Start with PM2 (keeps it running)
npm install -g pm2
pm2 start server.js --name grassion
pm2 save
pm2 startup
```

For Nginx reverse proxy:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Then add SSL with Certbot:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

### Option D: Vercel (frontend only — no backend)

If you want to deploy just the frontend (landing page + demo scanner) with no backend:

1. The scanner works **100% in the browser** — no server needed for scanning
2. Signups just won't save to a database (they'll be captured in localStorage)
3. In `index.html`, the `fetch('/api/signup', ...)` call fails gracefully — the UI still works

```bash
# Install Vercel CLI
npm install -g vercel
vercel deploy
```

Add a proper backend later when you need persistent signups.

---

## Viewing Your Signups

### Quick SQL queries

```sql
-- See all signups
SELECT email, name, source, created_at FROM signups ORDER BY created_at DESC;

-- Count total
SELECT COUNT(*) FROM signups;

-- Last 7 days
SELECT * FROM signups WHERE created_at > NOW() - INTERVAL '7 days';

-- Update status when you reach out
UPDATE signups SET status = 'contacted' WHERE email = 'devops@company.com';

-- View daily trends
SELECT * FROM signup_dashboard;
```

---

## Customizing

### Change the signup counter baseline
In `index.html`, search for `BASE_COUNT = 47` and change to any number.

### Change the brand name
Search and replace `Grassion` → `Your Brand Name` across all files.

### Add email notifications for new signups
Install nodemailer (`npm install nodemailer`) and add to `server.js`:

```js
const nodemailer = require('nodemailer');
// Add after successful signup insert:
await transporter.sendMail({
  to: process.env.NOTIFY_EMAIL,
  subject: `New signup: ${email}`,
  text: `${email} joined the Grassion waitlist.`
});
```

### Update pricing
In `index.html`, find the pricing section and update the `price-amount` divs.

---

## Architecture

```
Browser
  ├── index.html      ← Landing page
  │     └── style.css
  │
  └── app.html        ← Scanner dashboard
        ├── style.css
        ├── scanner.js     ← Pure JS, runs in browser
        └── dashboard.js   ← UI logic

Server (Node.js)
  └── server.js
        ├── POST /api/signup      ← Email capture
        ├── GET  /api/count       ← Signup counter
        ├── POST /api/contact     ← Enterprise inquiries
        ├── POST /api/scan-event  ← Analytics (anon)
        └── GET  /api/health      ← Health check

Database (PostgreSQL)
  ├── signups       ← Waitlist emails
  ├── contacts      ← Enterprise inquiries
  └── scan_events   ← Anonymous usage analytics
```

---

## Privacy

The scanner runs entirely in the browser. **No .env file contents are ever sent to any server.** The only data that reaches the server is:
- Email address (when a user signs up)
- Anonymous scan event (variable count + risk score, no variable names)

---

## Next Steps After Launch

1. **Get 5 signups** → Reach out manually within 24 hours
2. **Offer free screen share** → Run the demo on their actual repo with them watching
3. **Get one paying customer** → Charge ₹8,000/month for Team access
4. **Build Phase 2** → Slack integration, GitHub PR bot, cloud env sync

---

Built with ❤️ by the Grassion team · Powered by EnvGuard
