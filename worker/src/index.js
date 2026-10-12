const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function corsHeaders(origin, env) {
  return origin && origin === env.ALLOWED_ORIGIN ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Share-Token, X-File-Name",
    "Vary": "Origin"
  } : {};
}

function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function githubPath(env, suffix) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GH_OWNER)}/${encodeURIComponent(env.GH_REPO)}${suffix}`;
}

async function github(env, suffix, init = {}) {
  return fetch(githubPath(env, suffix), {
    ...init,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "jilu-trip-journal",
      ...(init.headers || {})
    }
  });
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

async function readTrips(env) {
  const response = await github(env, `/contents/data/trips.json?ref=${encodeURIComponent(env.GH_BRANCH || "main")}`);
  if (response.status === 404) return { trips: [], sha: null };
  if (!response.ok) throw new HttpError(502, "读取 GitHub 记录失败");
  const file = await response.json();
  const trips = JSON.parse(fromBase64(file.content));
  if (!Array.isArray(trips)) throw new HttpError(502, "记录文件格式错误");
  return { trips, sha: file.sha };
}

async function writeTrips(env, trips, sha) {
  const body = {
    message: "Update trip journal",
    branch: env.GH_BRANCH || "main",
    content: toBase64(new TextEncoder().encode(JSON.stringify(trips, null, 2) + "\n")),
    ...(sha ? { sha } : {})
  };
  return github(env, "/contents/data/trips.json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function mutateTrips(env, update) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { trips, sha } = await readTrips(env);
    const result = update(trips);
    const response = await writeTrips(env, trips, sha);
    if (response.ok) return result;
    if (response.status === 409 || response.status === 422) continue;
    throw new HttpError(502, "保存 GitHub 记录失败");
  }
  throw new HttpError(409, "其他人正在修改，请刷新后重试");
}

function cleanTrip(input, env) {
  const title = String(input.title || "").trim();
  const date = String(input.date || "");
  const location = String(input.location || "").trim();
  const notes = String(input.notes || "").trim();
  if (!title || title.length > 80) throw new HttpError(400, "标题不能为空且不能超过 80 字");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, "请输入有效日期");
  if (location.length > 80 || notes.length > 5000) throw new HttpError(400, "地点或文字过长");
  if (!Array.isArray(input.media) || input.media.length > 100) throw new HttpError(400, "媒体列表无效");
  const repoPrefix = `https://raw.githubusercontent.com/${env.GH_OWNER}/${env.GH_REPO}/`;
  const releasePrefix = `https://github.com/${env.GH_OWNER}/${env.GH_REPO}/releases/download/`;
  const media = input.media.map(item => {
    if (!item || !["photo", "video"].includes(item.kind) || typeof item.url !== "string") throw new HttpError(400, "媒体信息无效");
    if (item.kind === "photo" && !item.url.startsWith(repoPrefix)) throw new HttpError(400, "照片地址不属于指定仓库");
    if (item.kind === "video" && !item.url.startsWith(releasePrefix)) throw new HttpError(400, "视频地址不属于指定仓库");
    return { kind: item.kind, url: item.url, name: String(item.name || "").slice(0, 200) };
  });
  return { title, date, location, notes, media };
}

