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

function hasUnsavedChanges() { return isArticleDirty() || isHomepageDirty(); }

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
  const inputMap = { title: "#article-title", summary: "#article-summary", date: "#article-date", slug: "#article-slug", tags: "#article-tags", body: "#article-body", logo: "#homepage-logo", intro: "#homepage-intro" };
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
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.section === section));
  $("#articles-section").hidden = section !== "articles";
  $("#homepage-section").hidden = section !== "homepage";
  if (section === "homepage") await loadHomepage();
  window.scrollTo({ top: 0 });
}

function applyMarkdown(pattern) {
  const textarea = $("#article-body");
  const [before, after = ""] = pattern.split("|");
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  textarea.setRangeText(`${before}${selected}${after}`, start, end, "end");
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
$$("[data-markdown]").forEach(button => button.addEventListener("click", () => applyMarkdown(button.dataset.markdown)));
$("#cover-library").addEventListener("change", event => { if (event.target.value) { $("#cover-image").value = event.target.value; $("#cover-image").dispatchEvent(new Event("input", { bubbles: true })); } });
$("#homepage-library").addEventListener("change", event => { if (event.target.value) { $("#homepage-logo").value = event.target.value; $("#homepage-logo").dispatchEvent(new Event("input", { bubbles: true })); } });
$("#cover-upload").addEventListener("change", event => uploadImage(event.target.files[0], event.target));
$("#homepage-upload").addEventListener("change", event => uploadImage(event.target.files[0], event.target));
$("#homepage-form").addEventListener("input", updateHomepageMeta);
$("#homepage-form").addEventListener("submit", event => { event.preventDefault(); saveHomepage(); });
window.addEventListener("beforeunload", event => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; } });

start().catch(error => showLogin(error.message));
