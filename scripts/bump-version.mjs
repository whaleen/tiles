#!/usr/bin/env node
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const tauriConfPath = join(root, "src-tauri/tauri.conf.json");
const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri/Cargo.toml");

const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
const currentVersion = tauriConf.version;

let isTagged = false;
try {
  const out = execSync(`git tag -l "v${currentVersion}"`, { cwd: root }).toString().trim();
  isTagged = out.length > 0;
} catch {
  isTagged = false;
}

if (!isTagged) {
  console.log(`[bump-version] v${currentVersion} is unreleased — no bump`);
  process.exit(0);
}

const [major, minor, patch] = currentVersion.split(".").map(Number);
const next = `${major}.${minor}.${patch + 1}`;
console.log(`[bump-version] v${currentVersion} is tagged — bumping to v${next}`);

tauriConf.version = next;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/^version = "[^"]*"/m, `version = "${next}"`));

console.log(`[bump-version] Updated tauri.conf.json, package.json, Cargo.toml → v${next}`);
