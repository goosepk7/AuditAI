"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("../tools/build-guides.js");

const ROOT = path.join(__dirname, "..");

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
  });
}

test("committed guide pages match the generator (run: node tools/build-guides.js)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guides-"));
  build(tmp);
  const fresh = listFiles(path.join(tmp, "guides")).sort();
  assert.deepEqual(listFiles(path.join(ROOT, "guides")).sort(), fresh);
  for (const f of fresh) {
    assert.equal(fs.readFileSync(path.join(ROOT, "guides", f), "utf8"), fs.readFileSync(path.join(tmp, "guides", f), "utf8"), f);
  }
  assert.equal(fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8"), fs.readFileSync(path.join(tmp, "sitemap.xml"), "utf8"));
});

test("every guide links back to the tool and every internal link resolves", () => {
  const pages = listFiles(path.join(ROOT, "guides")).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 50);
  for (const f of pages) {
    const file = path.join(ROOT, "guides", f);
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /<title>[^<]+\| AuditAI<\/title>/, f);
    assert.match(html, /<link rel="canonical" href="https:\/\/goosepk7\.github\.io\/AuditAI\//, f);
    for (const [, href] of html.matchAll(/href="([^"#]+)"/g)) {
      if (/^(https?:|data:)/.test(href)) continue;
      const target = path.resolve(path.dirname(file), href);
      const exists = fs.existsSync(target.endsWith(".css") ? target : path.join(target, "index.html"));
      assert.ok(exists, f + " links to missing " + href);
    }
  }
});
