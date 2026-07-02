#!/usr/bin/env node
// Forge — your own AI coding agent in the terminal.
// Chat REPL + tool loop (read/write/edit files, run shell commands) powered by the Claude API.

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const VERSION = "0.1.0";
const CONFIG_DIR = path.join(os.homedir(), ".forge");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

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
let MODEL = config.model || "claude-opus-4-8";
const YOLO = process.argv.includes("--yolo"); // skip confirmations

// ---------- readline ----------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (config.apiKey) return config.apiKey;
  console.log(paint(c.yellow, "\nNo API key found. Get one at https://platform.claude.com/"));
  const key = (await ask(paint(c.bold, "Paste your Anthropic API key: "))).trim();
  if (!key) { console.log(paint(c.red, "An API key is required.")); process.exit(1); }
  config.apiKey = key;
  saveConfig(config);
  console.log(paint(c.green, `Saved to ${CONFIG_FILE}\n`));
  return key;
}

// ---------- tools ----------
const tools = [
  {
    name: "bash",
    description: "Run a shell command in the current working directory and return stdout+stderr. Use for git, npm, builds, tests, listing files, searching, etc.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string", description: "The shell command to run" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file and return its contents with line numbers.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "File path (relative or absolute)" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content. Parent directories are created automatically.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string in a file with a new string. old_string must appear exactly once.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "list_dir",
    description: "List files and folders in a directory.",
    input_schema: {
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
  switch (name) {
    case "bash": {
      console.log(paint(c.cyan, `\n▶ bash: ${input.command}`));
      if (!(await confirm("run this command"))) return { text: "User declined to run this command.", error: true };
      try {
        const out = execSync(input.command, {
          encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { text: out.slice(0, 50_000) || "(no output)" };
      } catch (e) {
        const out = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
        return { text: out.slice(0, 50_000), error: true };
      }
    }
    case "read_file": {
      console.log(paint(c.cyan, `\n▶ read: ${input.path}`));
      try {
        const lines = fs.readFileSync(input.path, "utf8").split("\n");
        return { text: lines.map((l, i) => `${i + 1}\t${l}`).join("\n").slice(0, 100_000) };
      } catch (e) { return { text: String(e.message), error: true }; }
    }
    case "write_file": {
      console.log(paint(c.cyan, `\n▶ write: ${input.path} (${input.content.length} chars)`));
      if (!(await confirm(`write ${input.path}`))) return { text: "User declined the write.", error: true };
      try {
        fs.mkdirSync(path.dirname(path.resolve(input.path)), { recursive: true });
        fs.writeFileSync(input.path, input.content);
        return { text: `Wrote ${input.path}` };
      } catch (e) { return { text: String(e.message), error: true }; }
    }
    case "edit_file": {
      console.log(paint(c.cyan, `\n▶ edit: ${input.path}`));
      if (!(await confirm(`edit ${input.path}`))) return { text: "User declined the edit.", error: true };
      try {
        const src = fs.readFileSync(input.path, "utf8");
        const count = src.split(input.old_string).length - 1;
        if (count === 0) return { text: "old_string not found in file.", error: true };
        if (count > 1) return { text: `old_string appears ${count} times — make it unique.`, error: true };
        fs.writeFileSync(input.path, src.replace(input.old_string, input.new_string));
        return { text: `Edited ${input.path}` };
      } catch (e) { return { text: String(e.message), error: true }; }
    }
    case "list_dir": {
      const dir = input.path || ".";
      console.log(paint(c.cyan, `\n▶ ls: ${dir}`));
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
        return { text: entries.join("\n") || "(empty)" };
      } catch (e) { return { text: String(e.message), error: true }; }
    }
    default:
      return { text: `Unknown tool: ${name}`, error: true };
  }
}

// ---------- system prompt ----------
const SYSTEM = `You are Forge, an AI coding agent running in the user's terminal (cwd: ${process.cwd()}, OS: ${os.platform()}).
You help with software engineering: exploring codebases, writing and editing files, running commands, debugging, and answering questions.
Use the tools to inspect the project before making changes. Prefer edit_file for small changes and write_file for new files.
Keep responses concise and terminal-friendly (no heavy markdown tables). When you finish a task, briefly summarize what you did.`;

// ---------- agent loop ----------
async function agentTurn(client, messages) {
  while (true) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });

    let printedAny = false;
    stream.on("text", (delta) => {
      if (!printedAny) { process.stdout.write("\n" + paint(c.orange, "● ") ); printedAny = true; }
      process.stdout.write(delta);
    });

    const message = await stream.finalMessage();
    if (printedAny) process.stdout.write("\n");
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;
    if (message.stop_reason !== "tool_use") return;

    const toolUses = message.content.filter((b) => b.type === "tool_use");
    const results = [];
    for (const tu of toolUses) {
      const { text, error } = await runTool(tu.name, tu.input);
      if (!error) {
        const preview = text.split("\n").slice(0, 5).join("\n");
        console.log(paint(c.gray, preview.length < text.length ? preview + "\n  …" : preview));
      } else {
        console.log(paint(c.red, "  " + text.split("\n")[0]));
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: text, ...(error ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
}

// ---------- REPL ----------
function banner() {
  console.log(paint(c.orange, `
  ╔═╗╔═╗╦═╗╔═╗╔═╗
  ╠╣ ║ ║╠╦╝║ ╦║╣
  ╚  ╚═╝╩╚═╚═╝╚═╝  v${VERSION}`));
  console.log(paint(c.gray, `  model: ${MODEL} · cwd: ${process.cwd()}`));
  console.log(paint(c.gray, `  /help for commands · ctrl+c to quit${YOLO ? " · YOLO MODE (no confirmations)" : ""}\n`));
}

function help() {
  console.log(paint(c.gray, `
  /help          show this help
  /clear         clear conversation history
  /model <id>    switch model (current: ${MODEL})
  /cwd <path>    change working directory
  /exit          quit
  anything else is sent to the agent.
`));
}

async function main() {
  banner();
  const client = new Anthropic({ apiKey: await getApiKey() });
  let messages = [];

  while (true) {
    const input = (await ask(paint(c.bold + c.cyan, "forge> "))).trim();
    if (!input) continue;

    if (input === "/exit" || input === "/quit") break;
    if (input === "/help") { help(); continue; }
    if (input === "/clear") { messages = []; console.log(paint(c.gray, "history cleared\n")); continue; }
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

    messages.push({ role: "user", content: input });
    try {
      await agentTurn(client, messages);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        console.log(paint(c.red, "\nInvalid API key. Delete " + CONFIG_FILE + " and restart to re-enter it."));
      } else if (e instanceof Anthropic.RateLimitError) {
        console.log(paint(c.red, "\nRate limited — wait a moment and try again."));
      } else if (e instanceof Anthropic.APIError) {
        console.log(paint(c.red, `\nAPI error ${e.status}: ${e.message}`));
      } else {
        console.log(paint(c.red, `\nError: ${e.message}`));
      }
      // drop the failed turn's trailing user message so history stays valid
      if (messages.at(-1)?.role === "user") messages.pop();
    }
    console.log();
  }
  rl.close();
  console.log(paint(c.gray, "bye 👋"));
}

main();
