"use strict";
// Ranasinghe Motors POS - small cloud server (no framework). Serves the POS page and keeps the shop data
// in one place so every device (shop PC, cashier phone, owner abroad) sees the same data.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), zlib = require("zlib");
let pg = null; try { pg = require("pg"); } catch (e) { /* optional: only needed for DATABASE_URL */ }

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const DEFAULT_PIN = process.env.ADMIN_PIN || "1234";
const COLS = ["items", "sales", "cs", "exp", "co", "cl", "hold", "users"];
const OBJS = ["set", "ai", "bl", "lo"], SCAL = ["apin", "bn", "logo"];
const ADMIN_ONLY = ["users", "apin", "set", "ai", "bl", "lo", "logo"];
const empty = () => ({ ver: 0, items: [], sales: [], cs: [], exp: [], co: [], cl: [], hold: [], users: [], bn: 0 });

// ---------- storage: Postgres (DATABASE_URL) or a JSON file (use a persistent disk) ----------
const store = (() => {
  if (process.env.DATABASE_URL && pg) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false } });
    return {
      name: "postgres",
      async load() {
        await pool.query("CREATE TABLE IF NOT EXISTS kv(k text PRIMARY KEY, v jsonb NOT NULL, t timestamptz DEFAULT now())");
        const r = await pool.query("SELECT v FROM kv WHERE k='state'");
        return r.rows[0] ? r.rows[0].v : null;
      },
      async save(s) { await pool.query("INSERT INTO kv(k,v,t) VALUES('state',$1,now()) ON CONFLICT(k) DO UPDATE SET v=$1,t=now()", [JSON.stringify(s)]); }
    };
  }
  if (process.env.DATABASE_URL && !pg) console.warn("DATABASE_URL is set but the 'pg' package is missing - using file storage instead.");
  fs.mkdirSync(DATA, { recursive: true });
  const f = path.join(DATA, "state.json");
  return {
    name: "file " + f,
    async load() { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } },
    async save(s) {
      const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, f);
      const b = path.join(DATA, "backup-" + new Date().toISOString().slice(0, 10) + ".json");
      if (!fs.existsSync(b)) fs.copyFileSync(f, b);                       // one backup per day, keep the last 14
      fs.readdirSync(DATA).filter(x => /^backup-/.test(x)).sort().slice(0, -14).forEach(x => fs.unlinkSync(path.join(DATA, x)));
    }
  };
})();

let state = empty(), queue = Promise.resolve();
const persist = () => (queue = queue.then(() => store.save(state)).catch(e => console.error("save failed:", e.message)));

