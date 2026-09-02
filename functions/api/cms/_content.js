import { CmsError } from "./_http.js";

export const ARTICLE_DIRECTORY = "content/snippets/";
export const HOMEPAGE_PATH = "content/homepage.md";
export const ARTICLE_FIELDS = ["title", "date", "draft", "tags", "summary", "description", "cover", "categories", "ShowToc"];

export function articlePath(slug) {
  const clean = String(slug || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean) || clean.length > 100) {
    throw new CmsError("De slug mag alleen kleine letters, cijfers en koppeltekens bevatten.", 422, "invalid_slug", { field: "slug" });
  }
  return `${ARTICLE_DIRECTORY}${clean}.md`;
}

export function splitMarkdown(source) {
  const text = String(source).replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) throw new CmsError("Dit Markdown-bestand heeft geen geldige YAML-front matter.", 422, "malformed_content");
  const closing = text.indexOf("\n---\n", 4);
  if (closing < 0) throw new CmsError("De YAML-front matter is niet afgesloten.", 422, "malformed_content");
  return { frontMatter: text.slice(4, closing), body: text.slice(closing + 5) };
}

function scalar(value = "") {
  const clean = String(value).trim();
  if (!clean) return "";
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (clean === "null" || clean === "~") return null;
  if (clean.startsWith('"') && clean.endsWith('"')) {
    try { return JSON.parse(clean); } catch { return clean.slice(1, -1); }
  }
  if (clean.startsWith("'") && clean.endsWith("'")) return clean.slice(1, -1).replace(/''/g, "'");
  return clean;
}

function topLevelBlocks(frontMatter) {
  const lines = String(frontMatter).split("\n");
  const starts = [];
  lines.forEach((line, index) => {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/);
    if (match) starts.push({ key: match[1], value: match[2] || "", start: index });
  });
  return starts.map((block, index) => ({ ...block, end: starts[index + 1]?.start ?? lines.length, lines: lines.slice(block.start, starts[index + 1]?.start ?? lines.length) }));
}

function listValue(block) {
  if (block.value.trim() === "[]") return [];
  const values = [];
  for (const line of block.lines.slice(1)) {
    const match = line.match(/^\s+-\s*(.*)$/);
    if (match) values.push(String(scalar(match[1]) ?? ""));
  }
  return values.filter(Boolean);
}

function textValue(block) {
  const first = scalar(block.value);
  if (typeof first !== "string") return first;
  const continuation = block.lines.slice(1).filter(line => /^\s+\S/.test(line) && !/^\s+-/.test(line)).map(line => line.trim());
  return [first, ...continuation].filter(Boolean).join(" ");
}

