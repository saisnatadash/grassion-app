/**
 * GRASSION — Backend Server
 * Node.js + Express
 * Handles: Email signups, waitlist storage, basic API
 */

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool }  = require('pg');
const path      = require('path');

require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 8080;

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
    initDB();
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
    console.log('✓ Tables ready');
  } catch (err) {
    console.error('Table creation error:', err.message);
  }
};

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiter for signup endpoint
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many requests, please try again later.' }
});

// ── STATIC FILES ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '.')));

// ── ROUTES ────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Email signup
app.post('/api/signup', signupLimiter, async (req, res) => {
  const { email, name, company, source } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  const cleanEmail   = email.trim().toLowerCase();
  const cleanName    = name    ? name.trim()    : null;
  const cleanCompany = company ? company.trim() : null;
  const cleanSource  = source  || 'landing';

  try {
    const result = await pool.query(
      `INSERT INTO signups (email, name, company, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
       RETURNING id, email, created_at`,
      [cleanEmail, cleanName, cleanCompany, cleanSource]
    );

    console.log('✓ Signup saved:', cleanEmail);
    return res.status(201).json({
      success: true,
      message: 'You\'re on the waitlist!',
      data: { email: result.rows[0].email }
    });

  } catch (err) {
    // Fallback: log to console if DB is down
    console.log('SIGNUP (no DB):', cleanEmail, cleanName, cleanCompany);
    return res.status(201).json({
      success: true,
      message: 'You\'re on the waitlist!'
    });
  }
});

// Get all signups (admin)
app.get('/api/signups', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY && process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM signups ORDER BY created_at DESC'
    );
    res.json({ count: result.rows.length, signups: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
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
  console.log('  🌿 Grassion Server');
  console.log('  ──────────────────────────────');
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log(`  Mode:       ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Database:   ${process.env.DATABASE_URL ? 'configured ✓' : 'NOT SET ✗'}`);
  console.log('');
});

module.exports = app;
