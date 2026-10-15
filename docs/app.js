// config.js 里没有 DM_API_BASE 这个字段，说明后台压根没配（例如只把静态页传到了 Pages）。
// 注意：设成空字符串是**合法且有意义**的，表示前后端同源部署，请求走相对路径 ——
// 所以不能用 `!API_BASE` 来判断"有没有后台"，空串在 JS 里是假值，会把同源部署误判成未配置。
const BACKEND_CONFIGURED = typeof window.DM_API_BASE === "string";
const API_BASE = BACKEND_CONFIGURED ? window.DM_API_BASE.replace(/\/$/, "") : "";
const accessFromLink = new URLSearchParams(location.hash.slice(1)).get("access");
if (accessFromLink) localStorage.setItem("jilu-access", accessFromLink);
const accessToken = accessFromLink || localStorage.getItem("jilu-access") || "";

const listEl = document.querySelector("#trip-list");
const statusEl = document.querySelector("#status");
const countEl = document.querySelector("#trip-count");
const mediaCountEl = document.querySelector("#media-count");
const editor = document.querySelector("#editor");
const form = document.querySelector("#trip-form");
const mediaInput = document.querySelector("#media-input");
const selectedMedia = document.querySelector("#selected-media");
const uploadStatus = document.querySelector("#upload-status");
const saveButton = document.querySelector("#save-trip");
let trips = [];
let editing = null;
let keptMedia = [];
let lastSnapshot = "";

function setStatus(message) { statusEl.textContent = message || ""; }
function node(tag, className, textValue) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textValue !== undefined) el.textContent = textValue;
  return el;
}
function niceDate(date) {
  const parts = String(date || "").split("-");
  return parts.length === 3 ? `${parts[0]} 年 ${Number(parts[1])} 月 ${Number(parts[2])} 日` : date;
}
function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "X-Share-Token": accessToken, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

// GitHub 的媒体地址在国内会被阻断，统一改走后端代理。
// 只影响显示，仓库里存的仍然是原始地址，数据不用迁移。
// 这里不能因为 API_BASE 是空串就跳过改写 —— 空串代表同源，代理地址就是 /media/xxx。
function mediaUrl(url) {
  if (!url) return url;
  let match = String(url).match(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
  if (match) return `${API_BASE}/media/${match[1]}`;
  match = String(url).match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/([^/]+)\/(.+)$/);
  if (match) return `${API_BASE}/video/${match[1]}/${match[2]}`;
  return url;
}

function mediaElement(media) {
  const wrap = node("div", "media-item");
  if (media.kind === "video") {
    const video = node("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = mediaUrl(media.url);
    wrap.append(video);
  } else {
    const img = node("img");
    img.loading = "lazy";
    img.alt = media.name || "出游照片";
    img.src = mediaUrl(media.url);
    wrap.append(img);
  }
  const download = node("a", "", media.kind === "video" ? "下载视频" : "查看原图");
  download.href = mediaUrl(media.url);
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  wrap.append(download);
  return wrap;
}

function render() {
  listEl.replaceChildren();
  const sorted = [...trips].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  countEl.textContent = `${sorted.length} 次出游`;
  mediaCountEl.textContent = `${sorted.reduce((sum, trip) => sum + trip.media.length, 0)} 份回忆`;
  if (!sorted.length) {
    const empty = node("div", "empty-state");
    empty.append(node("div", "empty-icon", "♥"), node("h3", "", "还没有出游记录"), node("p", "", "从最近一次出发开始，写下你们的故事吧。"));
    const start = node("button", "button button-primary", "记下第一次出游");
    start.type = "button";
    start.addEventListener("click", () => openEditor());
    empty.append(start);
    listEl.append(empty);
    return;
  }
  let currentYear = "";
  for (const trip of sorted) {
    // 时间线上按年份分节，让"一起走过的年头"一眼看得出来
    const year = String(trip.date || "").slice(0, 4);
    if (year && year !== currentYear) {
      currentYear = year;
      listEl.append(node("div", "timeline-year", `${year} 年`));
    }
    const card = node("article", "trip-card");
    const cover = node("div", "trip-cover");
    // 封面取第一张照片。它就是这张照片的入口（点开看原图），
    // 所以下面画廊里不再重复放它，否则同一张图会出现两次、右边还空一大块。
    const coverPhoto = trip.media.find(item => item.kind === "photo") || null;
    if (coverPhoto) {
      const image = node("img");
      image.src = mediaUrl(coverPhoto.url);
      image.alt = "";
      image.loading = "lazy";
      const link = node("a", "cover-link");
      link.href = mediaUrl(coverPhoto.url);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `查看原图：${trip.title}`);
      link.append(image);
      cover.append(link);
    } else cover.append(node("div", "cover-fallback", "♥"));
    cover.append(node("span", "cover-label", trip.location || "一段新的旅程"));
    const body = node("div", "trip-body");
    const meta = node("div", "trip-meta");
    meta.append(node("span", "", niceDate(trip.date)), node("span", "", `${trip.media.length} 张 / 段`));
    body.append(meta, node("h3", "", trip.title));
    if (trip.notes) body.append(node("p", "trip-notes", trip.notes));
    const galleryMedia = coverPhoto ? trip.media.filter(item => item !== coverPhoto) : trip.media;
    if (galleryMedia.length) {
      const gallery = node("div", "media-grid");
      for (const media of galleryMedia) gallery.append(mediaElement(media));
      body.append(gallery);
    }
    const actions = node("div", "trip-actions");
    const edit = node("button", "text-button", "编辑记录");
    edit.type = "button";
    edit.addEventListener("click", () => openEditor(trip));
    const remove = node("button", "text-button danger", "删除记录");
    remove.type = "button";
    remove.addEventListener("click", () => deleteTrip(trip));
    actions.append(edit, remove);
    body.append(actions);
    card.append(cover, body);
    listEl.append(card);
  }
}

