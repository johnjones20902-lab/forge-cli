#!/usr/bin/env node
// Forge — your own AI coding agent in the terminal.
// Chat REPL + tool loop (read/write/edit files, run shell commands) powered by Google Gemini (free tier).

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const VERSION = "0.2.0";
const CONFIG_DIR = path.join(os.homedir(), ".forge");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ---------- colors ----------
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  orange: "\x1b[38;5;208m", cyan: "\x1b[36m", green: "\x1b[32m",
  yellow: "\x1b[33m", red: "\x1b[31m", gray: "\x1b[90m",
};
const paint = (color, s) => `${color}${s}${c.reset}`;

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
const YOLO = process.argv.includes("--yolo"); // skip confirmations

// ---------- readline ----------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let closed = false;
rl.on("close", () => { closed = true; });
const ask = (q) => new Promise((res) => {
  if (closed) return res("/exit");
  rl.question(q, res);
});

async function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  if (config.geminiKey) return config.geminiKey;
  console.log(paint(c.yellow, "\nNo API key found. Get a FREE one at https://aistudio.google.com/apikey"));
  const key = (await ask(paint(c.bold, "Paste your Google AI (Gemini) API key: "))).trim();
  if (!key) { console.log(paint(c.red, "An API key is required.")); process.exit(1); }
  config.geminiKey = key;
  saveConfig(config);
  console.log(paint(c.green, `Saved to ${CONFIG_FILE}\n`));
  return key;
}

// ---------- tools ----------
const tools = [
  {
    name: "bash",
    description: "Run a shell command in the current working directory and return stdout+stderr. Use for git, npm, builds, tests, listing files, searching, etc.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "The shell command to run" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file and return its contents with line numbers.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File path (relative or absolute)" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content. Parent directories are created automatically.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string in a file with a new string. old_string must appear exactly once.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to edit" },
        old_string: { type: "string", description: "Exact text to find (must be unique)" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "list_dir",
    description: "List files and folders in a directory.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path, defaults to cwd" } },
    },
  },
];

async function confirm(label) {
  if (YOLO) return true;
  const ans = (await ask(paint(c.yellow, `  Allow? ${label} [y/N] `))).trim().toLowerCase();
  return ans === "y" || ans === "yes";
}

