const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const state = {
  csrf: "",
  articles: [],
  current: null,
  articleBaseline: "",
  editorDraft: true,
  isNew: false,
  slugTouched: false,
  homepage: null,
  homepageBaseline: "",
  about: null,
  aboutBaseline: "",
  statisticsPeriod: null,
  media: [],
  toastTimer: null,
};

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.mutation) headers.set("x-cms-csrf", state.csrf);
  const result = await fetch(path, { method: options.method || "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    const error = new Error(data.error || "Het verzoek is mislukt.");
    error.code = data.code;
    error.details = data.details;
    if (result.status === 401) showLogin("Je sessie is verlopen. Log opnieuw in.");
    throw error;
  }
  return data;
}

function showLogin(message = "") {
  $("#cms").hidden = true;
  $("#login").hidden = false;
  $("#login-error").textContent = message;
  $("#password").focus();
}

function toast(message, error = false) {
  clearTimeout(state.toastTimer);
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast${error ? " error" : ""}`;
  element.hidden = false;
  state.toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

function setBusy(button, busy, busyLabel) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.label;
}

function formatDisplayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function dateForInput(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00`;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dateFromInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const pad = (number, length = 2) => String(number).padStart(length, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.000${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function slugify(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

function commaList(value) {
  return [...new Set(String(value).split(",").map(item => item.trim()).filter(Boolean))];
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  const code = [];
  html = html.replace(/`([^`]+)`/g, (_, content) => `<code data-code="${code.push(content) - 1}"></code>`);
  html = html.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, url) => {
    const safeUrl = /^(?:https?:|mailto:|\/|#)/i.test(url) ? url : "#";
    return `<a href="${safeUrl}">${label}</a>`;
  });
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  html = html.replace(/ {2,}$|\\$/g, "<br>");
  return html.replace(/<code data-code="(\d+)"><\/code>/g, (_, index) => `<code>${code[Number(index)]}</code>`);
}

function markdownToHtml(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const output = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const level = heading[1].length; output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); index += 1; continue; }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { output.push("<hr>"); index += 1; continue; }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      output.push(`<blockquote>${inlineMarkdown(quote.join(" "))}</blockquote>`); continue;
    }
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const tag = unordered ? "ul" : "ol";
      const matcher = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
      const items = [];
      while (index < lines.length) { const item = lines[index].match(matcher); if (!item) break; items.push(`<li>${inlineMarkdown(item[1])}</li>`); index += 1; }
      output.push(`<${tag}>${items.join("")}</${tag}>`); continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,3}\s+|>\s?|\s*[-+*]\s+|\s*\d+[.)]\s+)/.test(lines[index])) paragraph.push(lines[index++]);
    output.push(`<p>${paragraph.map(inlineMarkdown).join(" ")}</p>`);
  }
  return output.join("");
}

function inlineHtmlToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const content = [...node.childNodes].map(inlineHtmlToMarkdown).join("");
  if (node.tagName === "STRONG" || node.tagName === "B") return `**${content}**`;
  if (node.tagName === "EM" || node.tagName === "I") return `*${content}*`;
  if (node.tagName === "CODE") return `\`${content}\``;
  if (node.tagName === "A") return `[${content}](${node.getAttribute("href") || "#"})`;
  if (node.tagName === "BR") return "\\\n";
  return content;
}

function htmlToMarkdown(element) {
  const blocks = [];
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { if (node.textContent.trim()) blocks.push(node.textContent.trim()); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName;
    let markdown = "";
    if (/^H[1-3]$/.test(tag)) markdown = `${"#".repeat(Number(tag[1]))} ${inlineHtmlToMarkdown(node)}`;
    else if (tag === "BLOCKQUOTE") markdown = inlineHtmlToMarkdown(node).split("\n").map(line => `> ${line}`).join("\n");
    else if (tag === "UL" || tag === "OL") markdown = [...node.children].map((item, index) => `${tag === "OL" ? `${index + 1}.` : "-"} ${inlineHtmlToMarkdown(item)}`).join("\n");
    else if (tag === "HR") markdown = "---";
    else markdown = inlineHtmlToMarkdown(node);
    if (markdown.trim()) blocks.push(markdown.trim());
  }
  const markdown = blocks.join("\n\n").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
  return markdown ? `${markdown}\n` : "";
}

function articleFromForm() {
  const dateInput = $("#article-date");
  const date = !state.isNew && dateInput.value === dateInput.dataset.originalInput ? state.current.date : dateFromInput(dateInput.value);
  return {
    slug: $("#article-slug").value.trim(),
    title: $("#article-title").value.trim(),
    date,
    draft: state.editorDraft,
    tags: commaList($("#article-tags").value),
    summary: $("#article-summary").value.trim(),
    description: $("#article-description").value.trim(),
    categories: commaList($("#article-categories").value),
    showToc: $("#show-toc").checked,
    cover: {
      image: $("#cover-image").value.trim(),
      alt: $("#cover-alt").value.trim(),
      caption: $("#cover-caption").value.trim(),
      relative: $("#cover-relative").checked,
      hiddenInList: $("#cover-hidden").checked,
    },
    body: $("#article-body").value.replace(/\r\n/g, "\n"),
  };
}

function articleSnapshot(article = articleFromForm()) {
  return JSON.stringify(article);
}

function isArticleDirty() {
  return !$("#article-editor").hidden && articleSnapshot() !== state.articleBaseline;
}

function homepageFromForm() {
  return { logo: $("#homepage-logo").value.trim(), intro: $("#homepage-intro").value.replace(/\r\n/g, "\n") };
}

function isHomepageDirty() {
  return state.homepage && JSON.stringify(homepageFromForm()) !== state.homepageBaseline;
}

function aboutFromForm() { return { body: $("#about-body").value.replace(/\r\n/g, "\n") }; }

function isAboutDirty() {
  return state.about && JSON.stringify(aboutFromForm()) !== state.aboutBaseline;
}

function hasUnsavedChanges() { return isArticleDirty() || isHomepageDirty() || isAboutDirty(); }

function confirmDiscard() {
  return !hasUnsavedChanges() || window.confirm("Je hebt niet-opgeslagen wijzigingen. Wil je die weggooien?");
}

function updateArticleStatus() {
  const badge = $("#editor-status");
  badge.textContent = state.editorDraft ? "Concept" : "Gepubliceerd";
  badge.classList.toggle("draft", state.editorDraft);
  $("#publish-toggle").textContent = state.editorDraft ? "Publiceren" : "Publicatie intrekken";
}

function updateArticleMeta() {
  const summary = $("#article-summary").value;
  const words = $("#article-body").value.trim().match(/\S+/g)?.length || 0;
  $("#summary-count").textContent = `${summary.length} / 1000`;
  $("#word-count").textContent = `${words} ${words === 1 ? "woord" : "woorden"}`;
  const dirty = isArticleDirty();
  const saveState = $("#article-save-state");
  saveState.textContent = dirty ? "Niet opgeslagen" : "Geen wijzigingen";
  saveState.className = `save-state${dirty ? " dirty" : ""}`;
  $("#editor-title").textContent = $("#article-title").value.trim() || "Nieuw artikel";
  updateArticleStatus();
  updateImagePreview($("#cover-preview"), $("#cover-image").value.trim(), "Geen afbeelding");
}

function updateImagePreview(element, path, fallback) {
  element.replaceChildren();
  if (!path) { const span = document.createElement("span"); span.textContent = fallback; element.append(span); return; }
  const image = document.createElement("img");
  image.src = path;
  image.alt = "Voorbeeld";
  image.onerror = () => { element.replaceChildren(); const span = document.createElement("span"); span.textContent = "Afbeelding kan niet worden geladen"; element.append(span); };
  element.append(image);
}

function renderArticles() {
  const query = $("#search").value.trim().toLocaleLowerCase("nl");
  const filter = $("#status-filter").value;
  const visible = state.articles.filter(article => {
    const matchesQuery = !query || [article.title, article.summary, article.slug, ...article.tags, ...article.categories].join(" ").toLocaleLowerCase("nl").includes(query);
    const matchesStatus = filter === "all" || (filter === "draft" ? article.draft : !article.draft);
    return matchesQuery && matchesStatus;
  });
  const list = $("#article-list");
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = state.articles.length ? "Geen artikelen gevonden met deze filters." : "Er zijn nog geen artikelen."; list.append(empty); return;
  }
  for (const article of visible) {
    const button = document.createElement("button"); button.type = "button"; button.className = "article-row";
    const copy = document.createElement("div");
    const title = document.createElement("h2"); title.textContent = article.title || article.slug;
    const summary = document.createElement("p"); summary.textContent = article.summary || article.path;
    copy.append(title, summary);
    const date = document.createElement("span"); date.className = "article-date"; date.textContent = formatDisplayDate(article.date);
    const status = document.createElement("span"); status.className = `status-badge${article.draft ? " draft" : ""}`; status.textContent = article.draft ? "Concept" : "Gepubliceerd";
    const arrow = document.createElement("span"); arrow.className = "row-arrow"; arrow.textContent = "›";
    button.append(copy, date, status, arrow);
    button.addEventListener("click", () => openArticle(article));
    list.append(button);
  }
}

async function loadArticles(showMessage = false) {
  const refreshButton = $("#refresh");
  setBusy(refreshButton, true, "…");
  try {
    const data = await api("/api/cms/articles");
    state.articles = data.articles;
    $("#article-count").textContent = state.articles.length;
    renderArticles();
    if (showMessage) toast("Artikelen zijn opnieuw geladen.");
  } catch (error) { toast(`Artikelen laden is mislukt: ${error.message}`, true); }
  finally { setBusy(refreshButton, false); }
}

function fillArticleForm(article, isNew = false) {
  state.current = structuredClone(article);
  state.isNew = isNew;
  state.slugTouched = !isNew;
  state.editorDraft = article.draft;
  $("#article-title").value = article.title || "";
  $("#article-summary").value = article.summary || "";
  $("#article-description").value = article.description || "";
  $("#article-body").value = article.body || "";
  $("#article-rich-body").innerHTML = markdownToHtml(article.body || "");
  $("#article-tags").value = (article.tags || []).join(", ");
  $("#article-categories").value = (article.categories || []).join(", ");
  $("#article-slug").value = article.slug || "";
  $("#article-slug").disabled = !isNew;
  const dateInput = dateForInput(article.date);
  $("#article-date").value = dateInput;
  $("#article-date").dataset.originalInput = dateInput;
  $("#show-toc").checked = Boolean(article.showToc);
  $("#cover-image").value = article.cover?.image || "";
  $("#cover-alt").value = article.cover?.alt || "";
  $("#cover-caption").value = article.cover?.caption || "";
  $("#cover-relative").checked = Boolean(article.cover?.relative);
  $("#cover-hidden").checked = Boolean(article.cover?.hiddenInList);
  $("#cover-card").hidden = isNew;
  $("#delete-article").hidden = isNew;
  $("#editor-path").textContent = isNew ? "Nieuw bestand in content/snippets" : article.path;
  $("#article-error").hidden = true;
  clearFieldErrors($("#article-editor"));
  state.articleBaseline = articleSnapshot();
  $("#article-overview").hidden = true;
  $("#article-editor").hidden = false;
  updateArticleMeta();
  window.scrollTo({ top: 0 });
}

function openArticle(article) {
  if (!confirmDiscard()) return;
  fillArticleForm(article);
}

function localNow() { return dateForInput(new Date().toISOString()); }

function newArticle() {
  if (!confirmDiscard()) return;
  const nowInput = localNow();
  fillArticleForm({ slug: "", title: "", date: dateFromInput(nowInput), draft: true, tags: [], summary: "", description: "", categories: [], showToc: true, cover: { image: "", alt: "", caption: "", relative: true, hiddenInList: false }, body: "" }, true);
  $("#article-date").value = nowInput;
  $("#article-date").dataset.originalInput = nowInput;
  state.articleBaseline = articleSnapshot();
  $("#article-title").focus();
}

function clearFieldErrors(form) {
  form.querySelectorAll("[aria-invalid]").forEach(field => field.removeAttribute("aria-invalid"));
  form.querySelectorAll(".field-error").forEach(error => { error.textContent = ""; });
}

function fieldError(field, message) {
  const inputMap = { title: "#article-title", summary: "#article-summary", date: "#article-date", slug: "#article-slug", tags: "#article-tags", body: "#article-rich-body", logo: "#homepage-logo", intro: "#homepage-intro", aboutBody: "#about-rich-body" };
  const input = $(inputMap[field]);
  if (input) input.setAttribute("aria-invalid", "true");
  const messageElement = document.querySelector(`[data-error-for="${field}"]`);
  if (messageElement) messageElement.textContent = message;
}

function validateArticle(article) {
  clearFieldErrors($("#article-editor"));
  const errors = [];
  if (!article.title) errors.push(["title", "Vul een titel in."]);
  if (!article.summary) errors.push(["summary", "Vul een samenvatting in."]);
  if (!article.date || Number.isNaN(Date.parse(article.date))) errors.push(["date", "Vul een geldige datum en tijd in."]);
  if (state.isNew && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) errors.push(["slug", "Gebruik alleen kleine letters, cijfers en koppeltekens."]);
  for (const [field, message] of errors) fieldError(field, message);
  if (errors.length) { $("#article-error").textContent = "Controleer de gemarkeerde velden."; $("#article-error").hidden = false; document.querySelector("[aria-invalid='true']")?.focus(); return false; }
  $("#article-error").hidden = true;
  return true;
}

function modifiedFields(previous, next) {
  const fields = ["title", "date", "draft", "tags", "summary", "description", "categories", "body"];
  const changed = fields.filter(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field]));
  if (previous.showToc !== next.showToc) changed.push("ShowToc");
  if (JSON.stringify(previous.cover) !== JSON.stringify(next.cover)) changed.push("cover");
  return changed;
}