async function loadTrips(showError = true) {
  try {
    const data = await api("/api/trips");
    const snapshot = JSON.stringify(data.trips);
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      trips = data.trips;
      render();
    }
    setStatus("");
  } catch (error) {
    if (showError) setStatus(`无法同步记录：${error.message}`);
  }
}

function renderKeptMedia() {
  selectedMedia.replaceChildren();
  for (const media of keptMedia) {
    const chip = node("span", "selected-item", media.name || (media.kind === "video" ? "视频" : "照片"));
    const remove = node("button", "", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `移除 ${media.name || "媒体"}`);
    remove.addEventListener("click", () => { keptMedia = keptMedia.filter(item => item !== media); renderKeptMedia(); });
    chip.append(remove);
    selectedMedia.append(chip);
  }
}

function openEditor(trip = null) {
  editing = trip;
  keptMedia = trip ? [...trip.media] : [];
  form.reset();
  form.elements.title.value = trip?.title || "";
  form.elements.date.value = trip?.date || localToday();
  form.elements.location.value = trip?.location || "";
  form.elements.notes.value = trip?.notes || "";
  document.querySelector("#editor-title").textContent = trip ? "编辑出游记录" : "记下一次出游";
  uploadStatus.textContent = "";
  renderKeptMedia();
  editor.showModal();
}

function uploadFile(file, kind, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/upload/${kind}`);
    xhr.setRequestHeader("X-Share-Token", accessToken);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.media);
      else reject(new Error(data.error || `上传失败（${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error("网络中断，请检查连接后重试"));
    xhr.send(file);
  });
}

async function saveTrip(event) {
  event.preventDefault();
  const files = [...mediaInput.files];
  for (const file of files) {
    const photo = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    const video = ["video/mp4", "video/quicktime"].includes(file.type);
    if (!photo && !video) { uploadStatus.textContent = `${file.name} 格式暂不支持`; return; }
    if (file.size > (photo ? 20 : 50) * 1024 * 1024) { uploadStatus.textContent = `${file.name} 超过大小限制`; return; }
  }
  saveButton.disabled = true;
  try {
    const media = [...keptMedia];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const kind = file.type.startsWith("image/") ? "photo" : "video";
      uploadStatus.textContent = `正在上传 ${index + 1}/${files.length}：${file.name}`;
      const uploaded = await uploadFile(file, kind, percent => {
        uploadStatus.textContent = `正在上传 ${index + 1}/${files.length}：${file.name}（${percent}%）`;
      });
      media.push(uploaded);
    }
    uploadStatus.textContent = "正在保存记录……";
    const payload = {
      title: form.elements.title.value.trim(),
      date: form.elements.date.value,
      location: form.elements.location.value.trim(),
      notes: form.elements.notes.value.trim(),
      media,
      ...(editing ? { updatedAt: editing.updatedAt } : {})
    };
    await api(editing ? `/api/trips/${editing.id}` : "/api/trips", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    editor.close();
    await loadTrips();
  } catch (error) {
    uploadStatus.textContent = `保存失败：${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteTrip(trip) {
  if (!confirm(`确定删除“${trip.title}”吗？删除后网页中将不再显示。`)) return;
  try {
    await api(`/api/trips/${trip.id}`, { method: "DELETE" });
    await loadTrips();
  } catch (error) { setStatus(`删除失败：${error.message}`); }
}

document.querySelector("#new-trip").addEventListener("click", () => openEditor());
document.querySelector("#close-editor").addEventListener("click", () => editor.close());
document.querySelector("#cancel-editor").addEventListener("click", () => editor.close());
form.addEventListener("submit", saveTrip);
if (!BACKEND_CONFIGURED) {
  document.querySelector("#new-trip").disabled = true;
  setStatus("网站后台尚未配置，暂时无法同步和上传。请先按 README 完成部署配置。");
} else if (!accessToken) {
  document.querySelector("#new-trip").disabled = true;
  setStatus("请使用包含完整访问凭证的分享链接打开网站。");
}
else {
  loadTrips();
  setInterval(() => { if (!document.hidden) loadTrips(false); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadTrips(false); });
}
