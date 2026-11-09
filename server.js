// Math Quest server: serves the game, runs multiplayer rooms, validates single-player games and owns all progression.
// Setup:  npm install   then   npm start   and open http://localhost:8080
// Data is saved to DATA_DIR/players.json (default ./data). On hosts with a temporary disk (e.g. Render's free plan),
// attach a persistent disk and set DATA_DIR to its mount path, or progress is lost when the service restarts.
//
// Client -> server: auth{id,secret,name} profile setName{name} equip{ids} claim leaderboard{cat}
//                   soloStart{mode,level,dur} soloAns{v} soloQuit
//                   create{settings,visibility} quick join{room} joinPublic{room} publicRooms unsub settings{settings}
//                   start ans{round,v} leave close rejoin{room,token}
// Server -> client: authed profile claimed lb soloQ soloFB soloEnd mpProgress
//                   room{code,vis,quick,you,token,host,settings,players} closed{msg} publicRooms{rooms} start q reveal end err{code,msg}
// Identity, host rights, visibility, capacity, scoring and every XP/achievement award are decided here, never by the client.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { WebSocketServer } = require("ws");
const P = require("./progression"), cfg = require("./progression.config"), Store = require("./store");
const PORT = process.env.PORT || 8080;
const HTML = path.join(__dirname, "math_quest.html");
const store = new Store(process.env.DATA_DIR || path.join(__dirname, "data"));

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
function gen(l, rnd = Math.random) {
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const ops = l === "easy" ? ["+", "−"] : ["+", "−", "×"], op = ops[ri(0, ops.length - 1)];
  let a, b;
  if (l === "easy") { a = ri(0, 10); b = ri(0, 10); }
  else if (l === "medium") { if (op === "×") { a = ri(1, 12); b = ri(1, 12); } else { a = ri(1, 100); b = ri(1, 100); } }
  else { if (op === "×") { a = ri(10, 50); b = ri(2, 19); } else { a = ri(10, 500); b = ri(10, 500); } }
  if (op === "−" && b > a) [a, b] = [b, a];
  return { text: `${a} ${op} ${b} = ?`, ans: op === "+" ? a + b : op === "−" ? a - b : a * b };
}
const seeded = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rand32 = n => { let c = ""; for (let i = 0; i < n; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; return c; };
const newCode = () => { let c; do c = rand32(4); while (rooms.has(c)); return c; }; // unique among active rooms
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const err = (ws, code, msg) => send(ws, { t: "err", code, msg });
const cast = (r, m) => r.players.forEach(p => send(p.ws, m));
const cleanName = n => String(n || "Player").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 14) || "Player";
const hash = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const today = () => P.ds(Date.now());
const acctOf = p => (p.acct ? store.get(p.acct) : null);
const lvlOf = p => { const a = acctOf(p); return a ? P.levelInfo(a.progression.totalXP).index : 1; };
const castRoom = r => r.players.forEach(p => send(p.ws, {
  t: "room", code: r.code, vis: r.vis, quick: r.quick, you: p.id, token: p.token, host: r.host, settings: r.set,
  players: r.players.map(x => ({ id: x.id, name: x.name, av: x.av, lvl: lvlOf(x) })),
}));

