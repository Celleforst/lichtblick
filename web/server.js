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

function serveStaticFile(filePath, req, res) {
  fs.stat(filePath, (err, stat) => {
    if (err != null || !stat.isFile()) {
      // SPA fallback: serve index.html for unknown paths
      const indexPath = path.join(STATIC_DIR, "index.html");
      fs.readFile(indexPath, (e, data) => {
        if (e != null) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      });
      return;
    }
    serveWithRange(filePath, stat, req, res);
  });
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
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length",
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length",
    });
    fs.createReadStream(filePath).pipe(res);
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
