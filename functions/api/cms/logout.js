import { handleError, logout, requireSession } from "./_core.js";
export async function onRequestPost(context) { try { await requireSession(context, true); return logout(context); } catch (error) { return handleError(error); } }
