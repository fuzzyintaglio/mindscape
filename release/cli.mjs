import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// cli/mindscape.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, rmSync } from "node:fs";
import { join as join4, resolve as resolve3 } from "node:path";

// scripts/source-hash.mjs
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = fileURLToPath(new URL("..", import.meta.url));
var INPUTS = ["core", "server", "cli", "ui/src", "ui/index.html", "package.json", "package-lock.json", "vite.config.ts", "scripts/release.mjs", "scripts/source-hash.mjs"];
function files(p) {
  const full = join(ROOT, p);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).flatMap((e) => files(join(p, e.name)));
}
function sourceHash() {
  const hash = createHash("sha256");
  for (const f of INPUTS.flatMap(files).sort()) {
    hash.update(relative(ROOT, f).split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(f));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
if (process.argv[1]?.endsWith("source-hash.mjs")) console.log(sourceHash());

// core/settings.ts
import { existsSync, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join2, resolve } from "node:path";
var DEFAULT_PORT = 4317;
var DEFAULT_VAULT_PATH = join2(homedir(), "Desktop", "Mindscape Vault");
function settingsDir() {
  return process.env.MINDSCAPE_SETTINGS_DIR ?? join2(homedir(), "Library", "Application Support", "Mindscape");
}
function settingsFile() {
  return join2(settingsDir(), "settings.json");
}
function pidFile() {
  return join2(settingsDir(), "server.pid");
}
function expandHome(p) {
  return p === "~" || p.startsWith("~/") ? join2(homedir(), p.slice(1)) : p;
}
function loadSettings() {
  let stored = {};
  const file = settingsFile();
  if (existsSync(file)) {
    try {
      stored = JSON.parse(readFileSync2(file, "utf8"));
    } catch {
      throw new Error(`Settings file is not valid JSON: ${file}`);
    }
  }
  const vaultPath = process.env.MINDSCAPE_VAULT ?? stored.vaultPath ?? DEFAULT_VAULT_PATH;
  const port = Number(process.env.MINDSCAPE_PORT ?? stored.port ?? DEFAULT_PORT);
  return { vaultPath: resolve(expandHome(vaultPath)), port };
}
function saveSettings(patch) {
  const file = settingsFile();
  let stored = {};
  if (existsSync(file)) stored = JSON.parse(readFileSync2(file, "utf8"));
  const next = { ...stored, ...patch };
  if (next.vaultPath) next.vaultPath = resolve(expandHome(next.vaultPath));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return loadSettings();
}

// core/vault.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync as readdirSync2, realpathSync, statSync as statSync2 } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join3, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var REPO_ROOT = resolve2(dirname2(fileURLToPath2(import.meta.url)), "..");
var VAULT_FOLDERS = [
  "tasks",
  "archive",
  "reference",
  "daily",
  "reviews",
  "intake",
  "templates",
  ".trash",
  ".mindscape"
];
function realish(p) {
  let current = resolve2(p);
  const rest2 = [];
  while (!existsSync2(current)) {
    const parent = dirname2(current);
    if (parent === current) break;
    rest2.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  return join3(realpathSync(current), ...rest2);
}
function isInside(child, parent) {
  const rel = relative2(parent, child);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function assertVaultOutsideRepo(vaultPath, repoRoot = REPO_ROOT) {
  const vault = realish(vaultPath);
  const repo = realish(repoRoot);
  if (isInside(vault, repo)) {
    throw new Error(
      `Refusing to use a vault inside the code repo.
  vault: ${vault}
  repo:  ${repo}
Move the vault elsewhere, e.g. ~/Desktop/Mindscape Vault, and run: npm run setup -- --vault "<path>"`
    );
  }
  if (isInside(repo, vault)) {
    throw new Error(`Refusing to use a vault that contains the code repo.
  vault: ${vault}
  repo:  ${repo}`);
  }
}
function ensureVault(vaultPath) {
  const created = [];
  if (!existsSync2(vaultPath)) {
    mkdirSync2(vaultPath, { recursive: true });
    created.push(".");
  }
  for (const folder of VAULT_FOLDERS) {
    const p = join3(vaultPath, folder);
    if (!existsSync2(p)) {
      mkdirSync2(p, { recursive: true });
      created.push(folder);
    }
  }
  return { created };
}
function listVaultFiles(vaultPath) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync2(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join3(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const s = statSync2(full);
        out.push({
          path: relative2(vaultPath, full).split(sep2).join("/"),
          size: s.size,
          modified: s.mtime.toISOString()
        });
      }
    }
  };
  if (existsSync2(vaultPath)) walk(vaultPath);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// core/version.ts
var APP_VERSION = true ? "0.0.1" : JSON.parse(readFileSync(join(REPO_ROOT2, "package.json"), "utf8")).version;
var MIN_NODE_MAJOR = 20;
function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

// cli/mindscape.ts
var USAGE = `mindscape ${APP_VERSION}

Usage:
  mindscape setup [--vault <path>]   Save this machine's vault location and create the vault folders
  mindscape doctor                   Check Node, settings, vault, and whether the server is running
  mindscape stop                     Stop the background server
`;
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : void 0;
}
async function serverHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
function setup(args) {
  const vault = argValue(args, "--vault");
  const vaultPath = vault ? resolve3(expandHome(vault)) : loadSettings().vaultPath;
  assertVaultOutsideRepo(vaultPath);
  const settings = saveSettings({ vaultPath });
  const { created } = ensureVault(settings.vaultPath);
  console.log(`Settings: ${settingsFile()}`);
  console.log(`Vault:    ${settings.vaultPath}`);
  console.log(created.length ? `Created:  ${created.join(", ")}` : "Vault folders already exist.");
}
async function doctor() {
  let problems = 0;
  const line = (ok, label, detail) => {
    if (!ok) problems++;
    console.log(`${ok ? "\u2713" : "\u2717"} ${label.padEnd(10)} ${detail}`);
  };
  line(nodeMajor() >= MIN_NODE_MAJOR, "Node", `${process.version} (need ${MIN_NODE_MAJOR}+)`);
  line(true, "Repo", REPO_ROOT);
  const buildFile = join4(REPO_ROOT, "release", "BUILD.json");
  if (existsSync3(buildFile)) {
    const build = JSON.parse(readFileSync3(buildFile, "utf8"));
    const current = sourceHash();
    line(
      build.source === current,
      "Release",
      `v${build.version}, built ${new Date(build.builtAt).toLocaleString()}` + (build.source === current ? " (matches the code)" : ` \u2014 STALE: code changed since this build; run: npm run release`)
    );
  } else {
    line(false, "Release", "release/ is missing \u2014 run: git pull (or npm run release on the dev Mac)");
  }
  line(existsSync3(settingsFile()), "Settings", existsSync3(settingsFile()) ? settingsFile() : `missing \u2014 run: npm run setup`);
  const { vaultPath, port } = loadSettings();
  try {
    assertVaultOutsideRepo(vaultPath);
    line(existsSync3(vaultPath), "Vault", existsSync3(vaultPath) ? `${vaultPath} (${listVaultFiles(vaultPath).length} files)` : `${vaultPath} \u2014 not created yet`);
  } catch (err) {
    line(false, "Vault", err.message);
  }
  const health = await serverHealth(port);
  console.log(`${health ? "\u2713" : "\xB7"} ${"Server".padEnd(10)} ${health ? `running on 127.0.0.1:${port} (pid ${health.pid})` : "not running"}`);
  process.exitCode = problems ? 1 : 0;
}
async function stop() {
  const { port } = loadSettings();
  const health = await serverHealth(port);
  const file = pidFile();
  const pid = health?.pid ?? (existsSync3(file) ? Number(readFileSync3(file, "utf8")) : void 0);
  if (!health || !pid) {
    console.log("Mindscape is not running.");
    rmSync(file, { force: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped Mindscape (pid ${pid}).`);
  } catch {
    console.log("Mindscape is not running.");
    rmSync(file, { force: true });
  }
}
var [command, ...rest] = process.argv.slice(2);
try {
  if (command === "setup") setup(rest);
  else if (command === "doctor") await doctor();
  else if (command === "stop") await stop();
  else {
    console.log(USAGE);
    if (command && command !== "help" && command !== "--help") process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