async function runTool(name, input) {
  input = input || {};
  switch (name) {
    case "bash": {
      console.log(paint(c.cyan, `\n▶ bash: ${input.command}`));
      if (!(await confirm("run this command"))) return "User declined to run this command.";
      try {
        const out = execSync(input.command, {
          encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return out.slice(0, 50_000) || "(no output)";
      } catch (e) {
        return [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").slice(0, 50_000);
      }
    }
    case "read_file": {
      console.log(paint(c.cyan, `\n▶ read: ${input.path}`));
      try {
        const lines = fs.readFileSync(input.path, "utf8").split("\n");
        return lines.map((l, i) => `${i + 1}\t${l}`).join("\n").slice(0, 100_000);
      } catch (e) { return "Error: " + e.message; }
    }
    case "write_file": {
      console.log(paint(c.cyan, `\n▶ write: ${input.path} (${(input.content || "").length} chars)`));
      if (!(await confirm(`write ${input.path}`))) return "User declined the write.";
      try {
        fs.mkdirSync(path.dirname(path.resolve(input.path)), { recursive: true });
        fs.writeFileSync(input.path, input.content ?? "");
        return `Wrote ${input.path}`;
      } catch (e) { return "Error: " + e.message; }
    }
    case "edit_file": {
      console.log(paint(c.cyan, `\n▶ edit: ${input.path}`));
      if (!(await confirm(`edit ${input.path}`))) return "User declined the edit.";
      try {
        const src = fs.readFileSync(input.path, "utf8");
        const count = src.split(input.old_string).length - 1;
        if (count === 0) return "old_string not found in file.";
        if (count > 1) return `old_string appears ${count} times — make it unique.`;
        fs.writeFileSync(input.path, src.replace(input.old_string, input.new_string));
        return `Edited ${input.path}`;
      } catch (e) { return "Error: " + e.message; }
    }
    case "list_dir": {
      const dir = input.path || ".";
      console.log(paint(c.cyan, `\n▶ ls: ${dir}`));
      try {
        return fs.readdirSync(dir, { withFileTypes: true })
          .map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(empty)";
      } catch (e) { return "Error: " + e.message; }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ---------- system prompt ----------
const SYSTEM = `You are Forge, an AI coding agent running in the user's terminal (cwd: ${process.cwd()}, OS: ${os.platform()}).
You help with software engineering: exploring codebases, writing and editing files, running commands, debugging, and answering questions.
Use the provided tools to inspect the project before making changes. Prefer edit_file for small changes and write_file for new files.
Keep responses concise and terminal-friendly. When you finish a task, briefly summarize what you did.`;

// ---------- Gemini API ----------
// Gemini function declarations want OpenAPI-style types; uppercase them.
function upperTypes(schema) {
  if (Array.isArray(schema)) return schema.map(upperTypes);
  if (schema && typeof schema === "object") {
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "type" && typeof v === "string") out[k] = v.toUpperCase();
      else out[k] = upperTypes(v);
    }
    return out;
  }
  return schema;
}
const functionDeclarations = tools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: upperTypes(t.parameters),
}));

async function callGemini(apiKey, contents) {
  const url = `${API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    tools: [{ functionDeclarations }],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  return cand?.content?.parts || [];
}

// ---------- agent loop ----------
async function agentTurn(apiKey, contents) {
  while (true) {
    const parts = await callGemini(apiKey, contents);
    contents.push({ role: "model", parts });

    const calls = parts.filter((p) => p.functionCall);
    const texts = parts.filter((p) => p.text).map((p) => p.text).join("");
    if (texts.trim()) console.log("\n" + paint(c.orange, "● ") + texts.trim());

    if (calls.length === 0) return;

    const responseParts = [];
    for (const p of calls) {
      const result = await runTool(p.functionCall.name, p.functionCall.args);
      const preview = String(result).split("\n").slice(0, 5).join("\n");
      console.log(paint(c.gray, preview));
      responseParts.push({
        functionResponse: { name: p.functionCall.name, response: { result: String(result) } },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }
}

// ---------- REPL ----------
function banner() {
  console.log(paint(c.orange, `
  ╔═╗╔═╗╦═╗╔═╗╔═╗
  ╠╣ ║ ║╠╦╝║ ╦║╣
  ╚  ╚═╝╩╚═╚═╝╚═╝  v${VERSION}`));
  console.log(paint(c.gray, `  model: ${MODEL} (Gemini) · cwd: ${process.cwd()}`));
  console.log(paint(c.gray, `  /help for commands · ctrl+c to quit${YOLO ? " · YOLO MODE" : ""}\n`));
}

function help() {
  console.log(paint(c.gray, `
  /help          show this help
  /clear         clear conversation history
  /model <id>    switch model (current: ${MODEL}; try gemini-2.5-flash, gemini-2.0-flash)
  /cwd <path>    change working directory
  /exit          quit
  anything else is sent to the agent.
`));
}

async function main() {
  banner();
  const apiKey = await getApiKey();
  let contents = [];

  while (true) {
    const input = (await ask(paint(c.bold + c.cyan, "forge> "))).trim();
    if (!input) continue;
    if (input === "/exit" || input === "/quit") break;
    if (input === "/help") { help(); continue; }
    if (input === "/clear") { contents = []; console.log(paint(c.gray, "history cleared\n")); continue; }
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
      if (e.status === 400 && /API key/i.test(e.message)) {
        console.log(paint(c.red, `\nInvalid API key. Delete ${CONFIG_FILE} and restart to re-enter it.`));
      } else if (e.status === 429) {
        console.log(paint(c.red, "\nRate limited (free-tier quota) — wait a moment and try again."));
      } else {
        console.log(paint(c.red, `\nError: ${e.message}`));
      }
      if (contents.at(-1)?.role === "user") contents.pop();
    }
    console.log();
  }
  rl.close();
  console.log(paint(c.gray, "bye 👋"));
}

main();
