#!/usr/bin/env node
// Forge — your own AI coding agent in the terminal (full-screen TUI, Google Gemini free tier).

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const VERSION = "0.3.0";
const CONFIG_DIR = path.join(os.homedir(), ".forge");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ---------- colors ----------
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  orange: "\x1b[38;5;208m", cyan: "\x1b[36m", green: "\x1b[32m",
  yellow: "\x1b[33m", red: "\x1b[31m", gray: "\x1b[90m", blue: "\x1b[38;5;39m",
};
const paint = (color, s) => `${color}${s}${c.reset}`;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---------- terminal helpers ----------
const cols = () => process.stdout.columns || 80;
const BOXW = () => Math.min(cols() - 2, 84);

function wrap(text, w) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    if (raw === "") { out.push(""); continue; }
    let line = "";
    for (const word of raw.split(" ")) {
      if (line && stripAnsi(line + " " + word).length > w) { out.push(line); line = word; }
      else line = line ? line + " " + word : word;
    }
    if (line || out.length === 0) out.push(line);
  }
  return out;
}

// rounded panel
function panel(lines, color = c.gray) {
  const w = BOXW();
  const bar = (ch1, mid, ch2) => paint(color, ch1 + mid.repeat(w) + ch2);
  console.log(bar("╭", "─", "╮"));
  for (const raw of lines) {
    for (const l of wrap(raw, w - 2)) {
      const pad = " ".repeat(Math.max(0, w - 2 - stripAnsi(l).length));
      console.log(paint(color, "│") + " " + l + pad + " " + paint(color, "│"));
    }
  }
  console.log(bar("╰", "─", "╯"));
}

function enterFullscreen() {
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H"); // alt buffer + clear + home
}
function exitFullscreen() {
  process.stdout.write("\x1b[?25h\x1b[?1049l"); // show cursor + leave alt buffer
}

// spinner while the model is thinking
function spinner(label) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  process.stdout.write("\x1b[?25l");
  const t = setInterval(() => {
    process.stdout.write("\r" + paint(c.orange, frames[i++ % frames.length]) + " " + paint(c.gray, label));
  }, 80);
  return () => { clearInterval(t); process.stdout.write("\r\x1b[K\x1b[?25h"); };
}

// ---------- config ----------
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

const config = loadConfig();
let MODEL = config.model || "gemini-2.5-flash";
const YOLO = process.argv.includes("--yolo");

// ---------- readline ----------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let closed = false;
rl.on("close", () => { closed = true; });
const ask = (q) => new Promise((res) => { if (closed) return res("/exit"); rl.question(q, res); });

async function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  if (config.geminiKey) return config.geminiKey;
  panel([paint(c.yellow, "No API key found."), "Get a FREE one at https://aistudio.google.com/apikey"], c.yellow);
  const key = (await ask("\n" + paint(c.bold, "Paste your Google AI (Gemini) API key: "))).trim();
  if (!key) { console.log(paint(c.red, "An API key is required.")); process.exit(1); }
  config.geminiKey = key;
  saveConfig(config);
  console.log(paint(c.green, `Saved to ${CONFIG_FILE}`));
  return key;
}

// ---------- tools ----------
const tools = [
  { name: "bash", description: "Run a shell command in the current working directory and return stdout+stderr. Use for git, npm, builds, tests, listing files, searching, etc.",
    parameters: { type: "object", properties: { command: { type: "string", description: "The shell command to run" } }, required: ["command"] } },
  { name: "read_file", description: "Read a text file and return its contents with line numbers.",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path (relative or absolute)" } }, required: ["path"] } },
  { name: "write_file", description: "Create or overwrite a file with the given content. Parent directories are created automatically.",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path to write" }, content: { type: "string", description: "Full file contents" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace an exact string in a file with a new string. old_string must appear exactly once.",
    parameters: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string", description: "Exact text to find (unique)" }, new_string: { type: "string" } }, required: ["path", "old_string", "new_string"] } },
  { name: "list_dir", description: "List files and folders in a directory.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Directory path, defaults to cwd" } } } },
];

