import { ARTICLE_DIRECTORY, articlePath, createArticle, parseArticle, updateArticle } from "./_content.js";
import { commit, readFile, repository, tree } from "./_github.js";
import { CmsError, errorResponse, jsonBody, requireSession, response } from "./_http.js";

async function articleEntries(repo) {
  return (await tree(repo)).filter(entry => entry.type === "blob" && entry.path.startsWith(ARTICLE_DIRECTORY) && entry.path.endsWith(".md") && !entry.path.slice(ARTICLE_DIRECTORY.length).includes("/"));
}

function validatePath(path) {
  if (!path.startsWith(ARTICLE_DIRECTORY) || !path.endsWith(".md") || articlePath(path.slice(ARTICLE_DIRECTORY.length, -3)) !== path) throw new CmsError("Ongeldig artikelpad.", 400, "invalid_path");
  return path;
}

export async function onRequestGet(context) {
  try {
    await requireSession(context);
    const repo = repository(context.env);
    const requested = new URL(context.request.url).searchParams.get("path");
    if (requested) {
      const path = validatePath(requested);
      const file = await readFile(repo, path);
      return response({ ok: true, article: parseArticle(file.path, file.sha, file.content) });
    }
    const articles = await Promise.all((await articleEntries(repo)).map(async entry => parseArticle(entry.path, entry.sha, (await readFile(repo, entry.path, entry.sha)).content)));
    articles.sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title, "nl"));
    return response({ ok: true, articles });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPost(context) {
  try {
    await requireSession(context, true);
    const payload = await jsonBody(context.request);
    const repo = repository(context.env);
    const isNew = !payload.path;
    const path = isNew ? articlePath(payload.article?.slug) : validatePath(String(payload.path));
    let content;
    if (isNew) {
      try { await readFile(repo, path); throw new CmsError("Er bestaat al een artikel met deze slug.", 409, "slug_exists", { field: "slug" }); }
      catch (error) { if (!(error instanceof CmsError) || error.code !== "not_found") throw error; }
      content = createArticle(payload.article);
    } else {
      const existing = await readFile(repo, path);
      if (!payload.sha || payload.sha !== existing.sha) throw new CmsError("Dit artikel is ondertussen gewijzigd. Vernieuw de pagina.", 409, "revision_conflict");
      content = updateArticle(existing.content, payload.article, payload.modifiedFields);
      if (content === existing.content) return response({ ok: true, path, sha: existing.sha, unchanged: true });
    }
    const result = await commit(repo, { writes: [{ path, content }], message: `${isNew ? "Create" : "Update"} article: ${path}` });
    return response({ ok: true, path, sha: result.revisions[path] });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestDelete(context) {
  try {
    await requireSession(context, true);
    const payload = await jsonBody(context.request, 4096);
    const path = validatePath(String(payload.path || ""));
    const repo = repository(context.env);
    const existing = await readFile(repo, path);
    if (!payload.sha || payload.sha !== existing.sha) throw new CmsError("Dit artikel is ondertussen gewijzigd. Vernieuw de pagina.", 409, "revision_conflict");
    await commit(repo, { deletes: [path], message: `Delete article: ${path}` });
    return response({ ok: true });
  } catch (error) { return errorResponse(error); }
}
