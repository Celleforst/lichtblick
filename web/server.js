#!/usr/bin/env node
// Production server: serves built Lichtblick web app + rosbag files from ROSBAG_FOLDER.
//
// Usage:
//   ROSBAG_FOLDER=/mnt/rosbags node web/server.js
//   PORT=8080 ROSBAG_FOLDER=/mnt/rosbags node web/server.js

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const ROSBAG_FOLDER = process.env.ROSBAG_FOLDER ?? "/mnt/rosbags";
const CONFIG_DIR = process.env.CONFIG_DIR ?? "/app/config";
const EXTENSIONS_DIR = process.env.EXTENSIONS_DIR ?? "/app/extensions";
const STATIC_DIR = path.join(__dirname, ".webpack");

function listBagsRecursive(dir, base = "") {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const rel = base.length > 0 ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listBagsRecursive(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".mcap") || entry.name.endsWith(".bag")) {
      const stat = fs.statSync(path.join(dir, entry.name));
      results.push({ path: rel, size: stat.size });
    }
  }
  return results;
}

function getDefaultLayout() {
  try {
    const layoutPath = path.join(CONFIG_DIR, "default-layout.json");
    return fs.readFileSync(layoutPath, "utf8").trim();
  } catch {
    return "";
  }
}

function serveIndex(res) {
  const indexPath = path.join(STATIC_DIR, "index.html");
  fs.readFile(indexPath, "utf8", (e, html) => {
    if (e != null) { res.writeHead(404); res.end("Not found"); return; }
    const layout = getDefaultLayout();
    if (layout.length > 0) {
      html = html.replace("/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/", layout);
    }
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Length": Buffer.byteLength(html),
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    });
    res.end(html);
  });
}

function serveStaticFile(filePath, req, res) {
  fs.stat(filePath, (err, stat) => {
    if (err != null || !stat.isFile()) {
      serveIndex(res);
      return;
    }
    serveWithRange(filePath, stat, req, res);
  });
}

const READ_BUFFER = 2 * 1024 * 1024; // 2MB read buffer

function isBagFile(ext) {
  return ext === ".mcap" || ext === ".bag";
}

function serveWithRange(filePath, stat, req, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".mcap": "application/octet-stream",
    ".bag": "application/octet-stream",
  };
  const contentType = mimeTypes[ext] ?? "application/octet-stream";
  const etag = `"${stat.size}-${stat.mtimeMs}"`;

  // ETag cache validation — return 304 if unchanged
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length, ETag",
  };
  // Bag files: cache aggressively (content is immutable once recorded)
  const cacheHeaders = isBagFile(ext)
    ? { "Cache-Control": "public, max-age=86400", "ETag": etag, "Last-Modified": stat.mtime.toUTCString() }
    : { "Cache-Control": "no-cache" };

  const range = req.headers["range"];
  if (range != null) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] != null && parts[1].length > 0 ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
      ...corsHeaders,
      ...cacheHeaders,
    });
    fs.createReadStream(filePath, { start, end, highWaterMark: READ_BUFFER }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      ...corsHeaders,
      ...cacheHeaders,
    });
    fs.createReadStream(filePath, { highWaterMark: READ_BUFFER }).pipe(res);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length",
    });
    res.end();
    return;
  }

  if (pathname === "/api/ext-proxy") {
    const target = url.searchParams.get("url");
    if (!target) { res.writeHead(400); res.end("Missing url"); return; }
    let targetUrl;
    try { targetUrl = new URL(target); } catch { res.writeHead(400); res.end("Invalid url"); return; }
    if (targetUrl.protocol !== "https:") { res.writeHead(403); res.end("Only https allowed"); return; }
    void (async () => {
      try {
        const upstream = await fetch(target);
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "Content-Length": buf.length,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(buf);
      } catch {
        res.writeHead(502); res.end("Proxy fetch failed");
      }
    })();
    return;
  }

  if (pathname === "/api/extensions") {
    let files = [];
    try {
      files = fs.readdirSync(EXTENSIONS_DIR)
        .filter((f) => f.endsWith(".foxe"))
        .map((f) => ({ name: f, url: `/api/extensions/${f}` }));
    } catch { /* folder doesn't exist, return empty list */ }
    const body = JSON.stringify(files);
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  if (pathname.startsWith("/api/extensions/")) {
    const name = path.basename(pathname);
    const filePath = path.join(EXTENSIONS_DIR, name);
    if (!filePath.startsWith(path.resolve(EXTENSIONS_DIR)) || !name.endsWith(".foxe")) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err != null || !stat.isFile()) { res.writeHead(404); res.end("Not found"); return; }
      serveWithRange(filePath, stat, req, res);
    });
    return;
  }

  if (pathname === "/api/server-files") {
    const files = listBagsRecursive(ROSBAG_FOLDER);
    const body = JSON.stringify(files);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (pathname.startsWith("/bags/")) {
    const rel = pathname.slice("/bags/".length);
    const filePath = path.join(ROSBAG_FOLDER, rel);
    // prevent path traversal
    if (!filePath.startsWith(path.resolve(ROSBAG_FOLDER))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err != null || !stat.isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      serveWithRange(filePath, stat, req, res);
    });
    return;
  }

  // Serve static Lichtblick web app
  const filePath = path.join(STATIC_DIR, pathname === "/" ? "index.html" : pathname);
  serveStaticFile(filePath, req, res);
});

const { WebSocketServer, WebSocket } = require("ws");
const os = require("os");

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

// WebSocket proxy: browser connects to ws://server/proxy?target=ws://robot:8765
// and the server forwards the connection to the target from its own network.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/proxy") {
    socket.destroy();
    return;
  }
  const target = url.searchParams.get("target");
  if (target == null) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const protocols = req.headers["sec-websocket-protocol"];
    const serverWs = new WebSocket(target, protocols ? protocols.split(/,\s*/) : undefined);
    serverWs.on("open", () => {
      clientWs.on("message", (data, isBinary) => {
        if (serverWs.readyState === WebSocket.OPEN) serverWs.send(data, { binary: isBinary });
      });
      serverWs.on("message", (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary });
      });
      const isSendableCode = (code) =>
        (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
        (code >= 3000 && code <= 4999);
      const proxyClose = (dst, code, reason) => {
        if (dst.readyState === WebSocket.OPEN) {
          isSendableCode(code) ? dst.close(code, reason) : dst.terminate();
        }
      };
      clientWs.on("close", (code, reason) => { proxyClose(serverWs, code, reason); });
      serverWs.on("close", (code, reason) => { proxyClose(clientWs, code, reason); });
      clientWs.on("error", () => { serverWs.terminate(); });
      serverWs.on("error", () => { clientWs.terminate(); });
    });
    serverWs.on("error", (err) => {
      console.error(`[proxy] failed to connect to ${target}:`, err.message);
      clientWs.close(1011, "Proxy target unreachable");
    });
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, () => {
  const green = (s) => `\x1b[32m${s}\x1b[0m`;
  const bagCount = listBagsRecursive(ROSBAG_FOLDER).length;
  console.log(green(`<i> [lichtblick] Project is running at:`));
  console.log(green(`<i> [lichtblick] Loopback: http://localhost:${PORT}/`));
  for (const ip of getLocalIPs()) {
    console.log(green(`<i> [lichtblick] On Your Network (IPv4): http://${ip}:${PORT}/`));
  }
  console.log(green(`<i> [lichtblick] Serving rosbags from: ${ROSBAG_FOLDER} (${bagCount} files)`));
});
