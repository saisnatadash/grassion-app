/**
 * GRASSION — Dashboard UI Logic
 * Handles file uploads, rendering results, drift detection,
 * report generation and all user interactions.
 */

// ── STATE ──────────────────────────────────────────────────────

let state = {
  scanResult:  null,
  driftResult: null,
  stagingVars: null,
  prodVars:    null,
  filename:    '',
  currentTab:  'all',
};

// ── DEMO DATA ──────────────────────────────────────────────────

const DEMO_ENV = `# ─────────────────────────────────────────
# Application Configuration
# ─────────────────────────────────────────

NODE_ENV=production
PORT=3000
APP_URL=https://api.yourapp.com
APP_SECRET=changeme

# Database
DATABASE_URL=postgresql://user:password123@localhost:5432/myapp
DB_POOL_SIZE=10
DB_SSL=true

# Legacy database (migrated to DATABASE_URL)
LEGACY_POSTGRES_URL=
OLD_DB_HOST=localhost
OLD_DB_PORT=5432
DEPRECATED_DB_USER=admin

# Redis
REDIS_URL=redis://localhost:6379
REDIS_TTL=3600

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRY=7d
AUTH_TOKEN_SECRET=xxx
REFRESH_TOKEN_EXPIRY=30d

# Stripe
STRIPE_PUBLIC_KEY=pk_test_51234567890
STRIPE_SECRET_KEY=sk_test_abcdefghijk
STRIPE_WEBHOOK_SECRET=whsec_placeholder

# Razorpay (migrated from Stripe)
RAZORPAY_KEY_ID=rzp_test_abc123
RAZORPAY_KEY_SECRET=

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@yourapp.com
SMTP_PASS=emailpassword123

# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET_NAME=my-app-uploads

# Feature Flags
ENABLE_DARK_MODE=true
ENABLE_PAYMENTS=true
ENABLE_BETA_FEATURES=false
TEMP_DISABLE_EMAILS=true

# Analytics
SEGMENT_WRITE_KEY=
MIXPANEL_TOKEN=todo

# Monitoring
SENTRY_DSN=https://abc123@sentry.io/12345
DD_API_KEY=

# Backup / Archive
ARCHIVE_API_KEY=old-key-from-2022
BACKUP_WEBHOOK_URL=https://hooks.slack.com/services/old/webhook
OLD_SLACK_TOKEN=xoxb-old-token

# Misc
MAX_FILE_SIZE=10mb
API_RATE_LIMIT=100
a=1
`;

// ── FILE HANDLING ──────────────────────────────────────────────

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  readAndScan(file);
}

function handleFileUpload2(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    state.stagingVars = GrassionScanner.parse(e.target.result);
    document.getElementById('uploadZone2').style.borderColor = 'var(--green)';
    document.getElementById('uploadZone2').querySelector('p').textContent = '✓ ' + file.name;
  };
  reader.readAsText(file);
}

function handleFileUpload3(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    state.prodVars = GrassionScanner.parse(e.target.result);
    document.getElementById('uploadZone3').style.borderColor = 'var(--green)';
    document.getElementById('uploadZone3').querySelector('p').textContent = '✓ ' + file.name;
  };
  reader.readAsText(file);
}

function readAndScan(file) {
  const reader = new FileReader();
  reader.onload = e => {
    state.filename = file.name;
    runScan(e.target.result, file.name);
  };
  reader.readAsText(file);
}

function loadDemo() {
  state.filename = 'demo.env (sample)';
  showScanning('Loading demo data...');
  setTimeout(() => {
    runScan(DEMO_ENV, 'demo.env');
  }, 600);
}

function runScan(content, filename) {
  showScanning('Parsing variables...');

  setTimeout(() => {
    updateProgress('Analyzing patterns...');
    setTimeout(() => {
      updateProgress('Calculating risk scores...');
      setTimeout(() => {
        const variables = GrassionScanner.parse(content);
        const result    = GrassionScanner.scan(variables, filename);
        state.scanResult = result;
        hideScanning();
        renderResults(result);
      }, 300);
    }, 300);
  }, 300);
}