async function saveArticle() {
  const article = articleFromForm();
  if (!validateArticle(article)) return false;
  const button = $("#save-article");
  const saveState = $("#article-save-state");
  setBusy(button, true, "Opslaan…");
  saveState.textContent = "Bezig met opslaan…"; saveState.className = "save-state saving";
  try {
    const changes = state.isNew ? [] : modifiedFields(state.current, article);
    const data = await api("/api/cms/articles", { method: "POST", mutation: true, body: { path: state.isNew ? "" : state.current.path, sha: state.isNew ? "" : state.current.sha, article, modifiedFields: changes } });
    const saved = { ...article, path: data.path, sha: data.sha, presentFields: state.current.presentFields || [] };
    const existingIndex = state.articles.findIndex(item => item.path === data.path);
    if (existingIndex >= 0) state.articles[existingIndex] = saved; else state.articles.unshift(saved);
    state.articles.sort((left, right) => right.date.localeCompare(left.date));
    state.current = structuredClone(saved);
    state.isNew = false;
    state.slugTouched = true;
    $("#article-slug").disabled = true;
    $("#cover-card").hidden = false;
    $("#delete-article").hidden = false;
    $("#editor-path").textContent = data.path;
    $("#article-date").dataset.originalInput = $("#article-date").value;
    state.articleBaseline = articleSnapshot(article);
    $("#article-count").textContent = state.articles.length;
    renderArticles();
    saveState.textContent = data.unchanged ? "Geen wijzigingen" : "Opgeslagen"; saveState.className = "save-state saved";
    toast(data.unchanged ? "Er waren geen wijzigingen om op te slaan." : "Opgeslagen. De website wordt opnieuw opgebouwd.");
    return true;
  } catch (error) {
    if (error.details?.field) fieldError(error.details.field, error.message);
    $("#article-error").textContent = error.message; $("#article-error").hidden = false;
    saveState.textContent = "Opslaan mislukt"; saveState.className = "save-state";
    return false;
  } finally { setBusy(button, false); }
}

