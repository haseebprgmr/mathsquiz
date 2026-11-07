// Math Quest multiplayer server.
// Setup:  npm init -y && npm i ws   then   node server.js
// Put this file in the same folder as math_quest.html and open http://localhost:8080
// The server serves the game and injects the WebSocket address, so no HTML edits are needed.
const http = require("http"), fs = require("fs"), path = require("path");
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
const newCode = () => { let c; do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms.has(c)); return c; };
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const cast = (r, m) => r.players.forEach(p => send(p.ws, m));
const castRoom = r => r.players.forEach(p => send(p.ws, {
  t: "room", code: r.code, you: p.id, host: r.host, settings: r.set,
  players: r.players.map(({ id, name, av }) => ({ id, name, av }))
}));
function applySettings(r, c = {}) {
  const s = r.set;
  if ([10, 15, 20, 30].includes(+c.time)) s.time = +c.time;
  if (+c.q >= 10 && +c.q <= 20) s.q = Math.floor(+c.q);
  if (+c.max >= 1 && +c.max <= 4) s.max = Math.max(r.players.length, Math.floor(+c.max));
  if (["easy", "medium", "hard"].includes(c.lvl)) s.lvl = c.lvl;
}
function makeRoom(m, settings, quick) {
  const r = { code: newCode(), host: m.id, quick, phase: "wait", round: 0, open: false, players: [],
    set: { time: 15, q: 10, max: 4, lvl: "easy" } };
  applySettings(r, settings);
  rooms.set(r.code, r);
  return r;
}
function addPlayer(r, ws, m) {
  ws.room = r; ws.pid = m.id;
  r.players.push({ id: m.id, name: String(m.name || "Player").slice(0, 14), av: String(m.av || "🎮").slice(0, 4), ws, score: 0 });
}

/* ---- game flow (server-authoritative) ---- */
function start(r) {
  if (r.phase !== "wait" || !r.players.length) return;
  r.phase = "play"; r.round = 0;
  r.players.forEach(p => p.score = 0);
  cast(r, { t: "start" });
  r.timer = setTimeout(() => next(r), 2500);
}
function next(r) {
  if (r.round >= r.set.q) {
    r.phase = "done";
    cast(r, { t: "end", ranking: r.players.map(p => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score) });
    r.timer = setTimeout(() => rooms.delete(r.code), 60000);
    return;
  }
  r.round++;
  r.q = gen(r.set.lvl);
  r.open = true;
  r.ends = Date.now() + r.set.time * 1000;
  r.players.forEach(p => { p.answered = false; p.gain = 0; });
  cast(r, qMsg(r));
  r.timer = setTimeout(() => close(r), r.set.time * 1000 + 150);
}
const qMsg = r => ({ t: "q", round: r.round, total: r.set.q, text: r.q.text, ends: r.ends, time: r.set.time });
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
    r.players = r.players.filter(x => x !== p);
    if (!r.players.length) return void rooms.delete(r.code);
    if (r.host === p.id) r.host = r.players[0].id;
    castRoom(r);
  } else {
    p.ws = null; // keep the score so the player can rejoin
    if (r.players.every(x => !x.ws)) { clearTimeout(r.timer); rooms.delete(r.code); }
    else if (r.open && r.players.filter(x => x.ws).every(x => x.answered)) close(r);
  }
}

/* ---- message handling ---- */
wss.on("connection", ws => {
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.id !== "string" || m.id.length > 40) return;
    const r = ws.room, p = r && r.players.find(x => x.id === m.id);
    switch (m.t) {
      case "create": { drop(ws); const room = makeRoom(m, m.settings, false); addPlayer(room, ws, m); castRoom(room); break; }
      case "join": {
        drop(ws);
        const room = rooms.get(String(m.room || "").toUpperCase());
        if (!room) return send(ws, { t: "err", msg: "Room not found." });
        if (room.phase !== "wait") return send(ws, { t: "err", msg: "That game has already started." });
        if (room.players.length >= room.set.max) return send(ws, { t: "err", msg: "Room is full." });
        if (room.players.some(x => x.id === m.id)) return send(ws, { t: "err", msg: "You are already in this room." });
        addPlayer(room, ws, m); castRoom(room); break;
      }
      case "quick": {
        drop(ws);
        let room = [...rooms.values()].find(x => x.quick && x.phase === "wait" && x.players.length < x.set.max);
        if (!room) { room = makeRoom(m, { lvl: m.settings && m.settings.lvl, max: 4 }, true); }
        addPlayer(room, ws, m); castRoom(room);
        if (room.players.length >= 2 && !room.starting) { room.starting = true; setTimeout(() => start(room), 3000); }
        break;
      }
      case "settings": if (r && r.phase === "wait" && r.host === m.id) { applySettings(r, m.settings); castRoom(r); } break;
      case "start": if (r && r.host === m.id) start(r); break;
      case "ans": if (r && p) answer(r, p, m.v); break;
      case "rejoin": {
        const room = rooms.get(String(m.room || "").toUpperCase()), pl = room && room.players.find(x => x.id === m.id);
        if (!pl) return send(ws, { t: "err", msg: "Could not rejoin that room." });
        pl.ws = ws; ws.room = room; ws.pid = m.id;
        castRoom(room);
        if (room.open) send(ws, qMsg(room));
        break;
      }
      case "leave": drop(ws); break;
    }
  });
  ws.on("close", () => drop(ws));
});

server.listen(PORT, () => console.log(`Math Quest running on http://localhost:${PORT}`));
