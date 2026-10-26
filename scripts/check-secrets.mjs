#!/usr/bin/env node
/**
 * Repository secret scan.
 *
 * Scans tracked files for credential-shaped strings and for tracked `.env` files. This is
 * a lightweight guard for this repository, not a replacement for a full secret-scanning
 * product: it catches obvious mistakes (committed keys, tokens, private keys, dumps)
 * before they reach a remote.
 *
 * Usage: node scripts/check-secrets.mjs [--all]
 *   --all  also scan untracked files (default: git-tracked files only)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  { name: 'private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', regex: /\bxox[abpsr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Telegram bot token', regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm token', regex: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Stripe live key', regex: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  {
    name: 'assigned secret literal',
    regex: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9/+_=-]{24,}['"]/i
  }
];

/** Placeholders documented in .env.example and test fixtures are not secrets. */
const ALLOWLIST = [
  /replace-with-at-least-32-random-characters/,
  /change-me/,
  /local_dev_only_change_me/,
  /test_only/,
  /nse_pulse_test/,
  /test-secret-key-value-9f4b2c/,
  /123456:TEST_TOKEN/,
  /postgres:\/\/[^\s'"]*:(?:change-me|local_dev_only_change_me)@/,
  /\$\{[A-Z_]+\}/,
  /example\.invalid/,
  /process\.env\./
];

const MAX_BYTES = 512 * 1024;
const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp4|mp3)$/i;

function listFiles(scanAll) {
  const args = scanAll ? ['ls-files', '--cached', '--others', '--exclude-standard'] : ['ls-files', '--cached'];
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function scanFile(path) {
  if (BINARY_EXTENSIONS.test(path)) return [];
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return [];
  }
  if (size > MAX_BYTES) return [];
  const content = readFileSync(path, 'utf8');
  const findings = [];
  for (const { name, regex } of PATTERNS) {
    const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    for (const match of content.matchAll(global)) {
      const sample = match[0];
      if (ALLOWLIST.some((allowed) => allowed.test(sample))) continue;
      const line = content.slice(0, match.index).split('\n').length;
      findings.push({ file: path, line, kind: name });
    }
  }
  return findings;
}

const scanAll = process.argv.includes('--all');
const files = listFiles(scanAll);
const findings = [];
const trackedEnvFiles = files.filter((path) => /(^|\/)\.env(\.|$)/.test(path) && !path.endsWith('.env.example'));

for (const path of files) findings.push(...scanFile(path));

if (trackedEnvFiles.length) {
  for (const file of trackedEnvFiles) findings.push({ file, line: 1, kind: 'tracked .env file' });
}

if (findings.length) {
  console.error(`Secret scan failed: ${findings.length} finding(s).`);
  for (const finding of findings) console.error(`  ${finding.file}:${finding.line} — ${finding.kind}`);
  console.error('Remove the value, rotate the credential, and purge it from history before pushing.');
  process.exit(1);
}

console.log(`Secret scan passed: ${files.length} file(s) scanned, no credential-shaped strings found.`);
