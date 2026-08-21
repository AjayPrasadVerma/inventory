#!/usr/bin/env node
/**
 * Mechanical guards for bug classes this codebase has actually shipped.
 *
 * Each rule exists because a real defect got through review. They are greps, not
 * a type system — cheap to run on every push, and they catch the mistakes that
 * compile fine and look right.
 *
 * Run: node scripts/guards.mjs        (exit 1 if any BLOCK rule matches)
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname — the repo path contains a space, which .pathname
// hands back percent-encoded.
const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/** @typedef {{ id: string, why: string, level: 'block'|'warn', files: RegExp, test: (line: string, path: string, all: string) => boolean }} Rule */

/** @type {Rule[]} */
const RULES = [
  {
    id: 'tailwind-dynamic-class',
    level: 'block',
    why: 'Tailwind scans source text. A class assembled from a template literal is never emitted, '
       + 'so the element silently loses that style. This shipped once and collapsed every '
       + 'line-item table to a single column.',
    files: /\.(tsx|jsx)$/,
    // An arbitrary-value utility (…-[…]) whose value is interpolated.
    test: (line) => /-\[[^\]]*\$\{/.test(line),
  },
  {
    id: 'location-search-in-page',
    level: 'block',
    why: 'Reading window.location.search in a mount-only effect does not re-run when the App Router '
       + 'changes only the query string, so navigating to the same route with different params is a '
       + 'no-op. Use useSearchParams() so the read is reactive.',
    files: /app\/.*\.tsx$/,
    test: (line) => /window\.location\.search/.test(line),
  },
  {
    id: 'utc-date-only',
    level: 'block',
    why: 'toISOString() is UTC. Deriving a date-only string from it shows the wrong day for part of '
       + 'every day in IST, and can make the real current day unreachable. Build dates from local '
       + 'parts (getFullYear/getMonth/getDate).',
    files: /\.(ts|tsx)$/,
    test: (line) => /toISOString\(\)\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\))/.test(line),
  },
  {
    id: 'inner-join-purchase-catalogue',
    level: 'block',
    why: 'purchase_items lines are EITHER a raw material or a finished product, so item_id/product_id '
       + 'are nullable. An inner JOIN on either catalogue silently drops the other kind of line — no '
       + 'error, the rows just are not there.',
    files: /\.ts$/,
    // Only when the join's right-hand column belongs to a purchase_items alias —
    // stock_movements.item_id and finished_stock_movements.product_id are NOT NULL,
    // so an inner join on those is correct and must not be flagged.
    test: (line, _p, all) => {
      const m = /(?<!LEFT\s)JOIN\s+(?:items|products)\s+\w+\s+ON\s+\w+\.id\s*=\s*(\w+)\.(?:item_id|product_id)/.exec(line);
      if (!m) return false;
      return new RegExp(`purchase_items\\s+${m[1]}\\b`).test(all);
    },
  },
  {
    id: 'like-without-escape',
    level: 'warn',
    why: 'A user-supplied LIKE/ILIKE pattern with an unescaped % or _ is a wildcard: searching "%" '
       + 'returns every row and defeats every index. Escape the term and declare ESCAPE.',
    files: /\.ts$/,
    test: (line, _p, all) => /ILIKE\s+\$/.test(line)
      && !/ESCAPE/.test(line)
      && /`%\$\{|\$\{[^}]*\}%`|%\$\{/.test(all),
  },
  {
    id: 'unparameterised-sql',
    level: 'block',
    why: 'SQL must be parameterised with $1, $2 … Interpolating a value into the statement is an '
       + 'injection risk. (Interpolating a *placeholder number* or a whitelisted column is fine, '
       + 'which is why this only fires on quoted interpolation.)',
    files: /\.ts$/,
    // Must look like SQL: a quoted interpolation in an error message or a log line
    // is not an injection risk, and flagging those trains people to ignore the guard.
    test: (line) => /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|VALUES|SET)\b/.test(line)
      && (/'\$\{(?!params\.length)/.test(line) || /"\$\{(?!params\.length)/.test(line)),
  },
];

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), out);
    } else {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const files = await walk(ROOT);
/** @type {{rule: Rule, path: string, line: number, text: string}[]} */
const hits = [];

for (const path of files) {
  const rules = RULES.filter((r) => r.files.test(path));
  if (!rules.length) continue;
  let all;
  try { all = readFileSync(path, 'utf8'); } catch { continue; }
  if (all.includes('guards-allow-file')) continue;
  const lines = all.split('\n');
  for (const rule of rules) {
    lines.forEach((text, i) => {
      if (text.includes('guards-allow')) return;
      if (rule.test(text, path, all)) {
        hits.push({ rule, path: relative(ROOT, path), line: i + 1, text: text.trim() });
      }
    });
  }
}

const byRule = new Map();
for (const h of hits) {
  if (!byRule.has(h.rule.id)) byRule.set(h.rule.id, { rule: h.rule, hits: [] });
  byRule.get(h.rule.id).hits.push(h);
}

let blocked = 0;
if (!byRule.size) {
  console.log('guards: all clear');
} else {
  for (const { rule, hits: rh } of byRule.values()) {
    const tag = rule.level === 'block' ? 'BLOCK' : 'warn ';
    if (rule.level === 'block') blocked += rh.length;
    console.log(`\n[${tag}] ${rule.id} — ${rh.length} hit${rh.length === 1 ? '' : 's'}`);
    console.log(`        ${rule.why}`);
    for (const h of rh.slice(0, 12)) {
      console.log(`        ${h.path}:${h.line}`);
      console.log(`            ${h.text.slice(0, 120)}`);
    }
    if (rh.length > 12) console.log(`        … and ${rh.length - 12} more`);
  }
  console.log(`\nguards: ${blocked} blocking, ${hits.length - blocked} warning`);
  console.log('To allow a specific line, append a "guards-allow" comment with a reason.');
}

process.exit(blocked > 0 ? 1 : 0);
