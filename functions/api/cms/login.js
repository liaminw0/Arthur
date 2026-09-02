import { authenticate, errorResponse } from "./_http.js";
export async function onRequestPost(context) {
  try { return await authenticate(context); } catch (error) { return errorResponse(error); }
}
