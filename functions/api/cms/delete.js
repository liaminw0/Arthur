import { PublicError, handleError, json, readJson, requireSession } from "./_core.js";
import { commit, file, repoConfig } from "./_github.js";
import { validPath } from "./items.js";
export async function onRequestPost(context) { try { await requireSession(context, true); const payload = await readJson(context.request, 4096); const path = validPath(payload.path); const config = repoConfig(context.env); const existing = await file(config, path); if (payload.sha !== existing.sha) throw new PublicError("Deze pagina is ondertussen gewijzigd. Vernieuw eerst.", 409, "revision_conflict"); await commit(config, [], [path], `Delete content: ${path}`); return json({ ok: true }); } catch (error) { return handleError(error); } }
