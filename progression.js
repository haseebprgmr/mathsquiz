// Progression logic: levels, XP awards, statistics, achievements. Pure functions over a player record.
const cfg = require("./progression.config");
const SCHEMA = 1;
const DIFF = ["easy", "medium", "hard"];
const AVATAR_COLLECTION = [
  { id: "noob", name: "NOOB", title: "The Mathematics Rookie", description: "A curious new mathematician with a notebook and a bright future ahead.", requiredLevel: 1, icon: "🧑‍🎓", palette: ["#9dd8ff", "#7c70ff", "#f2d5ff"], accent: "#7fe7ff" },
  { id: "nerd", name: "NERD", title: "The Mathematical Enthusiast", description: "A glasses-wearing scholar with formula notes, geometric diagrams and confidence.", requiredLevel: 2, icon: "🧠", palette: ["#8de9ff", "#4fa8ff", "#8d6bff"], accent: "#84deff" },
  { id: "beginner", name: "BEGINNER", title: "The Apprentice Mathematician", description: "A polished academic learner with digital tools and precise focus.", requiredLevel: 3, icon: "📐", palette: ["#9ef0d2", "#6be3c2", "#98a7ff"], accent: "#93f0ff" },
  { id: "expert", name: "EXPERT", title: "The Mathematical Scholar", description: "A seasoned researcher with elegant accessories and calm authority.", requiredLevel: 4, icon: "🧮", palette: ["#8cd9ff", "#7b8eff", "#d5f1ff"], accent: "#8ef2ff" },
  { id: "pro", name: "PRO", title: "The Mathematical Strategist", description: "A premium professional with holographic formulas and a commanding presence.", requiredLevel: 5, icon: "🏅", palette: ["#7d7dff", "#3e6dff", "#f0d88f"], accent: "#f5d77a" },
  { id: "genius", name: "GENIUS", title: "The Master of Mathematics", description: "A prestigious intellectual surrounded by glowing equations and elegant geometry.", requiredLevel: 6, icon: "🧠", palette: ["#24163a", "#5e35d1", "#f1d57d"], accent: "#8bd7ff" },
  { id: "prodigy", name: "PRODIGY", title: "The Mathematical Prodigy", description: "The ultimate legacy avatar — cosmic, luminous and unmistakably legendary.", requiredLevel: 7, icon: "👑", palette: ["#20163d", "#6737d2", "#ffd963"], accent: "#7ce7ff" },
];
const ds = t => new Date(t).toISOString().slice(0, 10); // UTC calendar date

const dflt = () => ({
  progression: { totalXP: 0, currentLevel: cfg.levels[0].id, unlockedLevels: [cfg.levels[0].id] },
  avatar: { selected: "noob", unlocked: ["noob"] },
  statistics: {
    overall: {
      gamesPlayed: 0, gamesWon: 0, gamesAbandoned: 0, correctAnswers: 0, incorrectAnswers: 0, perfectGames: 0, perfectWins: 0,
      consecutiveWins: 0, bestConsecutiveWins: 0, consecutiveCompleted: 0, bestConsecutiveCompleted: 0, highestScore: 0,
      highestDifficulty: "", comebackWins: 0, untouchableWins: 0, fullRoomWins: 0, playDays: [],
      byDifficulty: { easy: { completed: 0, wins: 0 }, medium: { completed: 0, wins: 0 }, hard: { completed: 0, wins: 0 } },
    },
    solo: { games: 0, abandoned: 0, answered: 0, correct: 0, incorrect: 0, wins: 0, highestScore: 0, highestDifficulty: "", xp: 0, perfect: 0 },
    multiplayer: { games: 0, abandoned: 0, wins: 0, losses: 0, draws: 0, answered: 0, correct: 0, incorrect: 0, highestScore: 0, highestDifficulty: "", xp: 0, perfect: 0, winStreak: 0, bestWinStreak: 0 },
  },
  achievements: { unlocked: {}, progress: {}, equipped: [] },
  history: { recentlyUnlocked: [], recentXPTransactions: [] },
  daily: { lastClaim: "", streak: 0, lastChallenge: "" },
  claimed: [], // ids of games already rewarded (prevents double awards)
});
// add any missing keys (used for new players and for safe migrations of older records)
function fill(t, d) {
  for (const k in d) {
    const v = d[k];
    if (t[k] === undefined) t[k] = JSON.parse(JSON.stringify(v));
    else if (v && typeof v === "object" && !Array.isArray(v) && t[k] && typeof t[k] === "object") fill(t[k], v);
  }
  return t;
}
const newPlayer = (id, secretHash, name) => fill({ v: SCHEMA, id, secretHash, name, createdAt: Date.now(), lastSeen: Date.now() }, dflt());
function migrate(rec) {
  rec.v = rec.v || 0;
  fill(rec, dflt());
  // future schema upgrades go here:  if (rec.v < 2) { ...; }
  rec.v = SCHEMA;
  return rec;
}