// ---------- auth: signed tokens (survive server restarts), PINs checked on the server ----------
const hmac = b => crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString("base64url"); return b + "." + hmac(b); };
function verify(t) {
  if (!t) return null; const [b, s] = String(t).split("."); if (!b || !s) return null;
  const e = hmac(b); if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try { const p = JSON.parse(Buffer.from(b, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
const h256 = x => crypto.createHash("sha256").update(String(x)).digest();
const same = (a, b) => crypto.timingSafeEqual(h256(a), h256(b));
const fails = new Map();
function limited(ip) { const f = fails.get(ip); return !!f && f.n >= 8 && Date.now() - f.t < 300000; }
function failed(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 300000) fails.set(ip, { n: 1, t: Date.now() }); else { f.n++; f.t = Date.now(); } }

// ---------- data rules ----------
function view(role) {                                  // what each role may read
  if (role === "a") return state;
  const c = Object.assign({}, state); delete c.apin;
  c.users = state.users.map(u => ({ id: u.id, n: u.n, ph: u.ph })); return c;
}
function apply(role, d) {                              // what each role may change
  const adm = role === "a";
  COLS.forEach(c => {
    if (!adm && c === "users") return;
    const ups = (d.a || {})[c] || [], rms = (d.r || {})[c] || []; state[c] = state[c] || [];
    ups.forEach(r => {
      if (!r || r.id === undefined) return;
      const i = state[c].findIndex(x => String(x.id) === String(r.id));
      if (!adm && c === "items") { if (i >= 0 && typeof r.s === "number") state.items[i].s = r.s; return; }   // cashiers: stock only
      if (i >= 0) state[c][i] = r; else state[c].push(r);
    });
    if (rms.length && (adm || c === "hold")) { const set = new Set(rms.map(String)); state[c] = state[c].filter(x => !set.has(String(x.id))); }
  });
  Object.keys(d.o || {}).forEach(k => {
    if (!OBJS.concat(SCAL).includes(k) || (!adm && ADMIN_ONLY.includes(k))) return;
    if (k === "bn") state.bn = Math.max(state.bn || 0, +d.o.bn || 0); else state[k] = d.o[k];
  });
  state.ver++;
}

// ---------- http ----------
const PAGE = path.join(__dirname, "public", "index.html"); let pageRaw = null, pageGz = null;
function page() { if (!pageRaw) { pageRaw = fs.readFileSync(PAGE); pageGz = zlib.gzipSync(pageRaw); } return [pageRaw, pageGz]; }
function send(res, code, obj, extra) { const b = JSON.stringify(obj); res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra)); res.end(b); }
function body(req, max) {
  return new Promise((ok, no) => { let n = 0; const a = []; req.on("data", c => { n += c.length; if (n > max) { no(new Error("too big")); req.destroy(); } else a.push(c); }); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(a).toString() || "{}")); } catch (e) { no(e); } }); req.on("error", no); });
}
const ipOf = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const authed = req => verify(String(req.headers.authorization || "").replace(/^Bearer /, ""));

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x"), p = u.pathname;
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      const [raw, gz] = page(), z = /gzip/.test(req.headers["accept-encoding"] || "");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...(z ? { "Content-Encoding": "gzip" } : {}) });
      return res.end(z ? gz : raw);
    }
    if (p === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
    if (p === "/api/ping") return send(res, 200, { cloud: true });
    if (p === "/api/users" && req.method === "GET") return send(res, 200, { users: state.users.map(x => ({ id: x.id, n: x.n })) });
    if (p === "/api/login" && req.method === "POST") {
      const ip = ipOf(req); if (limited(ip)) return send(res, 429, { err: "rate" });
      const b = await body(req, 10000); let user = null;
      if (b.role === "a") { if (same(b.pin, state.apin || DEFAULT_PIN)) user = { role: "a", n: "පරිපාලක", id: 0 }; }
      else { const c = state.users.find(x => String(x.id) === String(b.id)); if (c && same(b.pin, c.pin)) user = { role: "c", n: c.n, id: c.id }; }
      if (!user) { failed(ip); return send(res, 401, { err: "pin" }); }
      fails.delete(ip);
      return send(res, 200, { token: sign({ r: user.role, n: user.n, id: user.id, exp: Date.now() + 12 * 3600e3 }), user });
    }
    if (p.startsWith("/api/")) {
      const t = authed(req); if (!t) return send(res, 401, { err: "auth" });
      if (p === "/api/state" && req.method === "GET") {
        if (u.searchParams.get("ver") === String(state.ver)) return send(res, 200, { same: true, ver: state.ver });
        return send(res, 200, { ver: state.ver, state: view(t.r) });
      }
      if (p === "/api/sync" && req.method === "POST") { const b = await body(req, 30e6); apply(t.r, b.d || {}); persist(); return send(res, 200, { ver: state.ver, state: view(t.r) }); }
      if (p === "/api/restore" && req.method === "POST") {
        if (t.r !== "a") return send(res, 403, { err: "admin" });
        const b = await body(req, 60e6); if (!b || !Array.isArray(b.items) || !Array.isArray(b.sales)) return send(res, 400, { err: "bad" });
        state = Object.assign(empty(), b, { ver: state.ver + 1 }); persist(); return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { err: "not found" });
  } catch (e) { send(res, 400, { err: String(e.message || e) }); }
}).listen(PORT, async () => {
  try { const s = await store.load(); if (s) state = Object.assign(empty(), s); } catch (e) { console.error("load failed:", e.message); }
  console.log("POS server on :" + PORT + " | storage: " + store.name + " | ver " + state.ver);
});
const bye = () => persist().then(() => process.exit(0)); process.on("SIGTERM", bye); process.on("SIGINT", bye);
