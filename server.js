// Math Quest multiplayer server.
// Setup:  npm init -y && npm i ws   then   node server.js
// Put this file in the same folder as math_quest.html and open http://localhost:8080
// The server serves the game and injects the WebSocket address, so no HTML edits are needed.
//
// Client -> server: create{settings,visibility} quick join{room} joinPublic{room} publicRooms unsub
//                   settings{settings} start ans{round,v} leave close rejoin{room,token}
// Server -> client: room{code,vis,quick,you,token,host,settings,players} closed{msg} publicRooms{rooms}
//                   start q reveal end err{code,msg}
// Identity, host rights, visibility and capacity are all decided here, never trusted from the client.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");
const PORT = process.env.PORT || 8080;
const HTML = path.join(__dirname, "math_quest.html");

const server = http.createServer((req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") { res.writeHead(404); return res.end("Not found"); }
  fs.readFile(HTML, "utf8", (err, html) => {
    if (err) { res.writeHead(500); return res.end("math_quest.html not found next to server.js"); }
    const inject = '<script>window.MQ_SERVER_URL=(location.protocol==="https:"?"wss://":"ws://")+location.host</script>';
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html.replace("<script>", inject + "<script>"));
  });
});
const wss = new WebSocketServer({ server });
const rooms = new Map();

/* ---- helpers ---- */
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function gen(l) {
  const ops = l === "easy" ? ["+", "−"] : ["+", "−", "×"], op = ops[ri(0, ops.length - 1)];
  let a, b;
  if (l === "easy") { a = ri(0, 10); b = ri(0, 10); }
  else if (l === "medium") { if (op === "×") { a = ri(1, 12); b = ri(1, 12); } else { a = ri(1, 100); b = ri(1, 100); } }
  else { if (op === "×") { a = ri(10, 50); b = ri(2, 19); } else { a = ri(10, 500); b = ri(10, 500); } }
  if (op === "−" && b > a) [a, b] = [b, a];
  return { text: `${a} ${op} ${b} = ?`, ans: op === "+" ? a + b : op === "−" ? a - b : a * b };
}
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => {
  let c;
  do { c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; } while (rooms.has(c)); // unique among active rooms
  return c;
};
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const err = (ws, code, msg) => send(ws, { t: "err", code, msg });
const cast = (r, m) => r.players.forEach(p => send(p.ws, m));
const castRoom = r => r.players.forEach(p => send(p.ws, {
  t: "room", code: r.code, vis: r.vis, quick: r.quick, you: p.id, token: p.token, host: r.host, settings: r.set,
  players: r.players.map(({ id, name, av }) => ({ id, name, av }))
}));