function runDriftScan() {
  if (!state.stagingVars || !state.prodVars) {
    alert('Please upload both staging and production .env files first.');
    return;
  }
  const drifts = GrassionScanner.detectDrift(state.stagingVars, state.prodVars, 'Staging', 'Production');
  state.driftResult = drifts;

  // Also scan the staging file as main
  const result = GrassionScanner.scan(state.stagingVars, 'staging.env');
  state.scanResult = result;
  hideScanning();
  renderResults(result, drifts);
}

// ── SCANNING OVERLAY ───────────────────────────────────────────

function showScanning(msg) {
  document.getElementById('scanningOverlay').classList.add('show');
  document.getElementById('scanProgress').textContent = msg || 'Scanning...';
}

function updateProgress(msg) {
  document.getElementById('scanProgress').textContent = msg;
}

function hideScanning() {
  document.getElementById('scanningOverlay').classList.remove('show');
}

// ── RENDER RESULTS ─────────────────────────────────────────────

function renderResults(result, drifts = []) {
  document.getElementById('uploadSection').style.display = 'none';
  const resultsEl = document.getElementById('results');
  resultsEl.classList.add('show');

  // Filename
  document.getElementById('scanFilename').textContent = `Scanned: ${result.filename} · ${result.totalCount} variables found`;

  // Score
  const scoreEl = document.getElementById('scoreNum');
  scoreEl.textContent = result.riskScore.toFixed(1);
  scoreEl.className = `score-num ${result.riskInfo.color}`;
  document.getElementById('scoreTag').innerHTML = `<span class="tag tag-${result.riskInfo.color === 'amber' ? 'amber' : result.riskInfo.color === 'red' ? 'red' : 'green'}">${result.riskInfo.label}</span>`;

  // Stats
  document.getElementById('statDead').textContent    = result.groups.dead.length + result.groups.warning.length;
  document.getElementById('statWarning').textContent = result.totalFindings;
  document.getElementById('statTotal').textContent   = result.totalCount;

  // Tab counts
  document.getElementById('tabCountAll').textContent      = result.totalCount;
  document.getElementById('tabCountCritical').textContent = result.groups.critical.length;
  document.getElementById('tabCountDead').textContent     = result.groups.dead.length;
  document.getElementById('tabCountWarnings').textContent = result.groups.warning.length;

  // Summary cards
  renderSummaryCards(result);

  // Tables
  renderVarTable('tableAll',      result.analyzed);
  renderVarTable('tableCritical', result.groups.critical);
  renderVarTable('tableDead',     result.groups.dead);
  renderVarTable('tableWarnings', result.groups.warning);
  renderServices(result.services, result.analyzed);

  // Drift
  if (drifts.length > 0) {
    renderDrift(drifts);
    document.getElementById('driftTab').style.display = 'inline-block';
    document.getElementById('tabCountDrift').textContent = drifts.length;
  }

  // Scroll to results
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSummaryCards(result) {
  const { groups, totalCount, totalFindings, highlights } = result;
  const pct = n => Math.round((n / totalCount) * 100);

  document.getElementById('summaryGrid').innerHTML = `
    <div class="summary-card">
      <div class="s-num active">${groups.critical.length}</div>
      <div class="s-label">Critical variables<br><small style="font-size:11px;color:var(--ink4);">${pct(groups.critical.length)}% of total</small></div>
    </div>
    <div class="summary-card">
      <div class="s-num dead">${groups.dead.length}</div>
      <div class="s-label">Dead variables<br><small style="font-size:11px;color:var(--ink4);">Safe to remove · saves ~${Math.round(groups.dead.length * 2)} min/week</small></div>
    </div>
    <div class="summary-card">
      <div class="s-num warn">${highlights.emptyVariables.length}</div>
      <div class="s-label">Empty values<br><small style="font-size:11px;color:var(--ink4);">Risk of silent failures</small></div>
    </div>
    <div class="summary-card">
      <div class="s-num critical">${totalFindings}</div>
      <div class="s-label">Total findings<br><small style="font-size:11px;color:var(--ink4);">Across ${totalCount} variables</small></div>
    </div>
  `;
}

function renderVarTable(containerId, variables) {
  const el = document.getElementById(containerId);

  if (!variables || !variables.length) {
    el.innerHTML = `<div class="empty-state"><div class="e-icon">✓</div><p>No variables in this category</p></div>`;
    return;
  }

  const header = `
    <div class="var-table-header">
      <span>Variable Name</span>
      <span>Findings</span>
      <span>Line</span>
      <span style="text-align:right">Risk</span>
    </div>
  `;

  const rows = variables.map(v => {
    const chips = v.findings.map(f =>
      `<span class="finding-chip ${f.severity}">${f.message}</span>`
    ).join('');

    const emptyBadge = !v.hasValue
      ? `<span class="finding-chip high">⚠ Empty value</span>` : '';

    const riskColor = v.riskScore >= 7 ? 'var(--red)' : v.riskScore >= 4 ? 'var(--amber)' : 'var(--ink4)';

    return `
      <div class="var-row">
        <div>
          <div class="var-name">${escHtml(v.name)}</div>
          ${v.comment ? `<div style="font-size:11px;color:var(--ink4);margin-top:3px;font-family:var(--font-mono);"># ${escHtml(v.comment.substring(0,60))}${v.comment.length > 60 ? '…' : ''}</div>` : ''}
        </div>
        <div class="var-findings">
          ${emptyBadge}
          ${chips || '<span style="font-size:12px;color:var(--ink4);">No issues found</span>'}
        </div>
        <div class="var-line">L${v.lineNumber}</div>
        <div class="var-risk" style="color:${riskColor}">${v.riskScore > 0 ? v.riskScore.toFixed(0) : '—'}</div>
      </div>
    `;
  }).join('');

  el.innerHTML = header + rows;
}

function renderServices(services, analyzed) {
  const el = document.getElementById('servicesPanel');

  if (!services.length) {
    el.innerHTML = `<div class="empty-state"><div class="e-icon">📦</div><p>No service groups detected (need 2+ variables with same prefix)</p></div>`;
    return;
  }

  el.innerHTML = services.map(s => {
    const vars = s.variables.map(name => {
      const v = analyzed.find(a => a.name === name);
      const color = v && v.riskScore >= 7 ? 'var(--red-bg);color:var(--red)' :
                    v && v.riskScore >= 4 ? 'var(--amber-bg);color:var(--amber)' : '';
      return `<span class="service-var-chip" style="background:${color || 'var(--bg2);color:var(--ink2)'};">${escHtml(name)}</span>`;
    }).join('');

    return `
      <div class="service-group">
        <div class="service-header">
          <span class="service-name">${escHtml(s.prefix)}_*</span>
          <span class="service-count">${s.variables.length} variables</span>
        </div>
        <div class="service-vars">${vars}</div>
      </div>
    `;
  }).join('');
}

function renderDrift(drifts) {
  const el = document.getElementById('driftPanel');

  if (!drifts.length) {
    el.innerHTML = `<div class="empty-state"><div class="e-icon">✓</div><p>No drift detected — environments are in sync!</p></div>`;
    return;
  }

  const header = `
    <div style="padding:16px 20px;background:var(--red-bg);border-bottom:1px solid rgba(192,57,43,0.15);">
      <p style="font-size:14px;color:var(--red);font-weight:500;">⚠ ${drifts.length} drift item${drifts.length !== 1 ? 's' : ''} detected between environments</p>
    </div>
  `;

  const items = drifts.map(d => `
    <div class="drift-item">
      <span class="drift-badge ${d.severity}">${d.severity.toUpperCase()}</span>
      <div>
        <div class="drift-name">${escHtml(d.name)}</div>
        <div class="drift-label">${escHtml(d.label)}</div>
      </div>
    </div>
  `).join('');

  el.innerHTML = header + items;
}

// ── TABS ───────────────────────────────────────────────────────

function switchTab(tab, btn) {
  state.currentTab = tab;

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  btn.classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
}

// ── RESET ──────────────────────────────────────────────────────

function resetScanner() {
  state = { scanResult: null, driftResult: null, stagingVars: null, prodVars: null, filename: '', currentTab: 'all' };

  document.getElementById('uploadSection').style.display = 'block';
  document.getElementById('results').classList.remove('show');
  document.getElementById('fileInput').value = '';

  // Reset all tabs
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.querySelectorAll('.tab-panel').forEach((p, i) => p.classList.toggle('active', i === 0));

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleCompare() {
  const zone = document.getElementById('compareZone');
  zone.classList.toggle('show', document.getElementById('compareToggle').checked);
}

// ── REPORT DOWNLOAD ────────────────────────────────────────────

function downloadReport() {
  const r = state.scanResult;
  if (!r) return;

  const riskColor = r.riskInfo.color === 'red' ? '#C0392B' : r.riskInfo.color === 'amber' ? '#B45309' : '#1B5E3B';

  const varRows = r.analyzed.map(v => `
    <tr style="border-bottom:1px solid #f0f0ec;">
      <td style="padding:12px 16px;font-family:monospace;font-size:13px;font-weight:500;">${escHtml(v.name)}</td>
      <td style="padding:12px 16px;font-size:13px;color:#666;">${v.lineNumber}</td>
      <td style="padding:12px 16px;">
        ${v.findings.map(f => `<span style="display:inline-block;padding:2px 8px;background:${f.severity==='high'?'#fdf0ee':f.severity==='medium'?'#fef8ee':'#f0f5f0'};color:${f.severity==='high'?'#c0392b':f.severity==='medium'?'#b45309':'#1b5e3b'};border-radius:4px;font-size:11px;margin:2px;">${escHtml(f.message)}</span>`).join('')}
        ${!v.hasValue ? '<span style="display:inline-block;padding:2px 8px;background:#fdf0ee;color:#c0392b;border-radius:4px;font-size:11px;margin:2px;">⚠ Empty value</span>' : ''}
        ${!v.findings.length && v.hasValue ? '<span style="color:#999;font-size:12px;">Clean</span>' : ''}
      </td>
      <td style="padding:12px 16px;font-size:13px;text-align:right;color:${v.riskScore>=7?'#c0392b':v.riskScore>=4?'#b45309':'#999'};">${v.riskScore > 0 ? v.riskScore : '—'}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Grassion Report — ${escHtml(r.filename)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#fafaf8; color:#1a1a18; margin:0; padding:40px; }
  .header { background:#1a1a18; color:#fff; padding:40px; border-radius:12px; margin-bottom:32px; }
  .header h1 { font-size:28px; margin-bottom:8px; letter-spacing:-0.5px; }
  .header p { color:rgba(255,255,255,0.5); font-size:14px; margin:0; }
  .score-row { display:flex; gap:20px; margin-bottom:32px; flex-wrap:wrap; }
  .score-box { background:#fff; border:1px solid #e2e2dc; border-radius:12px; padding:24px 28px; }
  .score-box .num { font-size:40px; font-weight:700; letter-spacing:-1px; color:${riskColor}; line-height:1; }
  .score-box .lbl { font-size:12px; color:#999; margin-top:6px; text-transform:uppercase; letter-spacing:0.05em; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e2dc; border-radius:12px; overflow:hidden; }
  th { background:#f4f4f1; padding:12px 16px; font-size:11px; text-align:left; color:#999; text-transform:uppercase; letter-spacing:0.06em; }
  .footer { margin-top:40px; text-align:center; font-size:12px; color:#ccc; }
  @media print { body { padding:20px; } }
</style>
</head>
<body>
<div class="header">
  <h1>Grassion Config Report</h1>
  <p>File: ${escHtml(r.filename)} · Scanned: ${new Date(r.scannedAt).toLocaleString()} · Total variables: ${r.totalCount}</p>
</div>
<div class="score-row">
  <div class="score-box"><div class="num">${r.riskScore.toFixed(1)}</div><div class="lbl">Risk Score / 10 — ${r.riskInfo.label}</div></div>
  <div class="score-box"><div class="num" style="color:#c0392b;">${r.groups.dead.length}</div><div class="lbl">Dead Variables</div></div>
  <div class="score-box"><div class="num" style="color:#b45309;">${r.totalFindings}</div><div class="lbl">Total Findings</div></div>
  <div class="score-box"><div class="num" style="color:#1b5e3b;">${r.groups.critical.length}</div><div class="lbl">Critical Variables</div></div>
</div>
<table>
  <thead><tr><th>Variable</th><th>Line</th><th>Findings</th><th style="text-align:right;">Risk</th></tr></thead>
  <tbody>${varRows}</tbody>
</table>
<div class="footer">Generated by Grassion · Powered by EnvGuard · grassion.io</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `grassion-report-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── DRAG AND DROP ──────────────────────────────────────────────

const uploadZone = document.getElementById('uploadZone');

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readAndScan(file);
});

// ── UTILS ──────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
