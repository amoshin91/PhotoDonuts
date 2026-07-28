/* =============================================================================
   serve-and-run.js — start a static server, run a test file against it, stop.

   The browser suite needs the site over http:// (localStorage and module load
   order behave differently on file://). This keeps `npm run test:browser` a
   single command with nothing left listening afterwards.
   ============================================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 8765);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  // Never serve outside the project root.
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store", // never let the browser reuse a stale build
    });
    res.end(body);
  });
});

server.listen(PORT, () => {
  const target = process.argv[2];
  if (!target) { console.error("usage: node tests/serve-and-run.js <test-file>"); process.exit(2); }
  const child = spawn(process.execPath, [path.isAbsolute(target) ? target : path.join(ROOT, target)], {
    stdio: "inherit",
    env: Object.assign({}, process.env, { BASE_URL: `http://localhost:${PORT}` }),
  });
  child.on("exit", (code) => { server.close(); process.exit(code == null ? 1 : code); });
});