async function togglePublish() {
  const previous = state.editorDraft;
  state.editorDraft = !previous;
  updateArticleMeta();
  if (!(await saveArticle())) { state.editorDraft = previous; updateArticleMeta(); }
}

function backToArticles() {
  if (!confirmDiscard()) return;
  $("#article-editor").hidden = true;
  $("#article-overview").hidden = false;
  state.current = null;
  state.articleBaseline = "";
  window.scrollTo({ top: 0 });
}

async function deleteCurrentArticle() {
  if (!state.current || state.isNew) return;
  const button = $("#confirm-delete");
  setBusy(button, true, "Verwijderen…");
  try {
    await api("/api/cms/articles", { method: "DELETE", mutation: true, body: { path: state.current.path, sha: state.current.sha } });
    state.articles = state.articles.filter(article => article.path !== state.current.path);
    $("#article-count").textContent = state.articles.length;
    $("#delete-dialog").close();
    state.articleBaseline = articleSnapshot();
    backToArticles();
    renderArticles();
    toast("Artikel verwijderd. De website wordt opnieuw opgebouwd.");
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
}

async function loadHomepage() {
  if (state.homepage) return;
  try {
    const data = await api("/api/cms/homepage");
    state.homepage = data.homepage;
    $("#homepage-logo").value = data.homepage.logo;
    $("#homepage-intro").value = data.homepage.intro;
    state.homepageBaseline = JSON.stringify(homepageFromForm());
    updateHomepageMeta();
  } catch (error) { $("#homepage-error").textContent = error.message; $("#homepage-error").hidden = false; }
}

function updateHomepageMeta() {
  const dirty = isHomepageDirty();
  const saveState = $("#homepage-save-state");
  saveState.textContent = dirty ? "Niet opgeslagen" : "Geen wijzigingen";
  saveState.className = `save-state${dirty ? " dirty" : ""}`;
  updateImagePreview($("#homepage-logo-preview"), $("#homepage-logo").value.trim(), "Geen logo");
}

async function saveHomepage() {
  clearFieldErrors($("#homepage-form"));
  const homepage = homepageFromForm();
  if (!homepage.logo || !homepage.intro.trim()) {
    if (!homepage.logo) fieldError("logo", "Kies een logo.");
    if (!homepage.intro.trim()) fieldError("intro", "Vul een introductietekst in.");
    $("#homepage-error").textContent = "Controleer de gemarkeerde velden."; $("#homepage-error").hidden = false; return;
  }
  const button = $("#homepage-form button[type='submit']");
  setBusy(button, true, "Opslaan…");
  try {
    const data = await api("/api/cms/homepage", { method: "POST", mutation: true, body: { sha: state.homepage.sha, homepage } });
    state.homepage = { ...state.homepage, ...homepage, sha: data.sha };
    state.homepageBaseline = JSON.stringify(homepage);
    $("#homepage-error").hidden = true;
    updateHomepageMeta();
    toast(data.unchanged ? "Er waren geen wijzigingen om op te slaan." : "Homepage opgeslagen. De website wordt opnieuw opgebouwd.");
  } catch (error) {
    if (error.details?.field) fieldError(error.details.field, error.message);
    $("#homepage-error").textContent = error.message; $("#homepage-error").hidden = false;
  } finally { setBusy(button, false); }
}

async function loadAbout() {
  if (state.about) return;
  try {
    const data = await api("/api/cms/about");
    state.about = data.about;
    $("#about-body").value = data.about.body;
    $("#about-rich-body").innerHTML = markdownToHtml(data.about.body);
    state.aboutBaseline = JSON.stringify(aboutFromForm());
    updateAboutMeta();
  } catch (error) { $("#about-error").textContent = error.message; $("#about-error").hidden = false; }
}

function updateAboutMeta() {
  const dirty = isAboutDirty();
  const saveState = $("#about-save-state");
  saveState.textContent = dirty ? "Niet opgeslagen" : "Geen wijzigingen";
  saveState.className = `save-state${dirty ? " dirty" : ""}`;
}

async function saveAbout() {
  const about = aboutFromForm();
  if (!about.body.trim()) {
    fieldError("aboutBody", "Vul de inhoud van de pagina in.");
    $("#about-error").textContent = "Controleer het gemarkeerde veld."; $("#about-error").hidden = false; return;
  }
  const button = $("#about-form button[type='submit']");
  setBusy(button, true, "Opslaan…");
  try {
    const data = await api("/api/cms/about", { method: "POST", mutation: true, body: { sha: state.about.sha, about } });
    state.about = { ...state.about, ...about, sha: data.sha };
    state.aboutBaseline = JSON.stringify(about);
    $("#about-error").hidden = true;
    clearFieldErrors($("#about-form"));
    updateAboutMeta();
    toast(data.unchanged ? "Er waren geen wijzigingen om op te slaan." : "De pagina Over mij is opgeslagen. De website wordt opnieuw opgebouwd.");
  } catch (error) {
    if (error.details?.field) fieldError(error.details.field, error.message);
    $("#about-error").textContent = error.message; $("#about-error").hidden = false;
  } finally { setBusy(button, false); }
}

function formatNumber(value) { return new Intl.NumberFormat("nl-NL").format(value || 0); }

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(value) || 0;
  let unit = 0;
  while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit += 1; }
  return `${new Intl.NumberFormat("nl-NL", { maximumFractionDigits: unit ? 1 : 0 }).format(amount)} ${units[unit]}`;
}

