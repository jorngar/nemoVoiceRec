// Packages the desktop app with electron-builder: `node scripts/package.mjs --mac|--win`.
// Machine-specific settings (e.g. ELECTRON_CACHE / ELECTRON_BUILDER_CACHE on another drive)
// can live in an untracked .env.local; see .env.example.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local"))
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1] in process.env))
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }

const targets = {
  "--mac": ["--mac", "dir"],
  "--win": ["--win", "nsis", "--x64", "--arm64"],
  "--win-dir": ["--win", "dir", "--x64"],
};
const target = targets[process.argv[2]];
if (!target) {
  console.error(`Usage: node scripts/package.mjs ${Object.keys(targets).join("|")}`);
  process.exit(1);
}
const result = spawnSync("npx", ["electron-builder", ...target], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
