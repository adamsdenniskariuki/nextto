// Rewrites package-lock.json "resolved" URLs from any npm mirror back to the
// public registry. npm's default `replace-registry-host=npmjs` then maps them
// to whatever registry each machine is configured with, so the same lockfile
// works on a corporate mirror locally and on registry.npmjs.org in CI.
// Usage: node scripts/normalize-lockfile.mjs
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../package-lock.json", import.meta.url);
const before = readFileSync(path, "utf8");
const after = before.replace(
  /"resolved": "https:\/\/[^"]*?\/npm\/registry\/([^"]+)"/g,
  '"resolved": "https://registry.npmjs.org/$1"',
);
writeFileSync(path, after);
const left = after.match(/"resolved": "https:\/\/(?!registry\.npmjs\.org)[^"]+"/g) ?? [];
console.log(
  left.length
    ? `Non-npmjs URLs remain:\n${left.join("\n")}`
    : "package-lock.json uses registry.npmjs.org",
);
process.exit(left.length ? 1 : 0);