async function confirm(label) {
  if (YOLO) return true;
  const ans = (await ask(paint(c.yellow, `  allow? ${label} `) + paint(c.gray, "[y/N] "))).trim().toLowerCase();
  return ans === "y" || ans === "yes";
}

async function runTool(name, input) {
  input = input || {};
  switch (name) {
    case "bash": {
      console.log(paint(c.blue, `  ⏵ bash `) + paint(c.gray, input.command));
      if (!(await confirm("run this command"))) return "User declined to run this command.";
      try {
        return execSync(input.command, { encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).slice(0, 50_000) || "(no output)";
      } catch (e) { return [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").slice(0, 50_000); }
    }
    case "read_file": {
      console.log(paint(c.blue, `  ⏵ read `) + paint(c.gray, input.path));
      try { return fs.readFileSync(input.path, "utf8").split("\n").map((l, i) => `${i + 1}\t${l}`).join("\n").slice(0, 100_000); }
      catch (e) { return "Error: " + e.message; }
    }
    case "write_file": {
      console.log(paint(c.blue, `  ⏵ write `) + paint(c.gray, `${input.path} (${(input.content || "").length} chars)`));
      if (!(await confirm(`write ${input.path}`))) return "User declined the write.";
      try { fs.mkdirSync(path.dirname(path.resolve(input.path)), { recursive: true }); fs.writeFileSync(input.path, input.content ?? ""); return `Wrote ${input.path}`; }
      catch (e) { return "Error: " + e.message; }
    }
    case "edit_file": {
      console.log(paint(c.blue, `  ⏵ edit `) + paint(c.gray, input.path));
      if (!(await confirm(`edit ${input.path}`))) return "User declined the edit.";
      try {
        const src = fs.readFileSync(input.path, "utf8");
        const n = src.split(input.old_string).length - 1;
        if (n === 0) return "old_string not found in file.";
        if (n > 1) return `old_string appears ${n} times — make it unique.`;
        fs.writeFileSync(input.path, src.replace(input.old_string, input.new_string));
        return `Edited ${input.path}`;
      } catch (e) { return "Error: " + e.message; }
    }
    case "list_dir": {
      const dir = input.path || ".";
      console.log(paint(c.blue, `  ⏵ ls `) + paint(c.gray, dir));
      try { return fs.readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(empty)"; }
      catch (e) { return "Error: " + e.message; }
    }
    default: return `Unknown tool: ${name}`;
  }
}

// ---------- system prompt ----------
const SYSTEM = `You are Forge, an AI coding agent running in the user's terminal (cwd: ${process.cwd()}, OS: ${os.platform()}).
You help with software engineering: exploring codebases, writing and editing files, running commands, debugging, and answering questions.
Use the provided tools to inspect the project before making changes. Prefer edit_file for small changes and write_file for new files.
Keep responses concise and terminal-friendly. When you finish a task, briefly summarize what you did.`;

// ---------- Gemini ----------
function upperTypes(schema) {
  if (Array.isArray(schema)) return schema.map(upperTypes);
  if (schema && typeof schema === "object") {
    const out = {};
    for (const [k, v] of Object.entries(schema)) out[k] = (k === "type" && typeof v === "string") ? v.toUpperCase() : upperTypes(v);
    return out;
  }
  return schema;
}
const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parameters: upperTypes(t.parameters) }));

async function callGemini(apiKey, contents) {
  const url = `${API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations }] }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return (await res.json()).candidates?.[0]?.content?.parts || [];
}

function printAssistant(text) {
  const lines = wrap(text.trim(), BOXW() - 2);
  console.log(paint(c.orange, "● ") + (lines[0] || ""));
  for (const l of lines.slice(1)) console.log("  " + l);
}

// ---------- agent loop ----------
async function agentTurn(apiKey, contents) {
  while (true) {
    const stop = spinner("thinking…");
    let parts;
    try { parts = await callGemini(apiKey, contents); } finally { stop(); }
    contents.push({ role: "model", parts });

    const texts = parts.filter((p) => p.text).map((p) => p.text).join("");
    if (texts.trim()) { console.log(); printAssistant(texts); }

    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) return;

    const responseParts = [];
    for (const p of calls) {
      const result = await runTool(p.functionCall.name, p.functionCall.args);
      const preview = String(result).split("\n").slice(0, 4).join("\n");
      console.log(preview.split("\n").map((l) => paint(c.gray, "    " + l)).join("\n"));
      responseParts.push({ functionResponse: { name: p.functionCall.name, response: { result: String(result) } } });
    }
    contents.push({ role: "user", parts: responseParts });
  }
}

// ---------- UI ----------
function welcome() {
  console.log(paint(c.orange, `
   ▄████  ██████  ██▀███   ▄████ ▓█████
  ██▒     ██▒  ██▓██   ██ ██▒    ▓█   ▀
  ▓███▄   ██▒  ██▓██ ░▄█  ▓███▄  ▒███
  ▒   ██▒ ██▒  ██▓▀▀█▄    ▒   ██▒▒▓█  ▄
  ▒██████▒██████▓█   ▓██▒ ▒██████▒░▒████`) + paint(c.gray, `  v${VERSION}`));
  panel([
    paint(c.bold, "Welcome to Forge") + paint(c.gray, "  — your AI coding agent"),
    "",
    paint(c.gray, "model  ") + paint(c.cyan, MODEL) + paint(c.gray, "  (Gemini free tier)"),
    paint(c.gray, "cwd    ") + process.cwd(),
    "",
    paint(c.gray, "Type a request, or ") + paint(c.cyan, "/help") + paint(c.gray, " for commands.") + (YOLO ? paint(c.yellow, "   [YOLO]") : ""),
  ], c.orange);
  console.log();
}

function help() {
  panel([
    paint(c.cyan, "/help") + paint(c.gray, "          show this help"),
    paint(c.cyan, "/clear") + paint(c.gray, "         clear the screen & conversation"),
    paint(c.cyan, "/model <id>") + paint(c.gray, "    switch model (gemini-2.5-flash, gemini-2.5-pro)"),
    paint(c.cyan, "/cwd <path>") + paint(c.gray, "    change working directory"),
    paint(c.cyan, "/exit") + paint(c.gray, "          quit"),
  ], c.gray);
  console.log();
}

async function promptInput() {
  const w = BOXW();
  console.log(paint(c.gray, "╭" + "─".repeat(w) + "╮"));
  const line = await ask(paint(c.gray, "│ ") + paint(c.orange, "❯ "));
  console.log(paint(c.gray, "╰" + "─".repeat(w) + "╯"));
  return line.trim();
}

async function main() {
  enterFullscreen();
  process.on("exit", exitFullscreen);
  process.on("SIGINT", () => { exitFullscreen(); process.exit(0); });

  welcome();
  const apiKey = await getApiKey();
  let contents = [];

  while (true) {
    const input = await promptInput();
    if (!input) continue;
    if (input === "/exit" || input === "/quit") break;
    if (input === "/help") { help(); continue; }
    if (input === "/clear") { contents = []; process.stdout.write("\x1b[2J\x1b[H"); welcome(); continue; }
    if (input.startsWith("/model")) {
      const m = input.split(/\s+/)[1];
      if (m) { MODEL = m; config.model = m; saveConfig(config); }
      console.log(paint(c.gray, `model: ${MODEL}\n`)); continue;
    }
    if (input.startsWith("/cwd")) {
      const p = input.split(/\s+/).slice(1).join(" ");
      if (p) { try { process.chdir(p); } catch (e) { console.log(paint(c.red, e.message)); } }
      console.log(paint(c.gray, `cwd: ${process.cwd()}\n`)); continue;
    }

    contents.push({ role: "user", parts: [{ text: input }] });
    try {
      await agentTurn(apiKey, contents);
    } catch (e) {
      if (e.status === 400 && /API key/i.test(e.message)) console.log(paint(c.red, `\nInvalid API key. Delete ${CONFIG_FILE} and restart.`));
      else if (e.status === 429) console.log(paint(c.red, "\nRate limited (free-tier quota) — wait a moment or /model gemini-2.5-flash."));
      else console.log(paint(c.red, `\nError: ${e.message}`));
      if (contents.at(-1)?.role === "user") contents.pop();
    }
    console.log();
  }
  rl.close();
  exitFullscreen();
  console.log(paint(c.gray, "bye 👋"));
}

main();
