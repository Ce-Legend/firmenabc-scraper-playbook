import fs from "node:fs/promises";

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/validate_output.mjs <records.jsonl>");
  process.exit(2);
}

const allowedStatus = new Set(["ok", "no_email", "parse_failed", "request_failed"]);
const required = ["state", "district", "company_name", "source_url", "scraped_at", "status"];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = await fs.readFile(file, "utf8");
const rows = text
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      return { __parse_error: error.message, __line: index + 1 };
    }
  });

const issues = [];
const seen = new Set();
let withEmail = 0;
let noEmail = 0;

for (const [index, row] of rows.entries()) {
  const line = row.__line || index + 1;
  if (row.__parse_error) {
    issues.push(`line ${line}: JSON parse failed: ${row.__parse_error}`);
    continue;
  }

  for (const field of required) {
    if (!String(row[field] || "").trim()) issues.push(`line ${line}: missing ${field}`);
  }

  if (row.status && !allowedStatus.has(row.status)) {
    issues.push(`line ${line}: invalid status ${row.status}`);
  }

  if (row.email) {
    withEmail += 1;
    if (!emailRe.test(row.email)) issues.push(`line ${line}: invalid email ${row.email}`);
  } else {
    noEmail += 1;
  }

  if (row.source_url) {
    if (seen.has(row.source_url)) issues.push(`line ${line}: duplicate source_url ${row.source_url}`);
    seen.add(row.source_url);
  }

  if (row.status === "ok" && !row.email) {
    issues.push(`line ${line}: status ok but email is empty`);
  }

  if (row.status === "no_email" && row.email) {
    issues.push(`line ${line}: status no_email but email exists`);
  }
}

const summary = {
  records: rows.length,
  unique_source_urls: seen.size,
  with_email: withEmail,
  no_email: noEmail,
  issues: issues.length,
};

console.log(JSON.stringify(summary, null, 2));

if (issues.length) {
  console.error("\nIssues:");
  for (const issue of issues.slice(0, 50)) console.error(`- ${issue}`);
  if (issues.length > 50) console.error(`- ... ${issues.length - 50} more`);
  process.exit(1);
}

