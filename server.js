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

const modules = { deezer, soundcloud };

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    const [, name, route, id] = u.pathname.split("/");
    const m = modules[name];
    if (!m) return send(res, 404, { error: "modules: /deezer /soundcloud" });
    if (route === "manifest.json") return send(res, 200, m.manifest);
    if (route === "search") return send(res, 200, { tracks: await m.search(u.searchParams.get("q") || "") });
    if (route === "stream") {
      const s = await m.stream(id);
      return s ? send(res, 200, s) : send(res, 404, { error: "no stream" });
    }
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log("Mochy modules on :" + PORT));