function countryName(code) {
  if (!/^[A-Z]{2}$/i.test(code)) return code;
  try { return new Intl.DisplayNames(["nl"], { type: "region" }).of(code.toUpperCase()) || code; }
  catch { return code; }
}

function pageName(path) {
  const fixed = { "/": "Home", "/nieuwsbrief/": "Nieuwsbrief", "/snippets/": "Snippets", "/over-mij/": "Over mij" };
  if (fixed[path]) return fixed[path];
  const match = String(path).match(/^\/snippets\/([^/]+)\/$/);
  if (!match) return path;
  return state.articles.find(article => article.slug === match[1])?.title || match[1].replace(/-/g, " ");
}

function renderRanking(selector, items, labelFormatter = value => value) {
  const list = $(selector);
  list.replaceChildren();
  if (!items.length) { const empty = document.createElement("li"); empty.className = "empty-ranking"; empty.textContent = "Geen gegevens in deze periode."; list.append(empty); return; }
  for (const item of items) {
    const row = document.createElement("li");
    const label = document.createElement("span"); label.textContent = labelFormatter(item.label);
    const value = document.createElement("strong"); value.textContent = formatNumber(item.value);
    row.append(label, value); list.append(row);
  }
}

function renderStatistics(statistics) {
  $("#stat-visits").textContent = formatNumber(statistics.totals.visits);
  $("#stat-requests").textContent = formatNumber(statistics.totals.requests);
  $("#stat-bandwidth").textContent = formatBytes(statistics.totals.bandwidth);
  const start = formatDisplayDate(statistics.since);
  const end = formatDisplayDate(statistics.until);
  $("#statistics-range").textContent = `${start} – ${end}`;
  const chart = $("#statistics-chart");
  chart.replaceChildren();
  const maximum = Math.max(1, ...statistics.daily.map(day => day.visits));
  const axis = document.createElement("div"); axis.className = "chart-axis";
  for (const value of [maximum, Math.round(maximum / 2), 0]) { const label = document.createElement("span"); label.textContent = formatNumber(value); axis.append(label); }
  const plot = document.createElement("div"); plot.className = "chart-plot";
  const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });
  for (const day of statistics.daily) {
    const column = document.createElement("div"); column.className = "chart-column";
    const wrap = document.createElement("div"); wrap.className = "chart-bar-wrap";
    const bar = document.createElement("div"); bar.className = "chart-bar"; bar.style.height = `${Math.max(2, day.visits / maximum * 100)}%`; bar.title = `${formatDisplayDate(day.date)}: ${formatNumber(day.visits)} bezoeken`;
    const value = document.createElement("span"); value.className = "chart-value"; value.textContent = formatNumber(day.visits);
    const date = document.createElement("time"); date.dateTime = day.date; date.textContent = dateFormatter.format(new Date(`${day.date}T00:00:00Z`));
    wrap.append(value, bar); column.append(wrap, date); plot.append(column);
  }
  chart.append(axis, plot);
  chart.setAttribute("aria-label", `Bezoeken per dag van ${start} tot ${end}`);
  renderRanking("#statistics-pages", statistics.pages, pageName);
  renderRanking("#statistics-countries", statistics.countries, countryName);
}

