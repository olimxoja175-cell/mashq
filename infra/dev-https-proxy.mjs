// DEV ONLY: HTTPS entry point so phones on the same Wi-Fi get a secure context
// (camera/microphone require HTTPS outside localhost).
//   /ws/*  -> backend (uvicorn)     everything else -> Next.js
// Usage: node infra/dev-https-proxy.mjs   (env: PORT, FRONT, BACK, CERT_DIR)
import https from "node:https";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certDir = process.env.CERT_DIR || path.join(root, ".devcerts");
const PORT = Number(process.env.PORT || 3443);
const FRONT = new URL(process.env.FRONT || "http://127.0.0.1:3000");
const BACK = new URL(process.env.BACK || "http://127.0.0.1:8000");

const target = (url) => (url.startsWith("/ws/") ? BACK : FRONT);

const server = https.createServer(
  { key: fs.readFileSync(path.join(certDir, "key.pem")), cert: fs.readFileSync(path.join(certDir, "cert.pem")) },
  (req, res) => {
    const t = target(req.url);
    const up = http.request(
      {
        host: t.hostname, port: t.port, method: req.method, path: req.url,
        headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-for": req.socket.remoteAddress },
      },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
    );
    up.on("error", (e) => { res.writeHead(502); res.end("upstream error: " + e.message); });
    req.pipe(up);
  },
);

// WebSocket upgrade: raw TCP tunnel to the upstream
server.on("upgrade", (req, socket, head) => {
  const t = target(req.url);
  const up = net.connect(Number(t.port), t.hostname, () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    up.write(raw + "\r\n");
    if (head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, "0.0.0.0", () => console.log(`HTTPS dev proxy on https://0.0.0.0:${PORT} -> ${FRONT.href} , /ws -> ${BACK.href}`));
