import { commit, repository, tree } from "./_github.js";
import { CmsError, errorResponse, jsonBody, requireSession, response } from "./_http.js";

const MEDIA_DIRECTORY = "static/uploads/";
const EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const MIME_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

function safeFilename(value, extension) {
  const stem = String(value || "image").replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "image";
  return `${stem}.${extension}`;
}

export async function onRequestGet(context) {
  try {
    await requireSession(context);
    const media = (await tree(repository(context.env))).filter(entry => entry.type === "blob" && entry.path.startsWith(MEDIA_DIRECTORY) && EXTENSIONS.has(entry.path.split(".").pop().toLowerCase())).map(entry => ({ name: entry.path.slice(MEDIA_DIRECTORY.length), path: `/${entry.path.slice("static/".length)}`, size: entry.size || 0 })).sort((left, right) => left.name.localeCompare(right.name, "nl"));
    return response({ ok: true, media });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPost(context) {
  try {
    await requireSession(context, true);
    const payload = await jsonBody(context.request, 11_500_000);
    const extension = MIME_EXTENSIONS[String(payload.mime || "").toLowerCase()];
    if (!extension) throw new CmsError("Gebruik een PNG-, JPEG-, GIF-, WebP- of SVG-afbeelding.", 422, "invalid_image");
    const encoded = String(payload.data || "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new CmsError("De afbeelding is ongeldig.", 422, "invalid_image");
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    if (!bytes.length || bytes.length > 8_000_000) throw new CmsError("De afbeelding moet kleiner zijn dan 8 MB.", 422, "image_too_large");
    const repo = repository(context.env);
    const existingPaths = new Set((await tree(repo)).map(entry => entry.path));
    const base = safeFilename(payload.name, extension);
    let filename = base;
    let counter = 2;
    while (existingPaths.has(`${MEDIA_DIRECTORY}${filename}`)) filename = base.replace(`.${extension}`, `-${counter++}.${extension}`);
    const path = `${MEDIA_DIRECTORY}${filename}`;
    await commit(repo, { writes: [{ path, bytes }], message: `Upload image: ${filename}` });
    return response({ ok: true, media: { name: filename, path: `/uploads/${filename}`, size: bytes.length } });
  } catch (error) { return errorResponse(error); }
}