function levelInfo(xp) {
  const L = cfg.levels;
  let i = 0;
  for (let k = 0; k < L.length; k++) if (xp >= L[k].xp) i = k;
  const cur = L[i], next = L[i + 1] || null;
  return {
    index: i + 1, id: cur.id, total: xp, next: next ? next.id : null, max: !next,
    xpInLevel: xp - cur.xp, xpForLevel: next ? next.xp - cur.xp : 0,
    pct: next ? Math.min(100, ((xp - cur.xp) / (next.xp - cur.xp)) * 100) : 100,
  };
}

const O = p => p.statistics.overall, SP = p => p.statistics.solo, MPS = p => p.statistics.multiplayer;
const STAT = {
  wins: p => O(p).gamesWon, correct: p => O(p).correctAnswers, perfectGames: p => O(p).perfectGames,
  gamesPlayed: p => O(p).gamesPlayed, playDays: p => O(p).playDays.length,
  easyCompleted: p => O(p).byDifficulty.easy.completed, mediumCompleted: p => O(p).byDifficulty.medium.completed,
  hardCompleted: p => O(p).byDifficulty.hard.completed, hardWins: p => O(p).byDifficulty.hard.wins,
  totalXP: p => p.progression.totalXP, mpGames: p => MPS(p).games, mpWins: p => MPS(p).wins, mpBestStreak: p => MPS(p).bestWinStreak,
  bestWinStreak: p => O(p).bestConsecutiveWins, comebackWins: p => O(p).comebackWins, untouchableWins: p => O(p).untouchableWins,
  perfectWins: p => O(p).perfectWins, bestCompletedStreak: p => O(p).bestConsecutiveCompleted, fullRoomWins: p => O(p).fullRoomWins,
  levelIndex: p => levelInfo(p.progression.totalXP).index,
};
for (const a of cfg.achievements) {
  if (!STAT[a.stat]) throw new Error("progression.config: unknown stat '" + a.stat + "' in achievement " + a.id);
  if (a.milestones.some((m, i) => i && m <= a.milestones[i - 1])) throw new Error("milestones must increase: " + a.id);
}

const descFor = (d, n) => d.desc.replace("{n}", Number(n).toLocaleString("en-US")).replace("(s)", n === 1 ? "" : "s");
const lookOf = (d, t) => (d.look && d.look[t - 1]) || t;
const better = (a, b) => (DIFF.indexOf(b) > DIFF.indexOf(a) ? b : a);

function addXP(p, n, source, ref, now) {
  if (!n) return;
  p.progression.totalXP += n;
  const h = p.history.recentXPTransactions;
  h.unshift({ at: now, source, ref, xp: n });
  if (h.length > cfg.limits.recentXP) h.length = cfg.limits.recentXP;
}
function syncLevels(p) {
  const info = levelInfo(p.progression.totalXP);
  p.progression.currentLevel = info.id;
  for (let i = 0; i < info.index; i++) if (!p.progression.unlockedLevels.includes(cfg.levels[i].id)) p.progression.unlockedLevels.push(cfg.levels[i].id);
  return info;
}

function syncAvatarUnlocks(p) {
  p.avatar = p.avatar || { selected: "noob", unlocked: ["noob"] };
  const currentLevel = levelInfo(p.progression.totalXP).index;
  const unlocked = new Set(p.avatar.unlocked && p.avatar.unlocked.length ? p.avatar.unlocked : ["noob"]);
  for (const avatar of AVATAR_COLLECTION) if (avatar.requiredLevel <= currentLevel) unlocked.add(avatar.id);
  p.avatar.unlocked = [...unlocked].sort((a, b) => {
    const ai = AVATAR_COLLECTION.findIndex(v => v.id === a);
    const bi = AVATAR_COLLECTION.findIndex(v => v.id === b);
    return ai - bi;
  });
  if (!p.avatar.selected || !unlocked.has(p.avatar.selected)) p.avatar.selected = "noob";
  return p.avatar;
}

