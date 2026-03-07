/**
 * GRASSION — Backend Server
 * Full analytics, payments, feedback, scan tracking
 */

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool }  = require('pg');
const path      = require('path');
const crypto    = require('crypto');

require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 8080;

// ── DATABASE ──────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(client => { console.log('✓ Database connected'); client.release(); initDB(); })
  .catch(err => { console.warn('⚠ Database not connected:', err.message); });

const initDB = async () => {
  try {
    // Email signups / waitlist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signups (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        company VARCHAR(255),
        source VARCHAR(100) DEFAULT 'landing',
        status VARCHAR(50) DEFAULT 'waitlist',
        razorpay_payment_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Subscription payments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        razorpay_payment_id VARCHAR(255) UNIQUE NOT NULL,
        user_session_id VARCHAR(255),
        email VARCHAR(255),
        plan VARCHAR(50),
        amount INTEGER,
        currency VARCHAR(10) DEFAULT 'INR',
        status VARCHAR(50) DEFAULT 'captured',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Every scan event
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        user_email VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        filename VARCHAR(500),
        file_size_bytes INTEGER,
        total_variables INTEGER DEFAULT 0,
        critical_count INTEGER DEFAULT 0,
        dead_count INTEGER DEFAULT 0,
        warning_count INTEGER DEFAULT 0,
        risk_score NUMERIC(4,1) DEFAULT 0,
        services_detected TEXT[],
        scan_duration_ms INTEGER,
        is_demo BOOLEAN DEFAULT false,
        ip_country VARCHAR(10),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Per-scan accuracy/satisfaction rating
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scan_ratings (
        id SERIAL PRIMARY KEY,
        scan_id INTEGER REFERENCES scans(id),
        session_id VARCHAR(255),
        accuracy_rating INTEGER CHECK (accuracy_rating BETWEEN 1 AND 5),
        was_helpful BOOLEAN,
        comment TEXT,
        false_positives INTEGER DEFAULT 0,
        missed_issues INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // General product feedback
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        user_email VARCHAR(255),
        category VARCHAR(100),
        message TEXT NOT NULL,
        feature_request TEXT,
        sentiment VARCHAR(20),
        plan VARCHAR(50) DEFAULT 'free',
        page VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Session tracking (anonymous)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_email VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'free',
        total_scans INTEGER DEFAULT 0,
        total_time_seconds INTEGER DEFAULT 0,
        first_seen TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW(),
        referrer TEXT,
        country VARCHAR(10),
        converted_to_pro BOOLEAN DEFAULT false,
        converted_at TIMESTAMP
      )
    `);

    // Referrals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_code VARCHAR(50) NOT NULL,
        referrer_email VARCHAR(255),
        referred_email VARCHAR(255),
        bonus_scans_given INTEGER DEFAULT 10,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✓ All tables ready');
  } catch (err) {
    console.error('Table creation error:', err.message);
  }
};

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = (max) => rateLimit({ windowMs: 15*60*1000, max, message: { error: 'Too many requests.' } });

app.use(express.static(path.join(__dirname, '.')));

// ── ROUTES ────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Email signup
app.post('/api/signup', limiter(10), async (req, res) => {
  const { email, name, company, source } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required.' });
  const cleanEmail = email.trim().toLowerCase();
  try {
    await pool.query(
      `INSERT INTO signups (email, name, company, source) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET updated_at=NOW()`,
      [cleanEmail, name?.trim()||null, company?.trim()||null, source||'landing']
    );
    console.log('✓ Signup:', cleanEmail);
  } catch(e) { console.log('Signup fallback:', cleanEmail); }
  return res.status(201).json({ success: true, message: "You're on the waitlist!" });
});

// Record a scan
app.post('/api/scan', limiter(100), async (req, res) => {
  const {
    session_id, user_email, plan, filename, file_size_bytes,
    total_variables, critical_count, dead_count, warning_count,
    risk_score, services_detected, scan_duration_ms, is_demo
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO scans (
        session_id, user_email, plan, filename, file_size_bytes,
        total_variables, critical_count, dead_count, warning_count,
        risk_score, services_detected, scan_duration_ms, is_demo, user_agent
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id`,
      [
        session_id||null, user_email||null, plan||'free',
        filename||'unknown', file_size_bytes||0,
        total_variables||0, critical_count||0, dead_count||0, warning_count||0,
        risk_score||0, services_detected||[], scan_duration_ms||0,
        is_demo||false, req.headers['user-agent']?.substring(0,200)||null
      ]
    );

    // Update session
    if (session_id) {
      await pool.query(
        `INSERT INTO sessions (session_id, user_email, plan, total_scans, last_seen)
         VALUES ($1,$2,$3,1,NOW())
         ON CONFLICT (session_id) DO UPDATE SET
           total_scans = sessions.total_scans + 1,
           last_seen = NOW(),
           user_email = COALESCE($2, sessions.user_email)`,
        [session_id, user_email||null, plan||'free']
      );
    }

    return res.status(201).json({ success: true, scan_id: result.rows[0].id });
  } catch(e) {
    console.error('Scan record error:', e.message);
    return res.status(500).json({ error: 'Could not record scan.' });
  }
});

