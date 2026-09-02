import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { articlePath, createArticle, parseAbout, parseArticle, parseHomepage, splitMarkdown, updateAbout, updateArticle, updateHomepage } from "../functions/api/cms/_content.js";
import { analyticsQuery, normalizeStatistics } from "../functions/api/cms/statistics.js";

const snippetsDirectory = new URL("../content/snippets/", import.meta.url);

test("all existing articles load through the CMS model", async () => {
  const filenames = (await readdir(snippetsDirectory)).filter(name => name.endsWith(".md"));
  assert.ok(filenames.length > 0);
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, snippetsDirectory), "utf8");
    const article = parseArticle(`content/snippets/${filename}`, `sha-${filename}`, source);
    assert.ok(article.title, `${filename} has a title`);
    assert.ok(article.date, `${filename} has a date`);
    assert.equal(typeof article.body, "string");
    assert.deepEqual(updateArticle(source, article, []), source, `${filename} remains byte-for-byte unchanged without edits`);
  }
});

test("editing known fields preserves unknown front matter", () => {
  const source = `---\ntitle: Oud\ndate: 2026-08-01T12:00:00+02:00\ndraft: true\ntags:\n  - test\nsummary: Oud\ncustomSetting:\n  nested: keep-me\n---\nOude inhoud\n`;
  const article = parseArticle("content/snippets/test.md", "sha", source);
  article.title = "Nieuw";
  article.body = "Nieuwe inhoud\n";
  const changed = updateArticle(source, article, ["title", "body"]);
  assert.match(changed, /title: "Nieuw"/);
  assert.match(changed, /customSetting:\n  nested: keep-me/);
  assert.match(changed, /---\nNieuwe inhoud\n$/);
});

test("a new article follows the existing snippets archetype", () => {
  const source = createArticle({
    slug: "nieuw-verhaal",
    title: "Nieuw verhaal",
    date: "2026-09-02T14:30:00.000+02:00",
    draft: true,
    tags: ["literarthur"],
    summary: "Een nieuw verhaal.",
    description: "",
    categories: [],
    showToc: true,
    cover: { image: "/uploads/omslag.jpg", alt: "Omslag", caption: "", relative: true, hiddenInList: false },
    body: "Dit is de inhoud.\n",
  });
  const frontMatter = splitMarkdown(source).frontMatter;
  for (const key of ["title:", "date:", "draft:", "tags:", "summary:", "cover:", "ShowToc:", "categories:"]) assert.ok(frontMatter.includes(key));
  const parsed = parseArticle(articlePath("nieuw-verhaal"), "sha", source);
  assert.equal(parsed.title, "Nieuw verhaal");
  assert.equal(parsed.cover.image, "/uploads/omslag.jpg");
  assert.equal(parsed.body, "Dit is de inhoud.\n");
});

test("homepage editing uses content/homepage.md and preserves its title", async () => {
  const source = await readFile(new URL("../content/homepage.md", import.meta.url), "utf8");
  const homepage = parseHomepage("sha", source);
  const changed = updateHomepage(source, { logo: "/uploads/nieuw-logo.png", intro: "Nieuwe intro.\n" });
  assert.match(changed, new RegExp(`title: ${homepage.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(changed, /logo: "\/uploads\/nieuw-logo.png"/);
  assert.match(changed, /---\nNieuwe intro\.\n$/);
});

test("about page editing preserves its front matter", async () => {
  const source = await readFile(new URL("../content/over-mij.md", import.meta.url), "utf8");
  const about = parseAbout("sha", source);
  const changed = updateAbout(source, { body: "## Nieuw\n\nNieuwe tekst.\n" });
  assert.equal(about.title, "Over mij");
  assert.equal(splitMarkdown(changed).frontMatter, splitMarkdown(source).frontMatter);
  assert.match(changed, /---\n## Nieuw\n\nNieuwe tekst\.\n$/);
});

test("invalid article paths are rejected", () => {
  assert.throws(() => articlePath("../verkeerd"), error => error.code === "invalid_slug");
  assert.throws(() => articlePath("Hoofdletters"), error => error.code === "invalid_slug");
});

test("Cloudflare statistics are normalized and missing days are filled", () => {
  const statistics = normalizeStatistics({
    totals: [{ count: 42, sum: { visits: 12, edgeResponseBytes: 2048 } }],
    daily: [{ count: 20, sum: { visits: 7 }, dimensions: { date: "2026-09-01" } }],
    pages: [{ count: 10, dimensions: { clientRequestPath: "/snippets/test/" } }, { count: 4, dimensions: { clientRequestPath: "/cdn-cgi/test" } }],
    countries: [{ count: 8, dimensions: { clientCountryName: "NL" } }],
  }, 2, "2026-09-01T00:00:00.000Z", "2026-09-02T12:00:00.000Z");
  assert.deepEqual(statistics.totals, { visits: 12, requests: 42, bandwidth: 2048 });
  assert.deepEqual(statistics.daily, [{ date: "2026-09-01", visits: 7, requests: 20 }, { date: "2026-09-02", visits: 0, requests: 0 }]);
  assert.deepEqual(statistics.pages, [{ label: "/snippets/test/", value: 10 }]);
  assert.deepEqual(statistics.countries, [{ label: "NL", value: 8 }]);
});

test("Cloudflare statistics query uses supported adaptive dimensions and filters", () => {
  const query = analyticsQuery("zone-id", "art-hov.blog", "2026-09-01T00:00:00.000Z", "2026-09-02T12:00:00.000Z");
  assert.match(query, /orderBy: \[date_ASC\]/);
  assert.match(query, /dimensions \{ date \}/);
  assert.doesNotMatch(query, /datetimeDay|edgeResponseContentTypeName/);
});
