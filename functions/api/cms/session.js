import { handleError, json, session } from "./_core.js";
export async function onRequestGet(context) { try { const current = await session(context.request, context.env); return json({ ok: true, authenticated: Boolean(current), ...(current ? { csrfToken: current.csrf } : {}) }); } catch (error) { return handleError(error); } }
