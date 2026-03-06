/**
 * GRASSION — Backend Server
 * Node.js + Express
 * Handles: Email signups, waitlist storage, basic API
 *
 * Run: node server.js
 * Requires: npm install
 */

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { Pool }   = require('pg');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3001;

// ── DATABASE ──────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test connection on start
pool.connect()
  .then(client => {
    console.log('✓ Database connected');
    client.release();
  })
  .catch(err => {
    console.warn('⚠ Database not connected:', err.message);
    console.warn('  Signups will be logged to console only.');
  });

  // Auto-create tables on startup
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signups (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        company VARCHAR(255),
        source VARCHAR(100) DEFAULT 'landing',
        status VARCHAR(50) DEFAULT 'waitlist',
        notes TEXT,
        razorpay_payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS company VARCHAR(255)`);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'landing'`);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'waitlist'`);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS notes TEXT`);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255)`);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
    console.log('✅ Tables ready');
  } catch (err) {
    console.error('Table creation error:', err.message);
  }
};
initDB();

// ── MIDDLEWARE ─────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts in HTML files
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:5500'],
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
}));

// ── RATE LIMITING ──────────────────────────────────────────────

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 5 signup attempts per IP per 15 min
  message: { error: 'Too many signup attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
});

app.use('/api/', apiLimiter);

// ── HELPERS ───────────────────────────────────────────────────

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function sanitize(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLen);
}

// ── ROUTES ────────────────────────────────────────────────────

/**
 * POST /api/signup
 * Captures early access email signups
 */
app.post('/api/signup', signupLimiter, async (req, res) => {
  const email    = sanitize(req.body.email || '').toLowerCase();
  const source   = sanitize(req.body.source || 'website');
  const name     = sanitize(req.body.name || '');

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email address required.' });
  }

  console.log(`[Signup] ${email} from ${source} (${new Date().toISOString()})`);

  try {
    const result = await pool.query(
      `INSERT INTO signups (email, name, source, ip_address, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email) DO UPDATE SET
         source = EXCLUDED.source,
         updated_at = NOW()
       RETURNING id, created_at, (xmax = 0) AS is_new`,
      [email, name, source, req.ip]
    );

    const isNew = result.rows[0]?.is_new;

    return res.status(201).json({
      success: true,
      message: isNew
        ? "You're on the list! We'll reach out within 48 hours."
        : "You're already on the list. We'll be in touch!",
      isNew,
    });

  } catch (err) {
    // If DB not available, still return success (logged to console)
    if (err.code === 'ECONNREFUSED' || err.code === '57P03') {
      console.log(`[Signup-NoDb] ${email}`);
      return res.status(201).json({
        success: true,
        message: "You're on the list! We'll reach out within 48 hours.",
      });
    }

    console.error('[Signup Error]', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/**
 * GET /api/count
 * Returns total signup count (for social proof counter)
 */
app.get('/api/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM signups');
    const count  = parseInt(result.rows[0].count, 10);
    return res.json({ count: count + 47 }); // 47 = baseline social proof
  } catch {
    return res.json({ count: 47 });
  }
});

/**
 * POST /api/contact
 * Contact / enterprise inquiry form
 */
app.post('/api/contact', signupLimiter, async (req, res) => {
  const email   = sanitize(req.body.email || '').toLowerCase();
  const name    = sanitize(req.body.name || '');
  const company = sanitize(req.body.company || '');
  const message = sanitize(req.body.message || '', 2000);
  const type    = sanitize(req.body.type || 'general'); // general | enterprise | demo

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  console.log(`[Contact] ${email} | ${company} | ${type}`);

  try {
    await pool.query(
      `INSERT INTO contacts (email, name, company, message, type, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [email, name, company, message, type, req.ip]
    );

    return res.status(201).json({ success: true, message: 'Message received. We\'ll be in touch shortly.' });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log(`[Contact-NoDb] ${email}: ${message}`);
      return res.status(201).json({ success: true });
    }
    console.error('[Contact Error]', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/**
 * POST /api/scan-event
 * Track when someone runs a scan (for analytics, no PII stored)
 */
app.post('/api/scan-event', async (req, res) => {
  const varCount = parseInt(req.body.varCount || 0, 10);
  const riskScore = parseFloat(req.body.riskScore || 0);
  const hasSignup = Boolean(req.body.hasSignup);

  console.log(`[Scan] vars=${varCount} risk=${riskScore} signed_up=${hasSignup}`);

  try {
    await pool.query(
      `INSERT INTO scan_events (var_count, risk_score, has_signup, ip_hash, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [varCount, riskScore, hasSignup,
       require('crypto').createHash('sha256').update(req.ip).digest('hex')]
    );
  } catch { /* non-critical */ }

  return res.json({ ok: true });
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── CATCH-ALL — serve frontend ─────────────────────────────────

app.get('*', (req, res) => {
  // API routes not matched
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found.' });
  }
  // Serve index.html for all other routes
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── START ─────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('  🌱 Grassion Server');
  console.log(`  ─────────────────────────────────`);
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log(`  Mode:       ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Database:   ${process.env.DATABASE_URL ? 'configured' : 'not configured (using console log fallback)'}`);
  console.log('');
});

module.exports = app;
