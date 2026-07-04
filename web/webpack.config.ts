// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import fs from "fs";
import path from "path";

import {
  ConfigParams,
  WebpackConfiguration,
  devServerConfig,
  mainConfig,
} from "@lichtblick/suite-web/src/webpackConfigs";

import packageJson from "../package.json";

const params: ConfigParams = {
  outputPath: path.resolve(__dirname, ".webpack"),
  contextPath: path.resolve(__dirname, "src"),
  entrypoint: "./entrypoint.tsx",
  prodSourceMap: "source-map",
  version: packageJson.version,
};

const ROSBAG_FOLDER = process.env.ROSBAG_FOLDER ?? "/mnt/rosbags";

function listBagsRecursive(dir: string, base: string = ""): { path: string; size: number }[] {
  const results: { path: string; size: number }[] = [];
  let entries: fs.Dirent[];
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

const baseDevConfig = devServerConfig(params);

// Log the rosbag folder after the dev server starts
const originalOnListening = baseDevConfig.devServer?.onListening;


const devConfig: WebpackConfiguration = {
  ...baseDevConfig,
  devServer: {
    ...baseDevConfig.devServer,
    onListening: (devServer) => {
      originalOnListening?.(devServer);
      console.log(`\x1b[32m<i> [rosbag-server] Serving bags from: ${ROSBAG_FOLDER}\x1b[0m`);
    },
    setupMiddlewares: (middlewares, devServer) => {
      if (devServer.app == undefined) return middlewares;

      devServer.app.get("/api/ext-proxy", async (req, res) => {
        const target = String(req.query["url"] ?? "");
        if (!target) { res.status(400).send("Missing url"); return; }
        let targetUrl: URL;
        try { targetUrl = new URL(target); } catch { res.status(400).send("Invalid url"); return; }
        if (targetUrl.protocol !== "https:") { res.status(403).send("Only https allowed"); return; }
        try {
          const upstream = await fetch(target);
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.status(upstream.status).send(buf);
        } catch {
          res.status(502).send("Proxy fetch failed");
        }
      });

      devServer.app.get("/api/server-files", (_req, res) => {
        const files = listBagsRecursive(ROSBAG_FOLDER);
        res.json(files);
      });

      devServer.app.get("/bags/*", (req, res) => {
        const rel = req.url.replace(/^\/bags\//, "");
        const filePath = path.resolve(ROSBAG_FOLDER, rel);
        if (!filePath.startsWith(path.resolve(ROSBAG_FOLDER))) {
          res.status(403).send("Forbidden");
          return;
        }
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");
        res.sendFile(filePath, (err) => {
          if (err != undefined && !res.headersSent) {
            res.status(404).send("Not found");
          }
        });
      });

      return middlewares;
    },
  },
};

// foxglove-depcheck-used: webpack-dev-server
export default [devConfig, mainConfig(params)];
