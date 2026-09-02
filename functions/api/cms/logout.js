import { clearSession, errorResponse, requireSession } from "./_http.js";
export async function onRequestPost(context) {
  try { await requireSession(context, true); return clearSession(); } catch (error) { return errorResponse(error); }
}
