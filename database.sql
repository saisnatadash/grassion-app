-- ═══════════════════════════════════════════════════════════
-- GRASSION — PostgreSQL Database Schema
-- Run this file once to set up your database
--
-- Usage:
--   psql -U postgres -d grassion -f database.sql
-- Or on Railway/Supabase: paste into the SQL editor
-- ═══════════════════════════════════════════════════════════

-- Create database (run separately if needed)
-- CREATE DATABASE grassion;

-- ── SIGNUPS ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signups (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL UNIQUE,
  name         VARCHAR(255),
  source       VARCHAR(100) DEFAULT 'website',
  ip_address   VARCHAR(64),
  notes        TEXT,
  status       VARCHAR(50) DEFAULT 'waitlist',
    -- waitlist | contacted | onboarded | churned
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_signups_email      ON signups(email);
CREATE INDEX IF NOT EXISTS idx_signups_created_at ON signups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signups_status     ON signups(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_signups_updated_at
  BEFORE UPDATE ON signups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── CONTACTS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL,
  name         VARCHAR(255),
  company      VARCHAR(255),
  message      TEXT,
  type         VARCHAR(50) DEFAULT 'general',
    -- general | enterprise | demo | partnership
  ip_address   VARCHAR(64),
  responded    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_email      ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_responded  ON contacts(responded);

-- ── SCAN EVENTS (anonymous analytics) ─────────────────────────

CREATE TABLE IF NOT EXISTS scan_events (
  id           SERIAL PRIMARY KEY,
  var_count    INTEGER,
  risk_score   NUMERIC(4,2),
  has_signup   BOOLEAN DEFAULT FALSE,
  ip_hash      VARCHAR(64),      -- SHA256 hash, not raw IP
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scan_events(created_at DESC);

-- ── ADMIN VIEWS ───────────────────────────────────────────────

-- Quick view for founders to check signups
CREATE OR REPLACE VIEW signup_dashboard AS
SELECT
  DATE(created_at)  AS signup_date,
  COUNT(*)          AS total_signups,
  COUNT(*) FILTER (WHERE status = 'waitlist')   AS waitlist,
  COUNT(*) FILTER (WHERE status = 'contacted')  AS contacted,
  COUNT(*) FILTER (WHERE status = 'onboarded')  AS onboarded
FROM signups
GROUP BY DATE(created_at)
ORDER BY signup_date DESC;

-- Scan analytics view
CREATE OR REPLACE VIEW scan_dashboard AS
SELECT
  DATE(created_at)       AS scan_date,
  COUNT(*)               AS total_scans,
  ROUND(AVG(var_count))  AS avg_variables,
  ROUND(AVG(risk_score), 2) AS avg_risk_score,
  COUNT(*) FILTER (WHERE has_signup) AS converted_to_signup
FROM scan_events
GROUP BY DATE(created_at)
ORDER BY scan_date DESC;

-- ── SAMPLE QUERIES ────────────────────────────────────────────

-- Get all waitlist emails (for outreach):
-- SELECT email, name, source, created_at FROM signups ORDER BY created_at DESC;

-- Get total signup count:
-- SELECT COUNT(*) FROM signups;

-- Get signups from last 7 days:
-- SELECT * FROM signups WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC;

-- Mark someone as contacted:
-- UPDATE signups SET status = 'contacted' WHERE email = 'user@company.com';

-- View scan analytics:
-- SELECT * FROM scan_dashboard;

-- View signup trends:
-- SELECT * FROM signup_dashboard;

-- ── SEED DATA (optional, for testing) ─────────────────────────

-- INSERT INTO signups (email, name, source, status) VALUES
--   ('test@example.com', 'Test User', 'demo', 'waitlist');