// Rate a scan
app.post('/api/scan/rate', limiter(30), async (req, res) => {
  const { scan_id, session_id, accuracy_rating, was_helpful, comment, false_positives, missed_issues } = req.body;
  if (!scan_id) return res.status(400).json({ error: 'scan_id required.' });
  try {
    await pool.query(
      `INSERT INTO scan_ratings (scan_id, session_id, accuracy_rating, was_helpful, comment, false_positives, missed_issues)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [scan_id, session_id||null, accuracy_rating||null, was_helpful||null, comment||null, false_positives||0, missed_issues||0]
    );
    return res.status(201).json({ success: true });
  } catch(e) {
    console.error('Rating error:', e.message);
    return res.status(500).json({ error: 'Could not save rating.' });
  }
});

// Submit feedback
app.post('/api/feedback', limiter(20), async (req, res) => {
  const { session_id, user_email, category, message, feature_request, sentiment, plan, page } = req.body;
  if (!message || message.trim().length < 3) return res.status(400).json({ error: 'Message too short.' });
  try {
    await pool.query(
      `INSERT INTO feedback (session_id, user_email, category, message, feature_request, sentiment, plan, page)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [session_id||null, user_email||null, category||'general', message.trim(),
       feature_request||null, sentiment||'neutral', plan||'free', page||'app']
    );
    console.log('✓ Feedback received');
    return res.status(201).json({ success: true, message: 'Thank you for your feedback!' });
  } catch(e) {
    console.error('Feedback error:', e.message);
    return res.status(500).json({ error: 'Could not save feedback.' });
  }
});

// Record payment
app.post('/api/payment', limiter(20), async (req, res) => {
  const { payment_id, session_id, email, plan, amount } = req.body;
  if (!payment_id) return res.status(400).json({ error: 'Payment ID required.' });
  try {
    await pool.query(
      `INSERT INTO payments (razorpay_payment_id, user_session_id, email, plan, amount)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (razorpay_payment_id) DO NOTHING`,
      [payment_id, session_id||null, email||null, plan||'unknown', amount||0]
    );
    // Mark session as converted
    if (session_id) {
      await pool.query(
        `UPDATE sessions SET converted_to_pro=true, converted_at=NOW(), plan=$2 WHERE session_id=$1`,
        [session_id, plan||'pro']
      );
    }
    console.log('✓ Payment recorded:', payment_id, plan);
    return res.status(201).json({ success: true });
  } catch(e) {
    console.error('Payment error:', e.message);
    return res.status(500).json({ error: 'Could not record payment.' });
  }
});