async function loadStatistics(force = false) {
  const period = 7;
  if (!force && state.statisticsPeriod === period) return;
  const button = $("#refresh-statistics");
  setBusy(button, true, "Laden…");
  $("#statistics-loading").hidden = false;
  $("#statistics-dashboard").hidden = true;
  $("#statistics-error").hidden = true;
  try {
    const data = await api(`/api/cms/statistics?days=${period}`);
    state.statisticsPeriod = period;
    renderStatistics(data.statistics);
    $("#statistics-dashboard").hidden = false;
  } catch (error) {
    $("#statistics-error").textContent = error.message;
    $("#statistics-error").hidden = false;
  } finally { $("#statistics-loading").hidden = true; setBusy(button, false); }
}

async function loadMedia() {
  try {
    const data = await api("/api/cms/media");
    state.media = data.media;
    for (const select of [$("#cover-library"), $("#homepage-library")]) {
      const selected = select.value;
      select.replaceChildren(new Option("Kies uit uploads…", ""), ...state.media.map(item => new Option(item.name, item.path)));
      select.value = selected;
    }
  } catch (error) { toast(`Afbeeldingen laden is mislukt: ${error.message}`, true); }
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Het bestand kon niet worden gelezen."));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file, targetInput) {
  if (!file) return;
  if (file.size > 8_000_000) { toast("De afbeelding moet kleiner zijn dan 8 MB.", true); return; }
  const uploadLabel = targetInput.closest("label");
  uploadLabel.style.pointerEvents = "none"; uploadLabel.style.opacity = ".55";
  try {
    const data = await api("/api/cms/media", { method: "POST", mutation: true, body: { name: file.name, mime: file.type, data: await fileAsBase64(file) } });
    await loadMedia();
    const destination = targetInput.id === "cover-upload" ? $("#cover-image") : $("#homepage-logo");
    destination.value = data.media.path;
    destination.dispatchEvent(new Event("input", { bubbles: true }));
    toast("Afbeelding geüpload.");
  } catch (error) { toast(error.message, true); }
  finally { uploadLabel.style.pointerEvents = ""; uploadLabel.style.opacity = ""; targetInput.value = ""; }
}