/* ---- accounts (guest accounts with a private sync code; works across devices) ---- */
function authenticate(ws, m) {
  let acct = null, secret = null, reset = false;
  if (typeof m.id === "string" && typeof m.secret === "string") {
    const p = store.get(m.id);
    if (p && safeEq(p.secretHash, hash(m.secret))) acct = p; else reset = true;
  }
  if (!acct) { secret = rand32(24); acct = P.newPlayer("P" + rand32(9), hash(secret), cleanName(m.name)); store.add(acct); }
  else if (m.name) acct.name = cleanName(m.name);
  acct.lastSeen = Date.now();
  ws.acct = acct;
  store.save();
  send(ws, { t: "authed", id: acct.id, secret, reset, config: P.clientConfig(), profile: P.publicProfile(acct) });
}
const pushProfile = ws => ws.acct && send(ws, { t: "profile", profile: P.publicProfile(ws.acct) });

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
      rid: r.id, code: r.vis === "public" ? r.code : null, vis: r.vis, host: host ? host.name : "?", av: host ? host.av : "🎮", hostLvl: host ? lvlOf(host) : 1,
      players: count, max: r.set.max, lvl: r.set.lvl, q: r.set.q, time: r.set.time,
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
  const id = crypto.randomUUID(); // server-issued identity for this seat
  ws.room = r; ws.pid = id; ws.sub = false;
  r.players.push({ id, token: crypto.randomUUID(), name: ws.acct ? ws.acct.name : cleanName(m.name), av: String(m.av || "🎮").slice(0, 4), ws, acct: ws.acct ? ws.acct.id : null, score: 0 });
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
// a game that dies mid-way counts as abandoned for every account that was playing: no rewards, streaks broken
function abandonRoom(r) {
  if (r.phase !== "play") return;
  for (const p of r.players) { const a = acctOf(p); if (a) P.abandon(a, "mp"); }
  store.save();
}

/* ---- multiplayer game flow (server-authoritative) ---- */
function start(r) {
  if (r.phase !== "wait" || !r.players.length) return;
  r.phase = "play"; r.round = 0;
  r.startedAt = Date.now(); r.gameId = "mp:" + r.id + ":" + r.startedAt; r.initial = r.players.length;
  r.players.forEach(p => { p.score = 0; p.correct = 0; p.wrong = 0; p.missed = 0; p.behind = false; });
  cast(r, { t: "start" });
  pubChanged();
  r.timer = setTimeout(() => next(r), cfg.timing.startMs);
}
function next(r) {
  if (r.round >= r.set.q) {
    r.phase = "done";
    const ranking = r.players.map(p => ({ id: p.id, score: p.score, lvl: lvlOf(p) })).sort((a, b) => b.score - a.score);
    cast(r, { t: "end", ranking });
    finalizeMP(r);
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
  const good = +v === r.q.ans;
  if (good) p.correct++; else p.wrong++;
  p.gain = good ? 8 * Math.floor(left / 1000) : 0; // 112 max on a 15 s timer
  p.score += p.gain;
  if (r.players.filter(x => x.ws).every(x => x.answered)) close(r);
}
function close(r) {
  if (!r.open) return;
  r.open = false; clearTimeout(r.timer);
  const gains = {}, scores = {};
  r.players.forEach(p => {
    if (!p.answered) p.missed++;
    gains[p.id] = p.gain; scores[p.id] = p.score;
  });
  r.players.forEach(p => { // "Comeback King" bookkeeping: how far behind the leader was this player?
    const others = r.players.filter(x => x !== p).map(x => x.score);
    if (others.length && Math.max(...others) - p.score >= cfg.mp.comebackDeficit) p.behind = true;
  });
  cast(r, { t: "reveal", answer: r.q.ans, gains, scores });
  r.timer = setTimeout(() => next(r), cfg.timing.revealMs);
}
// Rewards come only from this server's own record of the match. Players not connected at the end get nothing (abandoned).
function finalizeMP(r) {
  const top = Math.max(...r.players.map(p => p.score)), winners = r.players.filter(p => p.score === top), multi = r.players.length > 1;
  const seats = {};
  r.players.forEach(p => { if (p.acct) seats[p.acct] = (seats[p.acct] || 0) + 1; });
  for (const p of r.players) {
    const a = acctOf(p);
    if (!a) continue;
    if (!p.ws) { P.abandon(a, "mp"); continue; }
    if (seats[p.acct] > 1) { send(p.ws, { t: "mpProgress", denied: "The same account joined this room more than once, so no XP was awarded." }); continue; }
    const won = multi && winners.length === 1 && winners[0] === p;
    const outcome = !multi ? "none" : won ? "win" : winners.includes(p) ? "draw" : "loss";
    const total = r.set.q;
    const summary = P.awardGame(a, {
      gameId: r.gameId, mode: "mp", difficulty: r.set.lvl, correctByTier: { [r.set.lvl]: p.correct }, correct: p.correct, incorrect: p.wrong,
      score: p.score, won, outcome, perfect: p.correct === total, noTimeout: p.missed === 0, comeback: won && p.behind,
      untouchable: won && p.correct === total, fullRoom: won && r.initial >= 4,
    });
    store.flush(); // progress is saved the moment it is earned
    if (summary) send(p.ws, { t: "mpProgress", summary, profile: P.publicProfile(a) });
  }
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
    if (r.players.every(x => !x.ws)) { clearTimeout(r.timer); abandonRoom(r); rooms.delete(r.code); }
    else if (r.open && r.players.filter(x => x.ws).every(x => x.answered)) close(r);
    pubChanged();
  }
}