// Unlock every tier whose milestone has been reached (several at once is fine). Rewards are paid once per tier.
// Rewards add XP, which can unlock more (XP / level based) achievements, so repeat until nothing changes.
function checkAchievements(p, now = Date.now()) {
  const out = [];
  for (let guard = 0, again = true; again && guard < 20; guard++) {
    again = false;
    for (const d of cfg.achievements) {
      const v = STAT[d.stat](p);
      p.achievements.progress[d.id] = v;
      const have = (p.achievements.unlocked[d.id] || { tier: 0 }).tier;
      let reached = 0;
      d.milestones.forEach((m, i) => { if (v >= m) reached = i + 1; });
      for (let t = have + 1; t <= reached; t++) {
        const xp = (d.rewards || cfg.tierRewards)[t - 1] || 0, look = lookOf(d, t);
        p.achievements.unlocked[d.id] = { tier: t, at: now };
        addXP(p, xp, "achievement", d.id + ":" + t, now);
        const rec = { id: d.id, tier: t, look, tierName: cfg.tierNames[look - 1], name: d.name, cat: d.cat, icon: d.icon, xp, milestone: d.milestones[t - 1], desc: descFor(d, d.milestones[t - 1]), at: now };
        out.push(rec);
        p.history.recentlyUnlocked.unshift(rec);
        again = true;
      }
    }
  }
  if (p.history.recentlyUnlocked.length > cfg.limits.recentUnlocked) p.history.recentlyUnlocked.length = cfg.limits.recentUnlocked;
  return out;
}

// result: { gameId, mode:"solo"|"mp", difficulty, correctByTier:{easy,medium,hard}, correct, incorrect, score,
//           won, outcome ("win"|"loss"|"draw"|"none", mp only), perfect, noTimeout, comeback, untouchable, fullRoom }
// Returns null if this game was already rewarded.
function awardGame(p, r, now = Date.now()) {
  if (p.claimed.includes(r.gameId)) return null;
  p.claimed.push(r.gameId);
  if (p.claimed.length > cfg.limits.claimedGames) p.claimed.splice(0, p.claimed.length - cfg.limits.claimedGames);
  const before = levelInfo(p.progression.totalXP), xpBefore = p.progression.totalXP;
  const o = O(p), mp = r.mode === "mp", side = mp ? MPS(p) : SP(p);

  // statistics (all derived from the server's own game result)
  o.gamesPlayed++; o.correctAnswers += r.correct; o.incorrectAnswers += r.incorrect;
  side.games++; side.answered += r.correct + r.incorrect; side.correct += r.correct; side.incorrect += r.incorrect;
  o.highestScore = Math.max(o.highestScore, r.score); side.highestScore = Math.max(side.highestScore, r.score);
  if (r.perfect) { o.perfectGames++; side.perfect++; if (r.won) o.perfectWins++; }
  const bd = o.byDifficulty[r.difficulty]; bd.completed++; if (r.won) bd.wins++;
  o.highestDifficulty = better(o.highestDifficulty, r.difficulty); side.highestDifficulty = better(side.highestDifficulty, r.difficulty);
  if (r.won) { o.gamesWon++; o.consecutiveWins++; o.bestConsecutiveWins = Math.max(o.bestConsecutiveWins, o.consecutiveWins); } else o.consecutiveWins = 0;
  o.consecutiveCompleted++; o.bestConsecutiveCompleted = Math.max(o.bestConsecutiveCompleted, o.consecutiveCompleted);
  if (mp) {
    if (r.outcome === "win") { side.wins++; side.winStreak++; side.bestWinStreak = Math.max(side.bestWinStreak, side.winStreak); } else {
      side.winStreak = 0;
      if (r.outcome === "loss") side.losses++; else if (r.outcome === "draw") side.draws++;
    }
    if (r.won) { if (r.comeback) o.comebackWins++; if (r.untouchable) o.untouchableWins++; if (r.fullRoom) o.fullRoomWins++; }
  } else if (r.won) side.wins++;
  const day = ds(now);
  if (!o.playDays.includes(day)) { o.playDays.push(day); if (o.playDays.length > cfg.limits.maxPlayDays) o.playDays.shift(); }

  // XP
  const X = cfg.xp, by = r.correctByTier || {};
  const correctXP = DIFF.reduce((s, t) => s + (by[t] || 0) * X.perCorrect[t], 0);
  const breakdown = [
    { id: "correct", label: "Correct Answers", xp: correctXP },
    { id: "completion", label: "Game Completion", xp: X.completion },
    { id: "win", label: mp ? "Multiplayer Victory" : "Victory Bonus", xp: r.won ? (mp ? X.mpWin : X.soloWin) : 0 },
    { id: "perfect", label: "Perfect Score Bonus", xp: r.perfect ? X.perfect : 0 },
    { id: "noTimeout", label: "Finished In Time", xp: r.noTimeout ? X.noTimeout : 0 },
  ];
  const total = breakdown.reduce((s, b) => s + b.xp, 0);
  addXP(p, total, "game", r.gameId, now);
  side.xp += total;
  const achievements = checkAchievements(p, now);
  const after = syncLevels(p);
  const levelsGained = cfg.levels.slice(before.index, after.index).map(l => l.id);
  return {
    gameId: r.gameId, mode: r.mode, won: !!r.won, perfect: !!r.perfect, breakdown, total, xpBefore, xpAfter: p.progression.totalXP,
    levelBefore: before, levelAfter: after, levelsGained, achievements,
  };
}

