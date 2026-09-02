import { CmsError, envValue } from "./_http.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function repository(env) {
  return { owner: envValue(env, "GITHUB_OWNER"), name: envValue(env, "GITHUB_REPO"), branch: String(env.GITHUB_BRANCH || "master"), token: envValue(env, "GITHUB_TOKEN") };
}

const encodedPath = value => String(value).split("/").map(encodeURIComponent).join("/");
const repoBase = repo => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

async function github(repo, endpoint, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/vnd.github+json");
  headers.set("authorization", `Bearer ${repo.token}`);
  headers.set("user-agent", "art-hov-cms");
  headers.set("x-github-api-version", "2022-11-28");
  const result = await fetch(`https://api.github.com${endpoint}`, { ...init, headers });
  if (!result.ok) {
    let apiMessage = "";
    try { apiMessage = (await result.json()).message || ""; } catch { /* no JSON response */ }
    if (result.status === 404) throw new CmsError("De gevraagde inhoud bestaat niet.", 404, "not_found");
    if (result.status === 401 || result.status === 403) throw new CmsError("GitHub-toegang is niet correct ingesteld.", 503, "github_auth_error");
    if (result.status === 409 || result.status === 422) throw new CmsError("De inhoud is ondertussen gewijzigd. Vernieuw en probeer opnieuw.", 409, "revision_conflict");
    console.error("GitHub API error", { status: result.status, apiMessage });
    throw new CmsError("GitHub kon de inhoud niet verwerken.", 502, "github_error");
  }
  return result.status === 204 ? null : result.json();
}

export async function tree(repo) {
  const data = await github(repo, `${repoBase(repo)}/git/trees/${encodeURIComponent(repo.branch)}?recursive=1`);
  if (data.truncated) throw new CmsError("De inhoudslijst van GitHub is onvolledig.", 502, "github_tree_truncated");
  return data.tree || [];
}

export async function readFile(repo, path, knownSha) {
  const data = knownSha ? await github(repo, `${repoBase(repo)}/git/blobs/${encodeURIComponent(knownSha)}`) : await github(repo, `${repoBase(repo)}/contents/${encodedPath(path)}?ref=${encodeURIComponent(repo.branch)}`);
  const bytes = Uint8Array.from(atob(String(data.content || "").replace(/\n/g, "")), character => character.charCodeAt(0));
  return { path, sha: data.sha, content: decoder.decode(bytes), bytes };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function commit(repo, { writes = [], deletes = [], message }) {
  if (!writes.length && !deletes.length) return { sha: null, revisions: {} };
  const ref = await github(repo, `${repoBase(repo)}/git/ref/heads/${encodeURIComponent(repo.branch)}`);
  const head = await github(repo, `${repoBase(repo)}/git/commits/${ref.object.sha}`);
  const changes = [];
  const revisions = {};
  for (const write of writes) {
    const content = write.bytes || encoder.encode(write.content);
    const blob = await github(repo, `${repoBase(repo)}/git/blobs`, { method: "POST", body: JSON.stringify({ content: bytesToBase64(content), encoding: "base64" }) });
    changes.push({ path: write.path, mode: "100644", type: "blob", sha: blob.sha });
    revisions[write.path] = blob.sha;
  }
  for (const path of deletes) changes.push({ path, mode: "100644", type: "blob", sha: null });
  const nextTree = await github(repo, `${repoBase(repo)}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree: changes }) });
  const nextCommit = await github(repo, `${repoBase(repo)}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: nextTree.sha, parents: [ref.object.sha] }) });
  await github(repo, `${repoBase(repo)}/git/refs/heads/${encodeURIComponent(repo.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: nextCommit.sha, force: false }) });
  return { sha: nextCommit.sha, revisions };
}
