"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Minimal .env loader (no dependency). Real environment variables always win.
 * Handles Windows line endings and a UTF-8 BOM. Empty values are ignored.
 */
function loadEnv(file = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(file)) return { loaded: false, file };

  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (value !== "" && process.env[key] === undefined) process.env[key] = value;
  }

  return { loaded: true, file };
}

module.exports = { loadEnv };
