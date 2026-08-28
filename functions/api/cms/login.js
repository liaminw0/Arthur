import { handleError, login } from "./_core.js";
export async function onRequestPost(context) { try { return await login(context); } catch (error) { return handleError(error); } }