function mapValue(block) {
  const result = {};
  for (const line of block.lines.slice(1)) {
    const match = line.match(/^\s+([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (match) result[match[1]] = scalar(match[2]);
  }
  return result;
}

export function parseFrontMatter(frontMatter) {
  const values = {};
  const present = [];
  for (const block of topLevelBlocks(frontMatter)) {
    present.push(block.key);
    if (["tags", "categories"].includes(block.key)) values[block.key] = listValue(block);
    else if (block.key === "cover") values.cover = mapValue(block);
    else values[block.key] = textValue(block);
  }
  return { values, present };
}

export function parseArticle(path, sha, source) {
  const document = splitMarkdown(source);
  const parsed = parseFrontMatter(document.frontMatter);
  return {
    path, sha, slug: path.slice(ARTICLE_DIRECTORY.length, -3), title: String(parsed.values.title || ""), date: String(parsed.values.date || ""),
    draft: parsed.values.draft !== false, tags: parsed.values.tags || [], summary: String(parsed.values.summary || ""), description: String(parsed.values.description || ""),
    categories: parsed.values.categories || [], showToc: parsed.values.ShowToc === true,
    cover: { image: String(parsed.values.cover?.image || ""), alt: String(parsed.values.cover?.alt || ""), caption: String(parsed.values.cover?.caption || ""), relative: parsed.values.cover?.relative === true, hiddenInList: parsed.values.cover?.hiddenInList === true },
    body: document.body, presentFields: parsed.present,
  };
}

function yamlString(value) { return JSON.stringify(String(value ?? "")); }
function renderList(key, values) {
  const clean = values.map(value => String(value).trim()).filter(Boolean);
  return clean.length ? `${key}:\n${clean.map(value => `  - ${yamlString(value)}`).join("\n")}` : `${key}: []`;
}

function renderField(key, article) {
  if (key === "title") return `title: ${yamlString(article.title)}`;
  if (key === "date") return `date: ${article.date}`;
  if (key === "draft") return `draft: ${article.draft ? "true" : "false"}`;
  if (key === "tags" || key === "categories") return renderList(key, article[key] || []);
  if (key === "summary" || key === "description") return `${key}: ${yamlString(article[key] || "")}`;
  if (key === "ShowToc") return `ShowToc: ${article.showToc ? "true" : "false"}`;
  if (key === "cover") return ["cover:", `  image: ${yamlString(article.cover?.image || "")}`, `  alt: ${yamlString(article.cover?.alt || "")}`, `  caption: ${yamlString(article.cover?.caption || "")}`, `  relative: ${article.cover?.relative ? "true" : "false"}`, `  hiddenInList: ${article.cover?.hiddenInList ? "true" : "false"}`].join("\n");
  throw new CmsError("Onbekend artikelveld.", 422, "invalid_field");
}

function validateText(value, field, max, required = false) {
  if (typeof value !== "string" || value.length > max || /\u0000/.test(value) || (required && !value.trim())) {
    throw new CmsError(required ? "Dit veld is verplicht." : "Dit veld bevat ongeldige inhoud.", 422, "validation_error", { field });
  }
}

export function validateArticle(article, isNew = false) {
  if (!article || typeof article !== "object") throw new CmsError("Artikelgegevens ontbreken.", 422, "validation_error");
  if (isNew) articlePath(article.slug);
  validateText(article.title, "title", 200, true);
  validateText(article.date, "date", 50, true);
  if (Number.isNaN(Date.parse(article.date))) throw new CmsError("Vul een geldige publicatiedatum in.", 422, "validation_error", { field: "date" });
  validateText(article.summary || "", "summary", 1000);
  validateText(article.description || "", "description", 1000);
  validateText(article.body || "", "body", 250_000);
  for (const field of ["tags", "categories"]) {
    if (!Array.isArray(article[field]) || article[field].length > 50 || article[field].some(value => typeof value !== "string" || !value.trim() || value.length > 100)) throw new CmsError(`Controleer de waarden bij ${field}.`, 422, "validation_error", { field });
  }
  if (typeof article.draft !== "boolean") throw new CmsError("De publicatiestatus is ongeldig.", 422, "validation_error", { field: "draft" });
  for (const field of ["image", "alt", "caption"]) validateText(article.cover?.[field] || "", `cover.${field}`, field === "image" ? 2000 : 500);
  return article;
}

export function updateArticle(source, article, modifiedFields) {
  validateArticle(article);
  const document = splitMarkdown(source);
  const allowed = new Set(ARTICLE_FIELDS);
  const fields = [...new Set(modifiedFields || [])];
  if (!fields.length) return source;
  if (fields.some(field => field !== "body" && !allowed.has(field))) throw new CmsError("Het artikel bevat een onbekende wijziging.", 422, "invalid_field");
  const lines = document.frontMatter.split("\n");
  const blocks = topLevelBlocks(document.frontMatter);
  const replacements = new Map(fields.filter(field => field !== "body").map(field => [field, renderField(field, article)]));
  const output = [];
  let cursor = 0;
  for (const block of blocks) {
    output.push(...lines.slice(cursor, block.start));
    if (replacements.has(block.key)) { output.push(...replacements.get(block.key).split("\n")); replacements.delete(block.key); }
    else output.push(...lines.slice(block.start, block.end));
    cursor = block.end;
  }
  output.push(...lines.slice(cursor));
  for (const rendered of replacements.values()) output.push(...rendered.split("\n"));
  const frontMatter = output.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  const body = fields.includes("body") ? article.body.replace(/^\n+/, "") : document.body;
  return `---\n${frontMatter}\n---\n${body}`;
}

export function createArticle(article) {
  validateArticle(article, true);
  const frontMatter = ["title", "date", "draft", "tags", "summary", "cover", "ShowToc", "categories"].map(key => renderField(key, article)).join("\n");
  return `---\n${frontMatter}\n---\n${article.body.replace(/^\n+/, "")}`;
}

export function parseHomepage(sha, source) {
  const document = splitMarkdown(source);
  const parsed = parseFrontMatter(document.frontMatter);
  return { path: HOMEPAGE_PATH, sha, title: String(parsed.values.title || ""), logo: String(parsed.values.logo || ""), intro: document.body };
}

export function updateHomepage(source, homepage) {
  validateText(homepage.logo, "logo", 2000, true);
  validateText(homepage.intro, "intro", 20_000, true);
  const document = splitMarkdown(source);
  const lines = document.frontMatter.split("\n");
  const blocks = topLevelBlocks(document.frontMatter);
  const logoBlock = blocks.find(block => block.key === "logo");
  const rendered = `logo: ${yamlString(homepage.logo)}`;
  if (logoBlock) lines.splice(logoBlock.start, logoBlock.end - logoBlock.start, rendered);
  else lines.push(rendered);
  return `---\n${lines.join("\n")}\n---\n${homepage.intro.replace(/^\n+/, "")}`;
}
