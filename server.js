// Mochy modules: Deezer (30s previews) + SoundCloud (official API). Node 18+, no dependencies.
// Run:  SC_CLIENT_ID=... SC_CLIENT_SECRET=... node server.js
// Then in Mochy add:  https://YOUR-HOST/deezer   and   https://YOUR-HOST/soundcloud
const http = require("http");
const PORT = process.env.PORT || 3000;
const SC_ID = process.env.SC_CLIENT_ID, SC_SECRET = process.env.SC_CLIENT_SECRET;

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

// ---------- Deezer: public API, no key. Full songs are DRM, so only the official 30s preview ----------
const deezer = {
  manifest: {
    id: "deezer", name: "Deezer (preview)", version: "1.0.0", author: "you",
    description: "Deezer search with 30 second previews", resources: ["search", "stream"],
  },
  async search(q) {
    const r = await (await fetch("https://api.deezer.com/search?limit=15&q=" + encodeURIComponent(q))).json();
    return (r.data || []).filter(t => t.preview).map(t => ({
      id: String(t.id), title: t.title, artist: t.artist?.name || "",
      album: t.album?.title, duration: t.duration, streamURL: t.preview,
    }));
  },
  async stream(id) {
    const t = await (await fetch("https://api.deezer.com/track/" + encodeURIComponent(id))).json();
    if (!t.preview) return null;
    return { url: t.preview, format: "mp3", quality: "Preview 30s" };
  },
};

// ---------- SoundCloud: official API, needs your own registered app (client id + secret) ----------
let scToken = null, scExp = 0;
async function scAuth() {
  if (scToken && Date.now() < scExp) return scToken;
  const r = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: SC_ID, client_secret: SC_SECRET }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("SoundCloud auth failed");
  scToken = j.access_token; scExp = Date.now() + (j.expires_in - 60) * 1000;
  return scToken;
}
const scGet = async (url) => fetch(url, { headers: { Authorization: "OAuth " + (await scAuth()), accept: "application/json" } });
const soundcloud = {
  manifest: {
    id: "soundcloud", name: "SoundCloud", version: "1.0.0", author: "you",
    description: "SoundCloud via the official API", resources: ["search", "stream"],
  },
  async search(q) {
    const r = await (await scGet("https://api.soundcloud.com/tracks?limit=15&access=playable&q=" + encodeURIComponent(q))).json();
    return (Array.isArray(r) ? r : []).map(t => ({
      id: String(t.id), title: t.title, artist: t.user?.username || "",
      album: null, duration: Math.round((t.duration || 0) / 1000),
    }));
  },
  async stream(id) {
    const r = await scGet(`https://api.soundcloud.com/tracks/${encodeURIComponent(id)}/streams`);
    if (!r.ok) return null;
    const s = await r.json();
    const url = s.http_mp3_128_url || s.hls_mp3_128_url || s.hls_aac_160_url;
    if (!url) return null;
    return { url, format: url.includes("hls") ? "hls" : "mp3", quality: "128 kbps" };
  },
};

// ---------- Audius: open, free music network, full-length songs, no key ----------
const AUDIUS = "https://api.audius.co/v1";
const audius = {
  manifest: {
    id: "audius", name: "Audius", version: "1.0.0", author: "you",
    description: "Full songs from the open Audius network", resources: ["search", "stream"],
  },
  async search(q) {
    const r = await (await fetch(`${AUDIUS}/tracks/search?app_name=mochy&limit=15&query=` + encodeURIComponent(q))).json();
    return (r.data || []).filter(t => t.is_streamable !== false).map(t => ({
      id: String(t.id), title: t.title, artist: t.user?.name || "",
      album: null, duration: t.duration,
    }));
  },
  async stream(id) {
    return { url: `${AUDIUS}/tracks/${encodeURIComponent(id)}/stream?app_name=mochy`, format: "mp3", quality: "MP3" };
  },
};

