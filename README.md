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
- The Multiplayer page has Create Room and Quick Match on top, and an "Open games" list below that updates live.
- Create Room opens a settings screen (time, questions, max players, difficulty) and a Public/Private choice.
  Nothing exists on the server until CREATE ROOM is pressed.
- Public rooms have a JOIN button. Private rooms appear as locked entries (the code is never sent to other players)
  and ask for the 4-character code when you press JOIN. To hide private rooms from the list entirely, set
  `LIST_PRIVATE_ROOMS = false` near the top of the lobby section in `server.js`.
- If the host leaves a waiting room, the room closes and disappears from the list (Quick Match rooms hand over to the next player).