/* ---- single-player games (the server owns questions, timer, scoring and rewards) ---- */
const SOLO_MODES = Object.keys(cfg.soloWin);
function tierOf(s) {
  if (s.mode === "survival") return s.cor < 5 ? "easy" : s.cor < 12 ? "medium" : "hard";
  if (s.mode === "daily") return s.n < 3 ? "easy" : s.n < 7 ? "medium" : "hard";
  return s.level;
}
function nextQ(s) {
  const tier = tierOf(s);
  s.q = gen(tier, s.rng); s.n++; s.qAt = Date.now(); s.qTier = tier;
  s.maxTier = ["easy", "medium", "hard"].indexOf(tier) > ["easy", "medium", "hard"].indexOf(s.maxTier) ? tier : s.maxTier;
  return { text: s.q.text, n: s.n, tier };
}
function soloAbandon(ws) {
  const s = ws.solo; if (!s) return;
  clearTimeout(s.timer); s.done = true; ws.solo = null;
  if (ws.acct) { P.abandon(ws.acct, "solo"); store.save(); }
}
function soloStart(ws, m) {
  if (!ws.acct) return err(ws, "NO_ACCOUNT", "Still connecting to the progress server. Try again in a moment.");
  const mode = m.mode;
  if (!SOLO_MODES.includes(mode)) return err(ws, "BAD_MODE", "Unknown game mode.");
  if (mode === "daily" && ws.acct.daily.lastChallenge === today()) return err(ws, "DAILY_DONE", "You already completed today's challenge. Come back tomorrow!");
  soloAbandon(ws); // starting a new game while one is running abandons the old one
  const level = ["easy", "medium", "hard"].includes(m.level) ? m.level : "easy";
  const dur = mode === "classic" ? (cfg.durations.includes(+m.dur) ? +m.dur : 120) : mode === "attack" ? 30 : 0;
  const ms = dur * 1000 * cfg.timing.timeScale;
  const s = {
    id: "solo:" + crypto.randomUUID(), mode, level: mode === "daily" ? "mixed" : level, score: 0, cor: 0, wrong: 0, n: 0, t0: Date.now(), dur, ms,
    lives: mode === "endless" || mode === "survival" ? 3 : 0, rng: mode === "daily" ? seeded(+today().replace(/-/g, "")) : Math.random,
    byTier: { easy: 0, medium: 0, hard: 0 }, maxTier: "easy", endsAt: dur ? Date.now() + ms : 0,
  };
  ws.solo = s;
  if (dur) s.timer = setTimeout(() => soloFinish(ws, s), ms + 100);
  send(ws, { t: "soloQ", mode, level: s.level, dur, left: ms, lives: s.lives, q: nextQ(s) });
}
function soloAns(ws, m) {
  const s = ws.solo;
  if (!s || s.done || !s.q) return;
  const v = Number(m.v);
  if (m.v === null || m.v === "" || !Number.isFinite(v)) return;
  if (s.endsAt && Date.now() > s.endsAt + 500) return soloFinish(ws, s);
  if (Date.now() - s.qAt < cfg.limits.minAnswerMs) return send(ws, { t: "soloFB", ignored: true });
  const ans = s.q.ans, good = v === ans;
  if (good) { s.score++; s.cor++; s.byTier[s.qTier]++; } else { s.score -= 2; s.wrong++; if (s.lives > 0) s.lives--; }
  s.q = null;
  const over = ((s.mode === "endless" || s.mode === "survival") && s.lives === 0) || (s.mode === "daily" && s.cor + s.wrong >= 10);
  const fb = { t: "soloFB", good, ans, score: s.score, lives: s.lives, cor: s.cor, wrong: s.wrong, over };
  if (!over) fb.q = nextQ(s);
  send(ws, fb);
  if (over) soloFinish(ws, s);
}
function soloFinish(ws, s) {
  if (s.done) return;
  s.done = true; clearTimeout(s.timer);
  if (ws.solo === s) ws.solo = null;
  const a = ws.acct; if (!a) return;
  const n = s.cor + s.wrong, W = cfg.soloWin[s.mode];
  const won = s.cor >= W.minCorrect && (n ? s.cor / n : 0) >= W.minAccuracy;
  const difficulty = s.mode === "daily" ? cfg.dailyDifficulty : s.mode === "survival" ? s.maxTier : s.level;
  const summary = P.awardGame(a, {
    gameId: s.id, mode: "solo", difficulty, correctByTier: s.byTier, correct: s.cor, incorrect: s.wrong, score: s.score, won,
    perfect: s.wrong === 0 && s.cor >= cfg.soloPerfectMinAnswers, noTimeout: s.mode === "daily",
  });
  if (s.mode === "daily") a.daily.lastChallenge = today();
  store.flush();
  send(ws, { t: "soloEnd", mode: s.mode, level: s.level, score: s.score, cor: s.cor, wrong: s.wrong, accuracy: n ? Math.round(s.cor / n * 100) : 0, secs: Math.round((Date.now() - s.t0) / 1000), progress: summary, profile: P.publicProfile(a) });
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
      case "auth": authenticate(ws, m); break;
      case "profile": pushProfile(ws); break;
      case "setName": if (ws.acct) { ws.acct.name = cleanName(m.name); store.save(); pushProfile(ws); } break;
      case "equip": {
        if (!ws.acct || !Array.isArray(m.ids)) break;
        const un = ws.acct.achievements.unlocked;
        ws.acct.achievements.equipped = [...new Set(m.ids.filter(id => typeof id === "string" && un[id]))].slice(0, 3);
        store.save(); pushProfile(ws);
        break;
      }
      case "claim": {
        if (!ws.acct) break;
        const res = P.claimDaily(ws.acct);
        if (!res) { err(ws, "CLAIMED", "You already claimed today's reward."); break; }
        store.flush();
        send(ws, { t: "claimed", ...res, profile: P.publicProfile(ws.acct) });
        break;
      }
      case "leaderboard": {
        if (Date.now() - (ws.lbAt || 0) < 700) break;
        ws.lbAt = Date.now();
        const cat = cfg.leaderboards.some(c => c.id === m.cat) ? m.cat : "level";
        send(ws, { t: "lb", cat, list: P.leaderboard(store.all(), cat, 20, ws.acct && ws.acct.id) });
        break;
      }
      case "soloStart": soloStart(ws, m); break;
      case "soloAns": soloAns(ws, m); break;
      case "soloQuit": soloAbandon(ws); break;
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
  ws.on("close", () => { soloAbandon(ws); drop(ws); });
});

/* ---- housekeeping: drop dead sockets (e.g. a host whose connection vanished) and abandoned rooms ---- */
setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; try { c.ping(); } catch {} }
}, 30000);
setInterval(() => {
  for (const r of rooms.values()) if (r.players.every(p => !p.ws)) { clearTimeout(r.timer); abandonRoom(r); rooms.delete(r.code); pubChanged(); }
}, 60000);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { try { store.flush(); } catch {} process.exit(0); });
process.on("exit", () => { try { store.flush(); } catch {} });

server.listen(PORT, () => console.log(`Math Quest running on http://localhost:${PORT}`));
