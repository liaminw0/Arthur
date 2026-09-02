import { ABOUT_PATH, parseAbout, updateAbout } from "./_content.js";
import { commit, readFile, repository } from "./_github.js";
import { CmsError, errorResponse, jsonBody, requireSession, response } from "./_http.js";

export async function onRequestGet(context) {
  try {
    await requireSession(context);
    const file = await readFile(repository(context.env), ABOUT_PATH);
    return response({ ok: true, about: parseAbout(file.sha, file.content) });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPost(context) {
  try {
    await requireSession(context, true);
    const payload = await jsonBody(context.request, 120_000);
    const repo = repository(context.env);
    const existing = await readFile(repo, ABOUT_PATH);
    if (!payload.sha || payload.sha !== existing.sha) throw new CmsError("De pagina Over mij is ondertussen gewijzigd. Vernieuw de pagina.", 409, "revision_conflict");
    const content = updateAbout(existing.content, payload.about || {});
    if (content === existing.content) return response({ ok: true, sha: existing.sha, unchanged: true });
    const result = await commit(repo, { writes: [{ path: ABOUT_PATH, content }], message: "Update about page" });
    return response({ ok: true, sha: result.revisions[ABOUT_PATH] });
  } catch (error) { return errorResponse(error); }
}
