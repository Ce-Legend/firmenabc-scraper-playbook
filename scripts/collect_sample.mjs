import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE = "https://www.firmenabc.at";
const args = process.argv.slice(2);
const targetsFile = valueAfter("--targets") || "examples/targets.sample.json";
const limit = Number(valueAfter("--limit") || 5);
const output = valueAfter("--output") || "output/firmenabc.sample.jsonl";

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

const now = () => new Date().toISOString();
const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)));
}

function htmlToText(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|li|tr|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTagText(html, tag) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return norm(htmlToText(match?.[1] || ""));
}

function extractAnchors(html) {
  const anchors = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const hrefMatch = (match[1] || "").match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = hrefMatch?.[2] || hrefMatch?.[3] || hrefMatch?.[4] || "";
    if (!rawHref) continue;
    anchors.push({
      href: new URL(decodeHtml(rawHref), BASE).href.split("#")[0],
      text: norm(htmlToText(match[2])),
    });
  }
  return anchors;
}

function companyLinksFromAnchors(anchors) {
  const seen = new Set();
  const links = [];
  for (const anchor of anchors) {
    const href = anchor.href;
    if (!href.startsWith(`${BASE}/`)) continue;
    if (href.includes("/firmen/")) continue;
    if (!/^https:\/\/www\.firmenabc\.at\/[a-z0-9].*_[A-Za-z0-9]+$/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ url: href, list_text: anchor.text });
  }
  return links;
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      blocks.push(JSON.parse(decodeHtml(match[1]).trim()));
    } catch {}
  }
  return blocks;
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
  } else if (typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], out);
    if (value.itemListElement) flattenJsonLd(value.itemListElement, out);
  }
  return out;
}

function firstValue(value) {
  if (Array.isArray(value)) return value.map(firstValue).find(Boolean) || "";
  if (typeof value === "string") return norm(value);
  return "";
}

function parseDetail(html, target, sourceUrl, fallbackName = "") {
  const nodes = jsonLdBlocks(html).flatMap((block) => flattenJsonLd(block));
  const business = nodes.find((node) => {
    const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : String(node["@type"] || "");
    return node.name && !/WebSite|BreadcrumbList|ListItem|WebPage/i.test(type);
  });
  const text = htmlToText(html);
  const h1 = extractTagText(html, "h1");
  const title = h1 || extractTagText(html, "title") || fallbackName;
  const titleMatch = title.match(/^(.*?)\s+in\s+(.+)$/);
  const addressObj = business?.address && typeof business.address === "object" ? business.address : {};
  const street = firstValue(addressObj.streetAddress);
  const postal = firstValue(addressObj.postalCode);
  const locality = firstValue(addressObj.addressLocality);
  const address = [street, [postal, locality].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const email = firstValue(business?.email) || (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [""])[0];
  const companyName = norm(business?.name) || (titleMatch ? norm(titleMatch[1]) : norm(title));
  const website = firstValue(business?.sameAs);
  const phone = firstValue(business?.telephone);
  const industry = firstValue(business?.knowsAbout);
  const status = companyName ? (email ? "ok" : "no_email") : "parse_failed";
  const note = [
    !email ? "页面公开区未识别到邮箱" : "",
    !address ? "页面公开区未识别到地址" : "",
  ].filter(Boolean).join("; ");

  return {
    state: target.state,
    district: target.district,
    city: locality || (titleMatch ? norm(titleMatch[2]) : ""),
    industry,
    company_name: companyName,
    email,
    address,
    phone,
    website,
    source_url: sourceUrl,
    scraped_at: now(),
    status,
    note,
  };
}

async function fetchHtml(request, url) {
  const response = await request.get(url, {
    headers: { "accept-language": "de-DE,de;q=0.9,en;q=0.8" },
    timeout: 30000,
  });
  return { status: response.status(), html: await response.text() };
}

function toCsv(rows) {
  const columns = [
    "state",
    "district",
    "city",
    "industry",
    "company_name",
    "email",
    "address",
    "phone",
    "website",
    "source_url",
    "scraped_at",
    "status",
    "note",
  ];
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((col) => escape(row[col])).join(","))].join("\n") + "\n";
}

const targets = JSON.parse(await fs.readFile(targetsFile, "utf8"));
await fs.mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
});
const request = context.request;
const rows = [];

try {
  for (const target of targets) {
    const list = await fetchHtml(request, target.url);
    if (list.status >= 400) {
      rows.push({
        state: target.state,
        district: target.district,
        city: "",
        industry: "",
        company_name: `${target.district} list page`,
        email: "",
        address: "",
        phone: "",
        website: "",
        source_url: target.url,
        scraped_at: now(),
        status: "request_failed",
        note: `list request failed HTTP ${list.status}`,
      });
      console.warn(`[target] ${target.district} list request failed HTTP ${list.status}`);
      continue;
    }
    const links = companyLinksFromAnchors(extractAnchors(list.html)).slice(0, limit);
    console.log(`[target] ${target.district} links=${links.length}`);
    if (!links.length) {
      rows.push({
        state: target.state,
        district: target.district,
        city: "",
        industry: "",
        company_name: `${target.district} list page`,
        email: "",
        address: "",
        phone: "",
        website: "",
        source_url: target.url,
        scraped_at: now(),
        status: "parse_failed",
        note: "list page opened but no company detail links were detected",
      });
      continue;
    }
    for (const link of links) {
      const detail = await fetchHtml(request, link.url);
      if (detail.status >= 400) {
        rows.push({
          ...target,
          city: "",
          industry: "",
          company_name: link.list_text,
          email: "",
          address: "",
          phone: "",
          website: "",
          source_url: link.url,
          scraped_at: now(),
          status: "request_failed",
          note: `HTTP ${detail.status}`,
        });
        continue;
      }
      rows.push(parseDetail(detail.html, target, link.url, link.list_text));
    }
  }
} finally {
  await browser.close();
}

await fs.writeFile(output, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
await fs.writeFile(output.replace(/\.jsonl$/i, ".csv"), toCsv(rows), "utf8");
console.log(`Wrote ${rows.length} records to ${output}`);
