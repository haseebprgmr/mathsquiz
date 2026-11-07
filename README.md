# Math Quest (web)

Neon math arcade with solo modes, profile/XP, leaderboards and 1–4 player multiplayer.

Files
- `math_quest.html`  the game (served at `/`)
- `server.js`        Node server: serves the game and runs multiplayer rooms (WebSocket)
- `package.json`     dependencies (`ws`) and the `npm start` command
- `render.yaml`      optional one-click Render config

Run locally: `npm install` then `npm start`, then open http://localhost:8080

Deploy: push these files to GitHub, then on Render create a Web Service from the repo
(Build: `npm install`, Start: `npm start`).