// Leaving a game early: no rewards, and win / completion streaks are broken (so quitting a losing game can't protect a streak).
function abandon(p, mode) {
  O(p).gamesAbandoned++; (mode === "mp" ? MPS(p) : SP(p)).abandoned++;
  O(p).consecutiveWins = 0; O(p).consecutiveCompleted = 0; MPS(p).winStreak = 0;
}

function claimDaily(p, now = Date.now()) {
  const today = ds(now);
  if (p.daily.lastClaim === today) return null;
  const before = levelInfo(p.progression.totalXP);
  p.daily.streak = p.daily.lastClaim === ds(now - 864e5) ? p.daily.streak + 1 : 1;
  p.daily.lastClaim = today;
  const c = cfg.xp.dailyReward, xp = c.base + c.perStreakDay * Math.min(p.daily.streak, c.maxStreakDays);
  addXP(p, xp, "dailyReward", "daily:" + today, now);
  const achievements = checkAchievements(p, now);
  const after = syncLevels(p);
  return { xp, total: xp, streak: p.daily.streak, levelBefore: before, levelAfter: after, levelsGained: cfg.levels.slice(before.index, after.index).map(l => l.id), achievements };
}

const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
function publicProfile(p) {
  const o = O(p), s = SP(p), m = MPS(p), unlocked = p.achievements.unlocked, ach = {};
  for (const d of cfg.achievements) ach[d.id] = { tier: (unlocked[d.id] || { tier: 0 }).tier, value: STAT[d.stat](p) };
  const info = syncLevels(p);
  const avatarState = syncAvatarUnlocks(p);
  return {
    id: p.id, name: p.name, info, unlockedLevels: p.progression.unlockedLevels, createdAt: p.createdAt,
    avatar: {
      selected: avatarState.selected,
      unlocked: avatarState.unlocked,
      collection: AVATAR_COLLECTION.map(a => ({
        ...a,
        unlocked: avatarState.unlocked.includes(a.id),
        selected: avatarState.selected === a.id,
      })),
    },
    stats: {
      overall: { gamesPlayed: o.gamesPlayed, gamesWon: o.gamesWon, gamesAbandoned: o.gamesAbandoned, correct: o.correctAnswers, incorrect: o.incorrectAnswers, perfectGames: o.perfectGames, bestWinStreak: o.bestConsecutiveWins, highestScore: o.highestScore, highestDifficulty: o.highestDifficulty, daysPlayed: o.playDays.length, mpWinRate: rate(m.wins, m.games), byDifficulty: o.byDifficulty },
      solo: { ...s },
      mp: { ...m, winRate: rate(m.wins, m.games) },
    },
    achievements: ach, equipped: p.achievements.equipped, recent: p.history.recentlyUnlocked.slice(0, 10), recentXP: p.history.recentXPTransactions.slice(0, 10),
    daily: p.daily,
  };
}

function leaderboard(players, cat, limit = 20, meId) {
  const val = {
    level: p => p.progression.totalXP, xp: p => p.progression.totalXP, mpwins: p => MPS(p).wins,
    correct: p => O(p).correctAnswers, games: p => O(p).gamesPlayed,
  }[cat] || (p => p.progression.totalXP);
  return players.map(p => ({ p, v: val(p) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v || a.p.createdAt - b.p.createdAt).slice(0, limit)
    .map((x, i) => {
      const info = levelInfo(x.p.progression.totalXP);
      return { rank: i + 1, name: x.p.name, lvl: info.index, lvlName: info.id, value: x.v, sub: cat === "level" ? info.total.toLocaleString("en-US") + " XP" : "", me: x.p.id === meId };
    });
}

function clientConfig() {
  return {
    levels: cfg.levels, xp: cfg.xp, tierNames: cfg.tierNames, tierRewards: cfg.tierRewards, categories: cfg.categories,
    leaderboards: cfg.leaderboards, soloWin: cfg.soloWin, comebackDeficit: cfg.mp.comebackDeficit,
    achievements: cfg.achievements.map(d => ({ id: d.id, cat: d.cat, name: d.name, icon: d.icon, desc: d.desc, milestones: d.milestones, rewards: d.rewards || cfg.tierRewards.slice(0, d.milestones.length), look: d.milestones.map((_, i) => lookOf(d, i + 1)) })),
  };
}

module.exports = { SCHEMA, AVATAR_COLLECTION, newPlayer, migrate, levelInfo, awardGame, abandon, claimDaily, checkAchievements, publicProfile, leaderboard, clientConfig, STAT, descFor, syncLevels, syncAvatarUnlocks, ds };