async function switchSection(section) {
  const leavingArticles = section !== "articles" && !$("#article-editor").hidden;
  const leavingHomepage = section !== "homepage" && isHomepageDirty();
  const leavingAbout = section !== "about" && isAboutDirty();
  if (!confirmDiscard()) return;
  if (leavingArticles) {
    $("#article-editor").hidden = true;
    $("#article-overview").hidden = false;
    state.current = null;
    state.articleBaseline = "";
  }
  if (leavingHomepage && state.homepage) {
    $("#homepage-logo").value = state.homepage.logo;
    $("#homepage-intro").value = state.homepage.intro;
    state.homepageBaseline = JSON.stringify(homepageFromForm());
    updateHomepageMeta();
  }
  if (leavingAbout && state.about) {
    $("#about-body").value = state.about.body;
    $("#about-rich-body").innerHTML = markdownToHtml(state.about.body);
    state.aboutBaseline = JSON.stringify(aboutFromForm());
    updateAboutMeta();
  }
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.section === section));
  $("#articles-section").hidden = section !== "articles";
  $("#homepage-section").hidden = section !== "homepage";
  $("#about-section").hidden = section !== "about";
  $("#statistics-section").hidden = section !== "statistics";
  if (section === "homepage") await loadHomepage();
  if (section === "about") await loadAbout();
  if (section === "statistics") await loadStatistics();
  window.scrollTo({ top: 0 });
}

