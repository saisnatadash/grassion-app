/**
 * GRASSION — EnvGuard Scanner Engine
 * Runs entirely in the browser. Zero data sent to server.
 * Analyzes .env file contents and returns structured findings.
 */

const GrassionScanner = (() => {

  // ── KNOWN PATTERNS ─────────────────────────────────────────

  const CRITICAL_PATTERNS = [
    /payment/i, /stripe/i, /razorpay/i, /paytm/i,
    /auth/i, /jwt/i, /secret/i, /private/i,
    /database/i, /db_/i, /postgres/i, /mysql/i, /mongo/i,
    /redis/i, /aws/i, /gcp/i, /azure/i,
    /api_key/i, /api_secret/i, /master/i, /root/i
  ];

  const DEAD_SIGNALS = [
    /^legacy_/i, /^old_/i, /^deprecated_/i, /^unused_/i,
    /^temp_/i, /^test_only_/i, /^backup_/i, /^archive_/i,
    /_v1$/i, /_old$/i, /_bak$/i, /_backup$/i, /_tmp$/i
  ];

  const SECRET_PATTERNS = [
    { pattern: /password/i,     label: 'Password field'         },
    { pattern: /secret/i,       label: 'Secret key'             },
    { pattern: /private_key/i,  label: 'Private key'            },
    { pattern: /token/i,        label: 'Auth token'             },
    { pattern: /api_key/i,      label: 'API key'                },
    { pattern: /access_key/i,   label: 'Access key'             },
    { pattern: /signing/i,      label: 'Signing secret'         },
    { pattern: /webhook.*secret/i, label: 'Webhook secret'      },
  ];

  const NAMING_RULES = [
    { test: name => /[a-z]/.test(name) && !/^#/.test(name),
      issue: 'Non-uppercase variable name', severity: 'low' },
    { test: name => /\s/.test(name),
      issue: 'Variable name contains spaces', severity: 'high' },
    { test: name => /^[0-9]/.test(name),
      issue: 'Variable name starts with a digit', severity: 'high' },
    { test: name => name.length > 60,
      issue: 'Unusually long variable name (>60 chars)', severity: 'low' },
    { test: name => name.length < 3,
      issue: 'Suspiciously short variable name', severity: 'medium' },
  ];

  const SUSPICIOUS_VALUES = [
    { pattern: /^(todo|fixme|changeme|yourvalue|placeholder|xxx+|aaa+|123456|test123|password123)$/i,
      label: 'Placeholder value — must be changed before production' },
    { pattern: /^(true|false|yes|no|on|off|1|0|null|none|undefined)$/i,
      label: 'Boolean/null-like value — verify this is intentional' },
    { pattern: /localhost|127\.0\.0\.1|0\.0\.0\.0/,
      label: 'Localhost value — likely wrong in production' },
    { pattern: /^.{1,3}$/,
      label: 'Very short value — may be incomplete or placeholder' },
  ];

  // ── PARSER ─────────────────────────────────────────────────

  function parseEnvFile(content) {
    const lines = content.split('\n');
    const variables = [];
    let currentComment = [];
    let lineNum = 0;

    for (const raw of lines) {
      lineNum++;
      const line = raw.trim();

      // Comment lines
      if (line.startsWith('#')) {
        currentComment.push(line.replace(/^#+\s*/, ''));
        continue;
      }

      // Empty lines reset comment block
      if (!line) {
        currentComment = [];
        continue;
      }

      // Parse KEY=VALUE
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) {
        currentComment = [];
        continue;
      }

      const name  = line.substring(0, eqIdx).trim();
      let   value = line.substring(eqIdx + 1).trim();

      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!name) { currentComment = []; continue; }

      variables.push({
        name,
        value,
        lineNumber: lineNum,
        comment: currentComment.join(' ').trim() || null,
        hasValue: value.length > 0,
      });

      currentComment = [];
    }

    return variables;
  }

  // ── ANALYSIS ───────────────────────────────────────────────

  function analyzeVariable(v) {
    const findings = [];
    let riskScore = 0;
    let category = 'active';

    // 1. Criticality
    const isCritical = CRITICAL_PATTERNS.some(p => p.test(v.name));
    if (isCritical) {
      category = 'critical';
      riskScore += 3;
    }

    // 2. Dead signals
    const isDeadByName = DEAD_SIGNALS.some(p => p.test(v.name));
    if (isDeadByName) {
      category = 'dead';
      findings.push({ type: 'dead', message: 'Name pattern suggests this is deprecated or legacy', severity: 'medium' });
      riskScore += 1;
    }

    // 3. Empty value
    if (!v.hasValue) {
      findings.push({ type: 'empty', message: 'Variable has no value — may cause silent failures', severity: 'high' });
      riskScore += 4;
      if (!isCritical) category = 'warning';
    }

    // 4. Secret patterns
    SECRET_PATTERNS.forEach(({ pattern, label }) => {
      if (pattern.test(v.name)) {
        findings.push({ type: 'secret', message: label + ' — ensure this is not committed to version control', severity: 'info' });
      }
    });

    // 5. Suspicious values
    if (v.hasValue) {
      SUSPICIOUS_VALUES.forEach(({ pattern, label }) => {
        if (pattern.test(v.value)) {
          findings.push({ type: 'suspicious_value', message: label, severity: 'medium' });
          riskScore += 2;
        }
      });
    }

    // 6. Naming rules
    NAMING_RULES.forEach(({ test, issue, severity }) => {
      if (test(v.name)) {
        findings.push({ type: 'naming', message: issue, severity });
        if (severity === 'high') riskScore += 3;
        else if (severity === 'medium') riskScore += 1;
      }
    });

    // 7. Very long value (may be private key or cert)
    if (v.value && v.value.length > 200) {
      findings.push({ type: 'long_value', message: 'Value is very long — may be a private key or certificate', severity: 'info' });
    }

    // 8. URL in value
    if (v.value && /^https?:\/\//.test(v.value)) {
      const isLocalhost = /localhost|127\.0\.0\.1/.test(v.value);
      if (isLocalhost) {
        findings.push({ type: 'localhost_url', message: 'Points to localhost — will fail in production', severity: 'high' });
        riskScore += 3;
        category = 'warning';
      } else {
        findings.push({ type: 'url', message: 'Contains URL — verify this is correct for each environment', severity: 'info' });
      }
    }

    return {
      ...v,
      category,
      riskScore: Math.min(riskScore, 10),
      findings,
      isCritical,
    };
  }

  function groupByCategory(variables) {
    return {
      critical: variables.filter(v => v.category === 'critical'),
      active:   variables.filter(v => v.category === 'active'),
      dead:     variables.filter(v => v.category === 'dead'),
      warning:  variables.filter(v => v.category === 'warning'),
    };
  }

  function inferServiceGroups(variables) {
    const prefixes = {};
    variables.forEach(v => {
      const parts = v.name.split('_');
      if (parts.length >= 2) {
        const prefix = parts[0];
        if (!prefixes[prefix]) prefixes[prefix] = [];
        prefixes[prefix].push(v.name);
      }
    });

    // Only return groups with 2+ variables
    return Object.entries(prefixes)
      .filter(([, vars]) => vars.length >= 2)
      .map(([prefix, vars]) => ({ prefix, variables: vars }));
  }

  function calculateOverallRisk(variables) {
    if (!variables.length) return 0;
    const emptyCount    = variables.filter(v => !v.hasValue).length;
    const deadCount     = variables.filter(v => v.category === 'dead').length;
    const warningCount  = variables.filter(v => v.category === 'warning').length;
    const criticalEmpty = variables.filter(v => v.isCritical && !v.hasValue).length;

    let score = 0;
    score += (emptyCount / variables.length) * 3;
    score += (deadCount / variables.length) * 2;
    score += (warningCount / variables.length) * 2;
    score += criticalEmpty * 1.5;

    // Average variable risk
    const avgRisk = variables.reduce((s, v) => s + v.riskScore, 0) / variables.length;
    score += avgRisk * 0.5;

    return Math.min(Math.round(score * 10) / 10, 10.0);
  }

  function getRiskLabel(score) {
    if (score >= 7) return { label: 'HIGH RISK',    color: 'red'   };
    if (score >= 4) return { label: 'MEDIUM RISK',  color: 'amber' };
    return              { label: 'LOW RISK',     color: 'green' };
  }

  // ── DRIFT DETECTION ────────────────────────────────────────

  function detectDrift(vars1, vars2, label1 = 'File A', label2 = 'File B') {
    const map1 = Object.fromEntries(vars1.map(v => [v.name, v.value]));
    const map2 = Object.fromEntries(vars2.map(v => [v.name, v.value]));
    const all  = new Set([...Object.keys(map1), ...Object.keys(map2)]);

    const drifts = [];

    all.forEach(name => {
      if (!(name in map1)) {
        drifts.push({ name, type: 'missing_in_first',  label: `Missing in ${label1}`, severity: 'high' });
      } else if (!(name in map2)) {
        drifts.push({ name, type: 'missing_in_second', label: `Missing in ${label2}`, severity: 'high' });
      } else if (map1[name] !== map2[name]) {
        drifts.push({ name, type: 'value_mismatch',    label: 'Value mismatch between environments', severity: 'medium' });
      }
    });

    return drifts;
  }

  // ── REPORT GENERATOR ───────────────────────────────────────

  function generateSummary(variables, filename) {
    const analyzed  = variables.map(analyzeVariable);
    const groups    = groupByCategory(analyzed);
    const services  = inferServiceGroups(analyzed);
    const riskScore = calculateOverallRisk(analyzed);
    const riskInfo  = getRiskLabel(riskScore);

    const totalFindings = analyzed.reduce((s, v) => s + v.findings.length, 0);

    return {
      filename,
      scannedAt:    new Date().toISOString(),
      totalCount:   variables.length,
      riskScore,
      riskInfo,
      groups,
      services,
      totalFindings,
      analyzed,
      highlights: {
        emptyVariables:    analyzed.filter(v => !v.hasValue),
        deadVariables:     groups.dead,
        placeholderValues: analyzed.filter(v => v.findings.some(f => f.type === 'suspicious_value')),
        localhostUrls:     analyzed.filter(v => v.findings.some(f => f.type === 'localhost_url')),
        secrets:           analyzed.filter(v => v.findings.some(f => f.type === 'secret')),
      }
    };
  }

  // ── PUBLIC API ─────────────────────────────────────────────

  return {
    parse:          parseEnvFile,
    analyze:        analyzeVariable,
    scan:           generateSummary,
    detectDrift,
    getRiskLabel,
    calculateOverallRisk,
  };

})();

// Export for use in Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GrassionScanner;
}