async function uploadPhoto(request, env) {
  const type = request.headers.get("Content-Type") || "";
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext = extensions[type];
  if (!ext) throw new HttpError(400, "仅支持 JPG、PNG、WebP 照片");
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > MAX_PHOTO_BYTES) throw new HttpError(413, "照片不能超过 20 MB");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, "照片大小无效或超过 20 MB");
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const folder = String(env.PICGO_PATH || "media/photos").replace(/^\/+|\/+$/g, "");
  const path = `${folder}/${fileName}`;
  const response = await github(env, `/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Add photo ${fileName}`, branch: env.GH_BRANCH || "main", content: toBase64(bytes) })
  });
  if (!response.ok) throw new HttpError(502, "照片上传到 GitHub 失败");
  const name = decodeURIComponent(request.headers.get("X-File-Name") || fileName);
  const url = `https://raw.githubusercontent.com/${env.GH_OWNER}/${env.GH_REPO}/${env.GH_BRANCH || "main"}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return { kind: "photo", url, name: name.slice(0, 200) };
}

async function mediaRelease(env) {
  const tag = "trip-media-v1";
  let response = await github(env, `/releases/tags/${tag}`);
  if (response.status === 404) {
    response = await github(env, "/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_name: tag, target_commitish: env.GH_BRANCH || "main", name: "Trip media", body: "Video files for the trip journal." })
    });
    if (response.status === 422) response = await github(env, `/releases/tags/${tag}`);
  }
  if (!response.ok) throw new HttpError(502, "无法创建或读取 GitHub 视频存储区");
  return response.json();
}

async function uploadVideo(request, env) {
  const type = request.headers.get("Content-Type") || "";
  const extensions = { "video/mp4": "mp4", "video/quicktime": "mov" };
  const ext = extensions[type];
  if (!ext) throw new HttpError(400, "仅支持 MP4、MOV 视频");
  const size = Number(request.headers.get("Content-Length"));
  if (!Number.isInteger(size) || size < 1 || size > MAX_VIDEO_BYTES) throw new HttpError(413, "视频必须在 50 MB 以内");
  const release = await mediaRelease(env);
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const uploadUrl = release.upload_url.split("{")[0] + `?name=${encodeURIComponent(fileName)}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "jilu-trip-journal",
      "Content-Type": type,
      "Content-Length": String(size)
    },
    body: request.body
  });
  if (!response.ok) throw new HttpError(502, "视频上传到 GitHub 失败");
  const asset = await response.json();
  const name = decodeURIComponent(request.headers.get("X-File-Name") || fileName);
  return { kind: "video", url: asset.browser_download_url, name: name.slice(0, 200) };
}

async function handle(request, env) {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: origin && origin !== env.ALLOWED_ORIGIN ? 403 : 204, headers: cors });
  }
  if (origin && origin !== env.ALLOWED_ORIGIN) return json({ error: "来源不允许" }, 403);
  if (!env.GITHUB_TOKEN || !env.SHARE_TOKEN || !env.GH_OWNER || !env.GH_REPO) return json({ error: "后台尚未配置" }, 503, cors);
  if (!sameToken(request.headers.get("X-Share-Token"), env.SHARE_TOKEN)) return json({ error: "分享链接无效" }, 401, cors);
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/trips" && request.method === "GET") {
      const { trips } = await readTrips(env);
      return json({ trips }, 200, cors);
    }
    if (path === "/api/trips" && request.method === "POST") {
      const fields = cleanTrip(await request.json(), env);
      const now = new Date().toISOString();
      const trip = { id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now };
      await mutateTrips(env, trips => { trips.push(trip); return trip; });
      return json({ trip }, 201, cors);
    }
    const match = path.match(/^\/api\/trips\/([a-f0-9-]{36})$/i);
    if (match && request.method === "PUT") {
      const input = await request.json();
      const fields = cleanTrip(input, env);
      const trip = await mutateTrips(env, trips => {
        const index = trips.findIndex(item => item.id === match[1]);
        if (index < 0) throw new HttpError(404, "记录不存在");
        if (trips[index].updatedAt !== input.updatedAt) throw new HttpError(409, "记录已被其他人修改，请刷新后重试");
        trips[index] = { ...trips[index], ...fields, updatedAt: new Date().toISOString() };
        return trips[index];
      });
      return json({ trip }, 200, cors);
    }
    if (match && request.method === "DELETE") {
      await mutateTrips(env, trips => {
        const index = trips.findIndex(item => item.id === match[1]);
        if (index < 0) throw new HttpError(404, "记录不存在");
        trips.splice(index, 1);
        return null;
      });
      return json({ ok: true }, 200, cors);
    }
    if (path === "/api/upload/photo" && request.method === "POST") return json({ media: await uploadPhoto(request, env) }, 201, cors);
    if (path === "/api/upload/video" && request.method === "POST") return json({ media: await uploadVideo(request, env) }, 201, cors);
    return json({ error: "接口不存在" }, 404, cors);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status, cors);
    return json({ error: "服务器处理失败" }, 500, cors);
  }
}

export default { fetch: handle };
export { cleanTrip, sameToken };