// Referral credit
app.post('/api/referral', limiter(20), async (req, res) => {
  const { referrer_code, new_user_email } = req.body;
  if (!referrer_code || !new_user_email) return res.status(400).json({ error: 'Missing fields.' });
  try {
    // Record referral
    await pool.query(
      `INSERT INTO referrals (referrer_code, referred_email) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [referrer_code, new_user_email.toLowerCase()]
    );
    // Count how many successful referrals this code has
    const count = await pool.query(
      'SELECT COUNT(*) as total FROM referrals WHERE referrer_code=$1',
      [referrer_code]
    );
    return res.status(201).json({ success: true, referral_count: parseInt(count.rows[0].total) });
  } catch(e) {
    console.error('Referral error:', e.message);
    return res.status(500).json({ error: 'Could not record referral.' });
  }
});

// Update session time
app.post('/api/session/ping', limiter(200), async (req, res) => {
  const { session_id, seconds_spent } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required.' });
  try {
    await pool.query(
      `INSERT INTO sessions (session_id, total_time_seconds, last_seen)
       VALUES ($1,$2,NOW())
       ON CONFLICT (session_id) DO UPDATE SET
         total_time_seconds = sessions.total_time_seconds + $2,
         last_seen = NOW()`,
      [session_id, seconds_spent||30]
    );
    return res.status(200).json({ success: true });
  } catch(e) {
    return res.status(500).json({ error: 'Could not update session.' });
  }
});

// ── ADMIN ANALYTICS ──────────────────────────────────────────
app.get('/api/admin/analytics', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && adminKey !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [signups, payments, scans, ratings, feedback, sessions, topServices, dailyScans] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=\'pro\' THEN 1 END) as pro FROM signups'),
      pool.query('SELECT COUNT(*) as total, SUM(amount) as revenue, plan, COUNT(*) FROM payments GROUP BY plan'),
      pool.query(`SELECT
        COUNT(*) as total_scans,
        COUNT(CASE WHEN is_demo=false THEN 1 END) as real_scans,
        AVG(risk_score)::numeric(4,1) as avg_risk,
        AVG(total_variables)::numeric(5,1) as avg_vars,
        AVG(scan_duration_ms) as avg_duration_ms,
        COUNT(DISTINCT session_id) as unique_users
        FROM scans`),
      pool.query('SELECT AVG(accuracy_rating)::numeric(3,1) as avg_accuracy, COUNT(*) as total_ratings, COUNT(CASE WHEN was_helpful=true THEN 1 END) as helpful FROM scan_ratings'),
      pool.query('SELECT COUNT(*) as total, category, COUNT(*) FROM feedback GROUP BY category ORDER BY count DESC'),
      pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN converted_to_pro=true THEN 1 END) as converted, AVG(total_scans)::numeric(5,1) as avg_scans, AVG(total_time_seconds)::numeric(8,1) as avg_time_sec FROM sessions'),
      pool.query(`SELECT unnest(services_detected) as service, COUNT(*) as count FROM scans WHERE services_detected IS NOT NULL GROUP BY service ORDER BY count DESC LIMIT 10`),
      pool.query(`SELECT DATE(created_at) as date, COUNT(*) as scans FROM scans WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date`)
    ]);

    res.json({
      signups: signups.rows[0],
      payments: payments.rows,
      scans: scans.rows[0],
      ratings: ratings.rows[0],
      feedback: feedback.rows,
      sessions: sessions.rows[0],
      top_services: topServices.rows,
      daily_scans_30d: dailyScans.rows
    });
  } catch(e) {
    console.error('Analytics error:', e.message);
    res.status(500).json({ error: 'Analytics query failed.' });
  }
});

app.get('/api/admin/signups', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && adminKey !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    const [signups, payments] = await Promise.all([
      pool.query('SELECT * FROM signups ORDER BY created_at DESC LIMIT 500'),
      pool.query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 500')
    ]);
    res.json({
      signups: { count: signups.rows.length, data: signups.rows },
      payments: { count: payments.rows.length, data: payments.rows }
    });
  } catch(e) { res.status(500).json({ error: 'Database error' }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log('\n  🌿 Grassion Server');
  console.log('  ──────────────────────────────');
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log(`  Mode:       ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Database:   ${process.env.DATABASE_URL ? 'configured ✓' : 'NOT SET ✗'}\n`);
});

module.exports = app;
