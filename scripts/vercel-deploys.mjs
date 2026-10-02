#!/usr/bin/env node
// Count Vercel deployments in the last 24 hours against the Hobby limit (100/day).
// Vercel's dashboard has no counter for this, so we list deployments via the REST API.
//
// Usage:   node scripts/vercel-deploys.mjs [--hours 24] [--limit 100] [--list]
// Auth:    the logged-in Vercel CLI (`vercel login`) by default, or VERCEL_TOKEN
//          (vercel.com/account/settings/tokens) in the environment or in ./.env.
//          VERCEL_TEAM_ID only if the projects live under a team instead of a personal account.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const HOURS = opt("hours", 24);
const LIMIT = opt("limit", 100);
const SHOW_LIST = args.includes("--list");

const token = process.env.VERCEL_TOKEN;

const now = Date.now();
const since = now - HOURS * 3600_000;

async function getPage(path) {
  if (token) {
    const res = await fetch(`https://api.vercel.com${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
    return res.json();
  }
  try {
    const out = execSync(`vercel api "${path}" --raw`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (err) {
    console.error("No VERCEL_TOKEN set and the Vercel CLI call failed. Either run `vercel login`,");
    console.error("or put VERCEL_TOKEN=... (vercel.com/account/settings/tokens) in the repo-root .env.");
    console.error(String(err.stderr || err.message).trim());
    process.exit(1);
  }
}

async function fetchAll() {
  const out = [];
  let until = now;
  for (;;) {
    const qs = new URLSearchParams({ limit: "100", since: String(since), until: String(until) });
    if (process.env.VERCEL_TEAM_ID) qs.set("teamId", process.env.VERCEL_TEAM_ID);
    const body = await getPage(`/v6/deployments?${qs}`);
    out.push(...body.deployments);
    const next = body.pagination?.next;
    if (!next || body.deployments.length === 0) return out;
    until = next;
  }
}

const deployments = await fetchAll();
const total = deployments.length;
const canceled = deployments.filter((d) => d.state === "CANCELED").length;

const byProject = new Map();
for (const d of deployments) {
  const p = byProject.get(d.name) ?? { total: 0, built: 0, canceled: 0 };
  p.total++;
  if (d.state === "CANCELED") p.canceled++;
  else p.built++;
  byProject.set(d.name, p);
}

const fmtTime = (ms) => new Date(ms).toLocaleString();
const bar = (n) => {
  const width = 30;
  const filled = Math.min(width, Math.round((n / LIMIT) * width));
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
};

console.log(`Vercel deployments, last ${HOURS}h (since ${fmtTime(since)})\n`);
console.log(`  All created      ${bar(total)} ${total} / ${LIMIT}`);
console.log(`  Excl. canceled   ${bar(total - canceled)} ${total - canceled} / ${LIMIT}`);
console.log(`  (canceled: ${canceled}; it's unclear whether Vercel counts these, so watch the first line)\n`);

const rows = [...byProject].sort((a, b) => b[1].total - a[1].total);
const w = Math.max(7, ...rows.map(([n]) => n.length));
console.log(`  ${"Project".padEnd(w)}  Total  Built  Canceled`);
for (const [name, p] of rows) {
  console.log(`  ${name.padEnd(w)}  ${String(p.total).padStart(5)}  ${String(p.built).padStart(5)}  ${String(p.canceled).padStart(8)}`);
}

// In a rolling window, the next slot frees when the oldest deployment in it turns 24h old.
if (total >= LIMIT && HOURS === 24) {
  const sorted = deployments.map((d) => d.created).sort((a, b) => a - b);
  const needed = total - LIMIT + 1;
  console.log(`\n  At/over the limit. Next slot frees around ${fmtTime(sorted[needed - 1] + 24 * 3600_000)}.`);
} else if (total >= LIMIT * 0.8) {
  console.log(`\n  Warning: ${LIMIT - total} deployments left. Each push to master currently deploys ~${rows.length} projects.`);
}

if (SHOW_LIST) {
  console.log("");
  for (const d of [...deployments].sort((a, b) => b.created - a.created)) {
    const sha = d.meta?.githubCommitSha?.slice(0, 7) ?? "-------";
    console.log(`  ${fmtTime(d.created)}  ${sha}  ${d.state.padEnd(9)} ${d.name}`);
  }
}