// ---------- Open Lossless: real FLAC files from openly licensed Internet Archive items ----------
const UA = "MochyOpenLossless/1.0 (metadata and stream resolver)";
const getJson = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!r.ok) throw new Error(`Source returned HTTP ${r.status}`);
  return r.json();
};
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const isFreeLicense = (m) => {
  const text = [
    m.licenseurl, m.license, m.rights, m.usage, m.description
  ].flat().join(" ").toLowerCase();
  return /creativecommons\.org\/(licenses|publicdomain)|public domain|cc0|creative commons/.test(text);
};
const pickFlac = (files = []) => files.find(f =>
  /\.flac$/i.test(f.name || "") &&
  (String(f.format || "").toLowerCase().includes("flac") || /\.flac$/i.test(f.name || "")) &&
  !f.name?.includes("__ia_thumb")
);
const archiveItem = async (identifier) => getJson(
  "https://archive.org/metadata/" + encodeURIComponent(identifier)
);
const openLossless = {
  manifest: {
    id: "open-lossless",
    name: "Open Lossless (FLAC)",
    version: "1.0.0",
    author: "Mochy community",
    description: "Full-length FLAC recordings from explicitly open-licensed Internet Archive items",
    resources: ["search", "stream"]
  },
  async search(q) {
    q = clean(q);
    if (!q) return [];
    const url = new URL("https://archive.org/advancedsearch.php");
    url.searchParams.set("q", `(${q.replace(/[+\-!(){}\[\]^"~*?:\\/]/g, " ")}) AND mediatype:audio`);
    url.searchParams.append("fl[]", "identifier");
    url.searchParams.append("fl[]", "title");
    url.searchParams.append("fl[]", "creator");
    url.searchParams.append("fl[]", "year");
    url.searchParams.set("rows", "20");
    url.searchParams.set("page", "1");
    url.searchParams.set("output", "json");
    const data = await getJson(url.toString());
    const docs = data.response?.docs || [];
    const results = [];
    // Inspect metadata because search metadata alone cannot prove the actual file is FLAC.
    const items = await Promise.all(docs.slice(0, 12).map(async (d) => {
      try {
        const meta = await archiveItem(d.identifier);
        if (!isFreeLicense(meta.metadata || {})) return null;
        const f = pickFlac(meta.files || []);
        if (!f) return null;
        const m = meta.metadata || {};
        return {
          id: d.identifier,
          title: clean(m.title || d.title || d.identifier),
          artist: clean(m.creator || d.creator || "Unknown artist"),
          album: clean(m.album || ""),
          duration: toSec(f.length),
          streamURL: `https://archive.org/download/${encodeURIComponent(d.identifier)}/${encodeURIComponent(f.name)}`,
          format: "flac",
          quality: "FLAC — source file"
        };
      } catch (_) { return null; }
    }));
    results.push(...items.filter(Boolean).slice(0, 10));
    return results;
  },
  async stream(id) {
    const meta = await archiveItem(id);
    if (!isFreeLicense(meta.metadata || {})) return null;
    const f = pickFlac(meta.files || []);
    if (!f) return null;
    return {
      url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`,
      format: "flac",
      quality: "FLAC — source file"
    };
  }
};


const modules = { deezer, soundcloud, audius, "open-lossless": openLossless };

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    const [, name, route, id] = u.pathname.split("/");
    const m = modules[name];
    if (!m) return send(res, 404, { error: "modules: /deezer /soundcloud /audius /open-lossless" });
    if (route === "manifest.json") return send(res, 200, m.manifest);
    if (route === "search") return send(res, 200, { tracks: await m.search(u.searchParams.get("q") || "") });
    if (route === "stream") {
      const s = await m.stream(decodeURIComponent(id || ""));
      return s ? send(res, 200, s) : send(res, 404, { error: "no stream" });
    }
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log("Mochy modules on :" + PORT));
