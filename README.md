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

Rooms
- Create Room opens a settings screen (time, questions, max players, difficulty) and a Public/Private choice.
  Nothing exists on the server until CREATE ROOM is pressed.
- Public rooms are listed live in the Public Lobby; private rooms are joined only with their 4-character code.
- If the host leaves a waiting room, the room is closed and removed from the lobby (Quick Match rooms hand over to the next player).
