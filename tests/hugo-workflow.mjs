import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createArticle, parseArticle, updateArticle } from "../functions/api/cms/_content.js";

const run = promisify(execFile);
const project = new URL("../", import.meta.url).pathname;
const temporaryRoot = await mkdtemp(join(tmpdir(), "arthov-cms-workflow-"));
const contentDirectory = join(temporaryRoot, "content");
const publicDirectory = join(temporaryRoot, "public");

try {
  await cp(join(project, "content"), contentDirectory, { recursive: true });

  const existingPath = join(contentDirectory, "snippets", "de-buurtkat.md");
  const existingSource = await readFile(existingPath, "utf8");
  const existing = parseArticle("content/snippets/de-buurtkat.md", "test-sha", existingSource);
  existing.title = `${existing.title} — CMS-controle`;
  existing.body = `${existing.body.trimEnd()}\n\nCMS-WORKFLOW-EDIT-CONTROLE\n`;
  await writeFile(existingPath, updateArticle(existingSource, existing, ["title", "body"]));

  const newPath = join(contentDirectory, "snippets", "cms-workflow-verificatie.md");
  await writeFile(newPath, createArticle({
    slug: "cms-workflow-verificatie",
    title: "CMS workflow verificatie",
    date: "2026-08-30T12:00:00.000+02:00",
    draft: false,
    tags: ["cms-controle"],
    summary: "Tijdelijk artikel voor de CMS-rendercontrole.",
    description: "",
    categories: ["controle"],
    showToc: true,
    cover: { image: "", alt: "", caption: "", relative: true, hiddenInList: false },
    body: "CMS-WORKFLOW-NIEUW-ARTIKEL\n",
  }));

  const build = () => run("hugo", ["--contentDir", contentDirectory, "--destination", publicDirectory, "--cleanDestinationDir"], { cwd: project });
  await build();

  const editedHtml = await readFile(join(publicDirectory, "snippets", "de-buurtkat", "index.html"), "utf8");
  assert.match(editedHtml, /De buurtkat — CMS-controle/);
  assert.match(editedHtml, /CMS-WORKFLOW-EDIT-CONTROLE/);

  const newHtml = await readFile(join(publicDirectory, "snippets", "cms-workflow-verificatie", "index.html"), "utf8");
  assert.match(newHtml, /CMS workflow verificatie/);
  assert.match(newHtml, /CMS-WORKFLOW-NIEUW-ARTIKEL/);

  await unlink(newPath);
  await build();
  await assert.rejects(access(join(publicDirectory, "snippets", "cms-workflow-verificatie", "index.html")));

  assert.equal(await readFile(join(project, "content", "snippets", "de-buurtkat.md"), "utf8"), existingSource, "the real article remains untouched");
  console.log("✓ Hugo workflow: existing edit, new publish, rebuild, render, and delete verified in isolation");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
