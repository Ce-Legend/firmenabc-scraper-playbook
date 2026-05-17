import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const input = args[0];
const output = valueAfter("--output") || "output/summary.md";

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

if (!input) {
  console.error("Usage: node scripts/build_summary.mjs <records.jsonl> --output output/summary.md");
  process.exit(2);
}

const rows = (await fs.readFile(input, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const byDistrict = new Map();
for (const row of rows) {
  const key = `${row.state}|||${row.district}`;
  const item = byDistrict.get(key) || {
    state: row.state,
    district: row.district,
    records: 0,
    ok: 0,
    no_email: 0,
    failed: 0,
  };
  item.records += 1;
  if (row.status === "ok") item.ok += 1;
  if (row.status === "no_email") item.no_email += 1;
  if (row.status === "parse_failed" || row.status === "request_failed") item.failed += 1;
  byDistrict.set(key, item);
}

const summary = [...byDistrict.values()].sort((a, b) =>
  `${a.state} ${a.district}`.localeCompare(`${b.state} ${b.district}`)
);

const lines = [
  "# FirmenABC sample summary",
  "",
  `Generated at: ${new Date().toISOString()}`,
  `Total records: ${rows.length}`,
  "",
  "| state | district | records | ok | no_email | failed |",
  "|---|---:|---:|---:|---:|---:|",
  ...summary.map((item) =>
    `| ${item.state} | ${item.district} | ${item.records} | ${item.ok} | ${item.no_email} | ${item.failed} |`
  ),
  "",
];

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, lines.join("\n"), "utf8");
console.log(`Wrote ${output}`);

