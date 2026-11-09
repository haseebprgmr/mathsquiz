# Math Quest (web)

Neon math arcade: solo modes, 1-4 player rooms, levels/XP, achievements, rankings.

## Files
- `math_quest.html`        the game (served at `/`)
- `server.js`              Node server: serves the game, runs rooms, validates solo games, owns all progression
- `progression.config.js`  ALL balance numbers and content (levels, XP, bonuses, achievements, tiers, rewards)
- `progression.js`         level / XP / statistics / achievement logic
- `store.js`               player storage (JSON file, atomic writes) - swap for a database by keeping the same small interface
- `package.json`, `render.yaml`, `.gitignore`

## Run locally
`npm install` then `npm start`, open http://localhost:8080

## Progression in one minute
- Guest accounts: the first visit creates an account on the server; the browser keeps a secret key.
  To move to another device open Profile -> "Show sync code", copy it, and paste it under "Restore" on the other device.
- XP, levels, statistics and achievements are computed only on the server from its own record of each game.
  The browser cannot send XP. Solo games run on the server (questions, timer, scoring); multiplayer already did.
- Edit `progression.config.js` to rebalance. Restart the server to apply.

## IMPORTANT: where progress is stored
Player data is saved to `DATA_DIR/players.json` (default `./data`). On Render's free plan the disk is erased on every
redeploy/restart, which would wipe all progress. To keep it, use a paid plan with a Persistent Disk, mount it
(e.g. `/var/data`) and set the environment variable `DATA_DIR=/var/data`. Back up that file regularly.
For many players, replace `store.js` with a database (e.g. Postgres) implementing the same methods.

## Rooms
- The Multiplayer page has Create Room and Quick Match on top, and an "Open games" list below that updates live.
- Create Room opens a settings screen (time, questions, max players, difficulty) and a Public/Private choice.
  Nothing exists on the server until CREATE ROOM is pressed.
- Public rooms have a JOIN button. Private rooms appear as locked entries (the code is never sent to other players)
  and ask for the 4-character code when you press JOIN. To hide private rooms from the list entirely, set
  `LIST_PRIVATE_ROOMS = false` near the top of the lobby section in `server.js`.
- If the host leaves a waiting room, the room closes and disappears from the list (Quick Match rooms hand over to the next player).
