import { errorResponse, sessionStatus } from "./_http.js";
export async function onRequestGet(context) {
  try { return await sessionStatus(context); } catch (error) { return errorResponse(error); }
}
