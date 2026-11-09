// Player storage. Default: one JSON file written atomically (DATA_DIR/players.json).
// To use a real database later, keep this same small interface (get / add / save / flush / all) and swap the class.
const fs = require("fs"), path = require("path");
const P = require("./progression");

class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "players.json");
    this.players = {};
    this.timer = null;
    this.load();
  }
  load() {
    let raw;
    try { raw = fs.readFileSync(this.file, "utf8"); } catch { return; }
    try {
      const d = JSON.parse(raw);
      this.players = d.players || {};
      for (const id in this.players) this.players[id] = P.migrate(this.players[id]); // safe schema migration
    } catch (e) {
      fs.copyFileSync(this.file, this.file + ".corrupt-" + Date.now());
      console.error("players.json could not be read; a backup copy was kept. Starting empty.", e.message);
      this.players = {};
    }
  }
  get(id) { return this.players[id]; }
  add(p) { this.players[p.id] = p; this.save(); }
  all() { return Object.values(this.players); }
  save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 50); }
  flush() { // write to a temp file, then rename, so a crash can never leave a half-written file
    clearTimeout(this.timer);
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ schema: P.SCHEMA, players: this.players }));
    fs.renameSync(tmp, this.file);
  }
}
module.exports = Store;
