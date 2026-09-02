const encoder = new TextEncoder();
const COOKIE_NAME = "arthov_cms";
const SESSION_SECONDS = 60 * 60 * 12;

const SECURITY_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export class CmsError extends Error {
  constructor(message, status = 400, code = "invalid_request", details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function response(data, init = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS, ...(init.headers || {}) });
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error) {
  if (error instanceof CmsError) {
    return response({ ok: false, error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  const requestId = crypto.randomUUID();
  console.error("Unexpected CMS error", { requestId, name: error?.name, message: error?.message });
  return response({ ok: false, error: "Er ging iets mis. Probeer het opnieuw.", code: "server_error", requestId }, { status: 500 });
}

export function envValue(env, name) {
  const value = env?.[name];
  if (!value) throw new CmsError("De beheeromgeving is niet volledig ingesteld.", 503, "configuration_error");
  return String(value);
}

export async function jsonBody(request, maxBytes = 350_000) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new CmsError("Ongeldig verzoekformaat.", 415, "unsupported_media_type");
  }
  const body = await request.text();
  if (encoder.encode(body).byteLength > maxBytes) throw new CmsError("Dit verzoek is te groot.", 413, "request_too_large");
  try { return JSON.parse(body || "{}"); }
  catch { throw new CmsError("De verzonden gegevens zijn geen geldige JSON.", 400, "invalid_json"); }
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const input = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(input + "===".slice((input.length + 3) % 4)), character => character.charCodeAt(0));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function timingSafeEqual(left, right) {
  const [a, b] = await Promise.all([left, right].map(value => crypto.subtle.digest("SHA-256", encoder.encode(String(value)))));
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < aa.length; index += 1) difference |= aa[index] ^ bb[index];
  return difference === 0;
}

function cookieMap(header = "") {
  const result = {};
  for (const part of String(header).split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) result[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return result;
}

function requireSameOrigin(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) throw new CmsError("Verzoek van een andere website geweigerd.", 403, "origin_rejected");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin && fetchSite && fetchSite !== "same-origin") throw new CmsError("Verzoek van een andere website geweigerd.", 403, "origin_rejected");
}

async function sessionFromRequest(request, env) {
  const token = cookieMap(request.headers.get("cookie"))[COOKIE_NAME];
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  if (!(await timingSafeEqual(await sign(payload, envValue(env, "CMS_SESSION_SECRET")), signature))) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return session.expiresAt > Date.now() && session.csrf ? session : null;
  } catch { return null; }
}

export async function requireSession(context, mutation = false) {
  const session = await sessionFromRequest(context.request, context.env);
  if (!session) throw new CmsError("Je sessie is verlopen. Log opnieuw in.", 401, "session_expired");
  if (mutation) {
    requireSameOrigin(context.request);
    if (!(await timingSafeEqual(context.request.headers.get("x-cms-csrf") || "", session.csrf))) {
      throw new CmsError("De beveiligingscontrole is verlopen. Vernieuw de pagina.", 403, "csrf_rejected");
    }
  }
  return session;
}

export async function authenticate(context) {
  requireSameOrigin(context.request);
  const password = String((await jsonBody(context.request, 4096)).password || "");
  if (!password || !(await timingSafeEqual(password, envValue(context.env, "CMS_PASSWORD")))) {
    throw new CmsError("Het wachtwoord klopt niet.", 401, "invalid_credentials");
  }
  const csrf = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const payload = base64Url(encoder.encode(JSON.stringify({ expiresAt: Date.now() + SESSION_SECONDS * 1000, csrf })));
  const token = `${payload}.${await sign(payload, envValue(context.env, "CMS_SESSION_SECRET"))}`;
  const secure = new URL(context.request.url).protocol === "https:" ? "; Secure" : "";
  return response({ ok: true }, { headers: { "set-cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${SESSION_SECONDS}` } });
}

export async function sessionStatus(context) {
  const session = await sessionFromRequest(context.request, context.env);
  return response({ ok: true, authenticated: Boolean(session), ...(session ? { csrfToken: session.csrf } : {}) });
}

export function clearSession() {
  return response({ ok: true }, { headers: { "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` } });
}