/* ---- open games list (real-time) ---- */
// Private rooms are shown as locked entries so players can see they exist, but their code is NEVER sent:
// joining one still requires typing the code. Set to false to hide private rooms from the list completely.
const LIST_PRIVATE_ROOMS = true;
function listRooms() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.quick || (r.vis !== "public" && !LIST_PRIVATE_ROOMS) || (r.phase !== "wait" && r.phase !== "play")) continue; // quick-match rooms are never listed
    const host = r.players.find(p => p.id === r.host) || r.players[0];
    const count = r.players.filter(p => p.ws).length;
    out.push({
      rid: r.id, code: r.vis === "public" ? r.code : null, vis: r.vis, host: host ? host.name : "?", av: host ? host.av : "🎮", players: count, max: r.set.max, lvl: r.set.lvl, q: r.set.q, time: r.set.time,
      status: r.phase === "wait" ? "waiting" : r.round === 0 ? "starting" : "playing", full: count >= r.set.max, createdAt: r.createdAt,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
let pubTimer = null;
function pubChanged() { // batch bursts of changes into one push to every lobby subscriber
  if (pubTimer) return;
  pubTimer = setTimeout(() => {
    pubTimer = null;
    const msg = JSON.stringify({ t: "publicRooms", rooms: listRooms() });
    for (const c of wss.clients) if (c.sub && c.readyState === 1) c.send(msg);
  }, 100);
}

/* ---- rooms ---- */
function applySettings(r, c = {}) {
  const s = r.set;
  if ([10, 15, 20, 30].includes(+c.time)) s.time = +c.time;
  if (+c.q >= 10 && +c.q <= 20) s.q = Math.floor(+c.q);
  if (+c.max >= 1 && +c.max <= 4) s.max = Math.max(r.players.length, Math.floor(+c.max));
  if (["easy", "medium", "hard"].includes(c.lvl)) s.lvl = c.lvl;
}
function makeRoom(settings, quick, vis) {
  const r = { id: crypto.randomUUID(), code: newCode(), host: null, quick, vis, createdAt: Date.now(), phase: "wait", round: 0, open: false,
    players: [], set: { time: 15, q: 10, max: 4, lvl: "easy" } };
  applySettings(r, settings);
  rooms.set(r.code, r);
  return r;
}
function addPlayer(r, ws, m) {
  const id = crypto.randomUUID(); // server-issued identity (the client's own id is never trusted)
  ws.room = r; ws.pid = id; ws.sub = false;
  const name = String(m.name || "Player").replace(/[\u0000-\u001f<>]/g, "").slice(0, 14) || "Player";
  r.players.push({ id, token: crypto.randomUUID(), name, av: String(m.av || "🎮").slice(0, 4), ws, score: 0 });
  if (!r.host) r.host = id;
}
function joinRoom(ws, m, code, publicOnly) {
  if (ws.room) return err(ws, "ALREADY_IN_ROOM", "You are already in a room. Leave it first.");
  const room = rooms.get(code);
  if (!room || (publicOnly && room.vis !== "public")) return err(ws, "NOT_FOUND", "Room not found. Check your room code.");
  if (room.phase === "done") return err(ws, "CLOSED", "This room is no longer available.");
  if (room.phase !== "wait") return err(ws, "STARTED", "This game has already started.");
  if (room.players.length >= room.set.max) return err(ws, "FULL", "This room is already full.");
  addPlayer(room, ws, m); castRoom(room); pubChanged();
}
function closeRoom(r, msg, except) {
  clearTimeout(r.timer);
  r.players.forEach(x => { if (x !== except && x.ws) { x.ws.room = null; send(x.ws, { t: "closed", msg }); } });
  rooms.delete(r.code);
  pubChanged();
}

/* ---- game flow (server-authoritative) ---- */
function start(r) {
  if (r.phase !== "wait" || !r.players.length) return;
  r.phase = "play"; r.round = 0;
  r.players.forEach(p => p.score = 0);
  cast(r, { t: "start" });
  pubChanged();
  r.timer = setTimeout(() => next(r), 2500);
}
function next(r) {
  if (r.round >= r.set.q) {
    r.phase = "done";
    cast(r, { t: "end", ranking: r.players.map(p => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score) });
    r.timer = setTimeout(() => { rooms.delete(r.code); pubChanged(); }, 60000);
    pubChanged();
    return;
  }
  r.round++;
  if (r.round === 1) pubChanged(); // "Starting" -> "In Game"
  r.q = gen(r.set.lvl);
  r.open = true;
  r.ends = Date.now() + r.set.time * 1000;
  r.players.forEach(p => { p.answered = false; p.gain = 0; });
  cast(r, qMsg(r));
  r.timer = setTimeout(() => close(r), r.set.time * 1000 + 150);
}
const qMsg = r => ({ t: "q", round: r.round, total: r.set.q, text: r.q.text, ends: r.ends, left: Math.max(0, r.ends - Date.now()), time: r.set.time });
function answer(r, p, v) {
  if (r.phase !== "play" || !r.open || p.answered) return;
  p.answered = true;
  const left = Math.max(0, r.ends - Date.now());
  p.gain = +v === r.q.ans ? 8 * Math.floor(left / 1000) : 0; // 112 max on a 15 s timer
  p.score += p.gain;
  if (r.players.filter(x => x.ws).every(x => x.answered)) close(r);
}
function close(r) {
  if (!r.open) return;
  r.open = false; clearTimeout(r.timer);
  const gains = {}, scores = {};
  r.players.forEach(p => { gains[p.id] = p.gain; scores[p.id] = p.score; });
  cast(r, { t: "reveal", answer: r.q.ans, gains, scores });
  r.timer = setTimeout(() => next(r), 3500);
}
function drop(ws) {
  const r = ws.room; if (!r) return;
  ws.room = null;
  const p = r.players.find(x => x.id === ws.pid);
  if (!p || p.ws !== ws) return; // already replaced by a reconnect
  if (r.phase === "wait") {
    if (r.host === p.id && !r.quick) return closeRoom(r, "The host closed the room.", p); // host left: close, nobody is left stranded
    r.players = r.players.filter(x => x !== p);
    if (!r.players.length) { rooms.delete(r.code); pubChanged(); return; }
    if (r.host === p.id) r.host = r.players[0].id; // quick-match rooms only: hand over to the next player
    castRoom(r); pubChanged();
  } else {
    p.ws = null; // keep the score so the player can rejoin
    if (r.players.every(x => !x.ws)) { clearTimeout(r.timer); rooms.delete(r.code); }
    else if (r.open && r.players.filter(x => x.ws).every(x => x.answered)) close(r);
    pubChanged();
  }
}

/* ---- message handling ---- */
wss.on("connection", ws => {
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", raw => {
    if (raw.length > 4000) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== "string") return;
    const r = ws.room;
    const me = r && r.players.find(x => x.id === ws.pid); // identity comes from the socket, not the message
    switch (m.t) {
      case "create": {
        if (ws.room) return err(ws, "ALREADY_IN_ROOM", "You are already in a room. Leave it first."); // also stops double-click duplicates
        if (m.visibility !== "public" && m.visibility !== "private") return err(ws, "BAD_VISIBILITY", "Choose Public or Private.");
        const room = makeRoom(m.settings, false, m.visibility);
        addPlayer(room, ws, m); castRoom(room); pubChanged();
        break;
      }
      case "join": joinRoom(ws, m, String(m.room || "").toUpperCase(), false); break;
      case "joinPublic": joinRoom(ws, m, String(m.room || "").toUpperCase(), true); break;
      case "quick": {
        if (ws.room) return err(ws, "ALREADY_IN_ROOM", "You are already in a room. Leave it first.");
        let room = [...rooms.values()].find(x => x.quick && x.phase === "wait" && x.players.length < x.set.max);
        if (!room) room = makeRoom({ lvl: m.settings && m.settings.lvl, max: 4 }, true, "public");
        addPlayer(room, ws, m); castRoom(room);
        if (room.players.length >= 2 && !room.starting) {
          room.starting = true;
          setTimeout(() => { if (rooms.get(room.code) === room && room.phase === "wait" && room.players.length >= 2) start(room); else room.starting = false; }, 3000);
        }
        break;
      }
      case "publicRooms": ws.sub = true; send(ws, { t: "publicRooms", rooms: listRooms() }); break;
      case "unsub": ws.sub = false; break;
      case "settings":
        if (r && me && r.phase === "wait" && r.host === me.id && !r.quick) { applySettings(r, m.settings); castRoom(r); pubChanged(); }
        break;
      case "start": if (r && me && r.host === me.id) start(r); break;
      case "ans": if (r && me && m.round === r.round) answer(r, me, m.v); break;
      case "close": if (r && me && r.host === me.id) drop(ws); break;
      case "leave": drop(ws); break;
      case "rejoin": {
        const room = rooms.get(String(m.room || "").toUpperCase());
        const pl = room && typeof m.token === "string" && room.players.find(x => x.token === m.token);
        if (!pl) return err(ws, "NOT_FOUND", "Could not rejoin that room.");
        if (pl.ws && pl.ws !== ws) { pl.ws.room = null; try { pl.ws.close(); } catch {} }
        pl.ws = ws; ws.room = room; ws.pid = pl.id; ws.sub = false;
        castRoom(room);
        if (room.open) send(ws, qMsg(room));
        pubChanged();
        break;
      }
    }
  });
  ws.on("close", () => drop(ws));
});

/* ---- housekeeping: drop dead sockets (e.g. a host whose connection vanished) and abandoned rooms ---- */
setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; try { c.ping(); } catch {} }
}, 30000);
setInterval(() => {
  for (const r of rooms.values()) if (r.players.every(p => !p.ws)) { clearTimeout(r.timer); rooms.delete(r.code); pubChanged(); }
}, 60000);

server.listen(PORT, () => console.log(`Math Quest running on http://localhost:${PORT}`));
