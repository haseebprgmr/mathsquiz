// ============================================================================
// Math Quest progression: ALL balance numbers and content live in this file.
// The server reads it to award XP/achievements and sends the display parts to the game UI,
// so changing a value here changes the whole game. No other file needs editing.
// ============================================================================
const num = (name, fallback) => (process.env[name] !== undefined ? Number(process.env[name]) : fallback);

// Reward per achievement tier (used unless an achievement sets its own `rewards`).
const TIER_REWARDS = [10, 20, 40, 75, 125];

// A(category, id, name, icon, description, stat, milestones, rewards?, look?)
//  - {n} in the description is replaced with the milestone; "(s)" becomes "s" unless n is 1.
//  - `stat` must exist in progression.js (STAT). Tiers unlock one by one as the stat passes each milestone.
//  - `look` (optional) picks the badge tier (1-5) used for each milestone's artwork.
const A = (cat, id, name, icon, desc, stat, milestones, rewards, look) => ({ cat, id, name, icon, desc, stat, milestones, rewards, look });

module.exports = {
  // Cumulative XP needed for each level. Edit freely; add/remove levels if you like.
  levels: [
    { id: "NOOB", xp: 0, color: "#9aa3b8", color2: "#5c6580", icon: "🐣", blurb: "Everyone starts somewhere." },
    { id: "NERD", xp: 150, color: "#5ff0ff", color2: "#2a7fd6", icon: "🤓", blurb: "Numbers are getting friendly." },
    { id: "BEGINNER", xp: 400, color: "#5dffb0", color2: "#1f9d6a", icon: "📐", blurb: "You know your way around." },
    { id: "EXPERT", xp: 850, color: "#ffd86b", color2: "#d68a1f", icon: "🧮", blurb: "Fast and accurate." },
    { id: "PRO", xp: 1500, color: "#ff9a4d", color2: "#e0361f", icon: "🏅", blurb: "A real contender." },
    { id: "GENIUS", xp: 2500, color: "#ff4fd8", color2: "#7a3cff", icon: "🧠", blurb: "Brilliance on demand." },
    { id: "PRODIGY", xp: 4000, color: "#ffe27a", color2: "#b66cff", icon: "👑", blurb: "A legend of Math Quest." },
  ],

  xp: {
    perCorrect: { easy: 2, medium: 4, hard: 7 }, // XP per correct answer (by the question's difficulty). Wrong answers give 0.
    completion: 5,   // finishing a game (never for abandoned games)
    soloWin: 10,     // winning a single-player challenge (see soloWin rules below)
    mpWin: 15,       // winning a multiplayer match
    perfect: 10,     // perfect score (every question correct)
    noTimeout: 5,    // multiplayer: answered every question in time. Solo: finished the Daily Challenge's full set.
    dailyReward: { base: 20, perStreakDay: 10, maxStreakDays: 7 },
  },

  // What counts as "winning" a single-player game. Tune per mode.
  soloWin: {
    classic: { minCorrect: 10, minAccuracy: 0.7 },
    attack: { minCorrect: 8, minAccuracy: 0.7 },
    endless: { minCorrect: 15, minAccuracy: 0 },
    survival: { minCorrect: 10, minAccuracy: 0 },
    daily: { minCorrect: 7, minAccuracy: 0 },
  },
  soloPerfectMinAnswers: 10, // a solo "perfect game" needs at least this many correct answers and zero mistakes
  dailyDifficulty: "medium", // difficulty bucket used for stats when a game mixes difficulties (Daily Challenge)
  durations: [60, 120, 300, 600], // allowed Classic Challenge lengths (seconds)

  mp: { comebackDeficit: 40 }, // "Comeback King": won after trailing the leader by at least this many points

  tierNames: ["Bronze", "Silver", "Gold", "Platinum", "Legendary"],
  tierRewards: TIER_REWARDS,

  categories: [
    { id: "victory", label: "Victory", icon: "🏆" },
    { id: "knowledge", label: "Knowledge", icon: "🧠" },
    { id: "dedication", label: "Dedication", icon: "🔥" },
    { id: "difficulty", label: "Difficulty", icon: "⛰️" },
    { id: "xp", label: "XP", icon: "✨" },
    { id: "multiplayer", label: "Multiplayer", icon: "⚔️" },
    { id: "special", label: "Special", icon: "👑" },
  ],

  achievements: [
    // A. Victory
    A("victory", "first_victory", "First Victory", "🥇", "Win {n} game(s)", "wins", [1, 10, 50, 100, 500]),
    A("victory", "victory_master", "Victory Master", "🏆", "Win {n} game(s)", "wins", [10, 50, 100, 500, 1000]),
    A("victory", "unstoppable", "Unstoppable", "🔥", "Win {n} games in a row", "bestWinStreak", [3, 5, 10, 25]),
    A("victory", "champion", "Champion", "👑", "Win {n} multiplayer game(s)", "mpWins", [10, 50, 100, 250]),
    // B. Knowledge
    A("knowledge", "first_steps", "First Steps", "👣", "Answer {n} question(s) correctly", "correct", [10, 50, 100, 500]),
    A("knowledge", "mathematician", "Mathematician", "📐", "Answer {n} questions correctly", "correct", [1000, 5000, 10000]),
    A("knowledge", "walking_calculator", "Walking Calculator", "🧮", "Answer {n} questions correctly", "correct", [25000, 50000, 100000], [40, 75, 125]),
    A("knowledge", "perfect_mind", "Perfect Mind", "🎯", "Finish {n} perfect game(s)", "perfectGames", [1, 10, 50, 100]),
    // C. Dedication
    A("dedication", "getting_started", "Getting Started", "🌱", "Play {n} game(s)", "gamesPlayed", [1, 5, 10, 25]),
    A("dedication", "dedicated_player", "Dedicated Player", "💪", "Play {n} games", "gamesPlayed", [50, 100, 250, 500]),
    A("dedication", "veteran", "Veteran", "🎖️", "Play {n} games", "gamesPlayed", [1000, 2500, 5000], [40, 75, 125]),
    A("dedication", "regular", "Regular", "📅", "Play on {n} different day(s)", "playDays", [3, 7, 30, 100]),
    // D. Difficulty
    A("difficulty", "easy_does_it", "Easy Does It", "🍀", "Complete {n} Easy games", "easyCompleted", [10, 50, 100]),
    A("difficulty", "medium_mind", "Medium Mind", "🚀", "Complete {n} Medium games", "mediumCompleted", [10, 50, 100]),
    A("difficulty", "hard_thinker", "Hard Thinker", "🧗", "Complete {n} Hard games", "hardCompleted", [10, 50, 100]),
    A("difficulty", "fearless", "Fearless", "🦁", "Win {n} Hard games", "hardWins", [5, 25, 50, 100]),
    // E. XP
    A("xp", "xp_collector", "XP Collector", "💎", "Earn {n} total XP", "totalXP", [500, 1000, 5000]),
    A("xp", "experience_hunter", "Experience Hunter", "🏹", "Earn {n} total XP", "totalXP", [10000, 25000, 50000], [40, 75, 125]),
    A("xp", "legendary_grinder", "Legendary Grinder", "⚙️", "Earn {n} total XP", "totalXP", [100000, 250000, 500000], [75, 125, 250]),
    // F. Multiplayer
    A("multiplayer", "social_player", "Social Player", "🤝", "Play {n} multiplayer game(s)", "mpGames", [5, 25, 100]),
    A("multiplayer", "mp_champion", "Multiplayer Champion", "🏟️", "Win {n} multiplayer games", "mpWins", [10, 50, 100, 500]),
    A("multiplayer", "dominator", "Dominator", "⚡", "Win {n} multiplayer games in a row", "mpBestStreak", [3, 5, 10]),
    A("multiplayer", "comeback_king", "Comeback King", "🔄", "Win a multiplayer game after trailing the leader", "comebackWins", [1], [40], [3]),
    A("multiplayer", "untouchable", "Untouchable", "🛡️", "Win a multiplayer game without missing a question", "untouchableWins", [1], [60], [4]),
    // G. Special (single milestone, bigger rewards, special badge look)
    A("special", "first_game", "First Game", "🎮", "Complete your first game", "gamesPlayed", [1], [15], [2]),
    A("special", "first_mp_win", "First Blood", "⚔️", "Win your first multiplayer game", "mpWins", [1], [25], [3]),
    A("special", "first_hard_win", "Hard Won", "🧗", "Win a game on Hard difficulty", "hardWins", [1], [30], [3]),
    A("special", "perfect_win", "Flawless Victory", "💯", "Win a game with a perfect score", "perfectWins", [1], [40], [4]),
    A("special", "ten_in_row", "Marathon", "🏃", "Complete 10 games in a row", "bestCompletedStreak", [10], [50], [3]),
    A("special", "reach_pro", "Going Pro", "🏅", "Reach the PRO level", "levelIndex", [5], [100], [3]),
    A("special", "reach_genius", "Certified Genius", "🧠", "Reach the GENIUS level", "levelIndex", [6], [200], [4]),
    A("special", "reach_prodigy", "Prodigy", "👑", "Reach the PRODIGY level", "levelIndex", [7], [400], [5]),
    A("special", "full_house", "Full House", "🏠", "Win against three other players in a full room", "fullRoomWins", [1], [100], [4]),
  ],

  leaderboards: [
    { id: "level", label: "Highest Level" },
    { id: "xp", label: "Total XP" },
    { id: "mpwins", label: "Multiplayer Wins" },
    { id: "correct", label: "Correct Answers" },
    { id: "games", label: "Games Played" },
  ],

  limits: {
    minAnswerMs: num("MQ_MIN_ANSWER_MS", 300), // faster solo answers are ignored (no human reads + types that quickly)
    recentXP: 30, recentUnlocked: 20, claimedGames: 300, maxPlayDays: 2000,
  },
  // Timing knobs (the env overrides exist so automated tests can run quickly; leave them alone in production).
  timing: { revealMs: num("MQ_REVEAL_MS", 3500), startMs: num("MQ_START_MS", 2500), timeScale: num("MQ_TIME_SCALE", 1) },
};
