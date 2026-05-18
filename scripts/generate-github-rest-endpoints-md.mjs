/**
 * Generates docs/github-rest-api-endpoints.md from GitHub's official OpenAPI description.
 * Source: https://github.com/github/rest-api-description
 */
import fs from "node:fs";
import path from "node:path";

const openapiPath =
  process.argv[2] || path.join(process.env.TEMP || "/tmp", "github-openapi.json");
const outPath =
  process.argv[3] ||
  path.join(process.cwd(), "docs", "github-rest-api-endpoints.md");

const spec = JSON.parse(fs.readFileSync(openapiPath, "utf8"));
const paths = spec.paths || {};
const methods = ["get", "post", "put", "patch", "delete", "head", "options"];

/** @type {{ method: string; path: string; summary: string; tags: string[]; operationId?: string }[]} */
const rows = [];
for (const p of Object.keys(paths).sort()) {
  const item = paths[p];
  for (const m of methods) {
    const op = item[m];
    if (!op) continue;
    rows.push({
      method: m.toUpperCase(),
      path: p,
      summary: (op.summary || "").replace(/\s+/g, " ").trim(),
      tags: op.tags || [],
      operationId: op.operationId,
    });
  }
}

const byTag = new Map();
for (const r of rows) {
  const tagList = r.tags.length ? r.tags : ["(untagged)"];
  for (const t of tagList) {
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t).push(r);
  }
}
const sortedTags = [...byTag.keys()].sort((a, b) => a.localeCompare(b));

const info = spec.info || {};
const servers = spec.servers || [{ url: "https://api.github.com" }];

const generated = new Date().toISOString().slice(0, 10);

let md = `# GitHub REST API — HTTP endpoints

This reference lists every operation defined in GitHub's published OpenAPI description for \`api.github.com\`. It was generated from the official machine-readable spec (not hand-curated prose docs).

- **OpenAPI title:** ${info.title || "GitHub v3 REST API"}
- **OpenAPI version:** ${info.version || "—"}
- **Spec source:** [github/rest-api-description](https://github.com/github/rest-api-description) — \`descriptions/api.github.com/api.github.com.json\`
- **Generated:** ${generated}
- **Total operations:** ${rows.length}

## Using the API (from GitHub docs via Context7)

- **Base URL:** \`${servers[0]?.url || "https://api.github.com"}\`
- **Send** \`Accept: application/vnd.github+json\` and an API version header such as \`X-GitHub-Api-Version: YYYY-MM-DD\` (see [REST API overview](https://docs.github.com/en/rest/about-the-rest-api/about-the-rest-api)).
- **Authenticate** with a personal access token, GitHub App installation token, or OAuth token as appropriate; unauthenticated requests have lower rate limits.
- **Pagination:** many list endpoints support \`per_page\` and \`page\` (or Link header cursor style); see [Using pagination in the REST API](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api).
- **Rate limits:** \`GET /rate_limit\` — see [Rate limits](https://docs.github.com/en/rest/rate-limit/rate-limit).

## Endpoint index (flat)

| Method | Path | Summary |
|--------|------|---------|
`;

for (const r of rows) {
  const sum = r.summary.replace(/\|/g, "\\|");
  md += `| ${r.method} | \`${r.path}\` | ${sum} |\n`;
}

md += `
## Endpoints by OpenAPI tag

`;

for (const tag of sortedTags) {
  const list = byTag.get(tag).sort((a, b) => {
    const pc = a.path.localeCompare(b.path);
    if (pc !== 0) return pc;
    return a.method.localeCompare(b.method);
  });
  md += `### ${tag}\n\n`;
  md += `| Method | Path | Summary |\n|--------|------|---------|\n`;
  for (const r of list) {
    const sum = r.summary.replace(/\|/g, "\\|");
    md += `| ${r.method} | \`${r.path}\` | ${sum} |\n`;
  }
  md += "\n";
}

md += `## Notes

- **Path parameters** appear as \`{param}\` in paths (e.g. \`{owner}\`, \`{repo}\`).
- **GitHub Enterprise Server** may expose additional or different operations; this file reflects the GitHub.com public API bundle.
- For human-oriented guides and breaking-change policy, prefer [docs.github.com REST reference](https://docs.github.com/en/rest).

`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, "utf8");
console.log(`Wrote ${outPath} (${rows.length} operations)`);
