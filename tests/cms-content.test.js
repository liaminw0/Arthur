import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { articlePath, createArticle, parseArticle, parseHomepage, splitMarkdown, updateArticle, updateHomepage } from "../functions/api/cms/_content.js";

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

test("invalid article paths are rejected", () => {
  assert.throws(() => articlePath("../verkeerd"), error => error.code === "invalid_slug");
  assert.throws(() => articlePath("Hoofdletters"), error => error.code === "invalid_slug");
});