function runEditorCommand(editorId, command, value = null) {
  const editor = document.getElementById(editorId);
  editor.focus();
  document.execCommand(command, false, value);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

async function start() {
  const session = await api("/api/cms/session");
  if (!session.authenticated) { showLogin(); return; }
  state.csrf = session.csrfToken;
  $("#login").hidden = true;
  $("#cms").hidden = false;
  await Promise.all([loadArticles(), loadMedia()]);
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const password = $("#password").value;
  if (!password) { $("#login-error").textContent = "Vul je wachtwoord in."; return; }
  setBusy(button, true, "Inloggen…");
  try { await api("/api/cms/login", { method: "POST", body: { password } }); $("#password").value = ""; await start(); }
  catch (error) { $("#login-error").textContent = error.message; }
  finally { setBusy(button, false); }
});

$("#logout").addEventListener("click", async () => {
  if (!confirmDiscard()) return;
  try { await api("/api/cms/logout", { method: "POST", mutation: true, body: {} }); location.reload(); }
  catch (error) { toast(error.message, true); }
});

$$(".nav-item").forEach(button => button.addEventListener("click", () => switchSection(button.dataset.section)));
$("#new-article").addEventListener("click", newArticle);
$("#refresh").addEventListener("click", () => loadArticles(true));
$("#search").addEventListener("input", renderArticles);
$("#status-filter").addEventListener("change", renderArticles);
$("#back-to-articles").addEventListener("click", backToArticles);
$("#article-editor").addEventListener("submit", event => { event.preventDefault(); saveArticle(); });
$("#article-editor").addEventListener("input", event => {
  if (event.target.id === "article-title" && state.isNew && !state.slugTouched) $("#article-slug").value = slugify(event.target.value);
  if (event.target.id === "article-slug") state.slugTouched = true;
  updateArticleMeta();
});
$("#publish-toggle").addEventListener("click", togglePublish);
$("#delete-article").addEventListener("click", () => { $("#delete-copy").textContent = `“${state.current.title}” wordt van de website verwijderd.`; $("#delete-dialog").showModal(); });
$("#confirm-delete").addEventListener("click", event => { event.preventDefault(); deleteCurrentArticle(); });
$$(".rich-text-editor").forEach(editor => editor.addEventListener("input", event => {
  const textarea = event.currentTarget.id === "article-rich-body" ? $("#article-body") : $("#about-body");
  textarea.value = htmlToMarkdown(event.currentTarget);
  if (event.currentTarget.id === "about-rich-body") updateAboutMeta();
}));
$$("[data-command]").forEach(button => button.addEventListener("click", () => runEditorCommand(button.dataset.editor, button.dataset.command)));
$$("[data-block]").forEach(button => button.addEventListener("click", () => runEditorCommand(button.dataset.editor, "formatBlock", button.dataset.block)));
$$("[data-link]").forEach(button => button.addEventListener("click", () => {
  const url = window.prompt("Naar welke URL moet de link verwijzen?", "https://");
  if (url) runEditorCommand(button.dataset.editor, "createLink", url);
}));
$("#cover-library").addEventListener("change", event => { if (event.target.value) { $("#cover-image").value = event.target.value; $("#cover-image").dispatchEvent(new Event("input", { bubbles: true })); } });
$("#homepage-library").addEventListener("change", event => { if (event.target.value) { $("#homepage-logo").value = event.target.value; $("#homepage-logo").dispatchEvent(new Event("input", { bubbles: true })); } });
$("#cover-upload").addEventListener("change", event => uploadImage(event.target.files[0], event.target));
$("#homepage-upload").addEventListener("change", event => uploadImage(event.target.files[0], event.target));
$("#homepage-form").addEventListener("input", updateHomepageMeta);
$("#homepage-form").addEventListener("submit", event => { event.preventDefault(); saveHomepage(); });
$("#about-form").addEventListener("submit", event => { event.preventDefault(); saveAbout(); });
$("#refresh-statistics").addEventListener("click", () => loadStatistics(true));
window.addEventListener("beforeunload", event => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; } });

start().catch(error => showLogin(error.message));
