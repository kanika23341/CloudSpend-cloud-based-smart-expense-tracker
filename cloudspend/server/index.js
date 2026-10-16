"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./env");

loadEnv();

// Fail early, with a clear message, if the project was copied incompletely.
const root = path.join(__dirname, "..");
const required = [
  "views/index.html", "views/login.html", "views/register.html",
  "public/app.js", "public/auth.js", "public/style.css", "public/auth.css"
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`\nMissing project files (looked in ${root}):\n  ${missing.join("\n  ")}\n`);
  console.error("Copy the full project (server, views, public folders) and run npm start from its root.");
  process.exit(1);
}
if (!fs.existsSync(path.join(root, "node_modules", "chart.js", "dist", "chart.umd.js"))) {
  console.warn("chart.js is not installed, so charts will not load. Run: npm install");
}
const { openDb } = require("./db");
const { createApp } = require("./app");

const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "cloudspend.db");

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    console.error("JWT_SECRET must be set when NODE_ENV=production.");
    process.exit(1);
  }
  jwtSecret = crypto.randomBytes(32).toString("hex");
  console.warn("JWT_SECRET not set: using a temporary secret. Sessions reset on restart.");
  console.warn("Set it in a .env file next to package.json (JWT_SECRET=your-long-random-text) and restart.");
}

const db = openDb(dbPath);
const app = createApp({
  db,
  jwtSecret,
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProd
});

const server = app.listen(port, () => console.log(`CloudSpend running on http://localhost:${port}`));

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
