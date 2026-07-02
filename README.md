# Forge

Your own AI coding agent in the terminal — same concept as Claude Code / OpenCode, but yours. Powered by **Google Gemini's free tier**, so there's no bill.

## Install

Works in Command Prompt, PowerShell, or any terminal (needs [Node.js](https://nodejs.org) 18+):

```
npm install -g github:johnjones20902-lab/forge-cli
```

Once the npm package clears review, this also works:

```
npm install -g @scousedeveloper123/forge-code
```

Then run:

```
forge
```

On first launch it asks for a **free** Google AI (Gemini) API key — get one at https://aistudio.google.com/apikey (no billing required). It's saved to `~/.forge/config.json`, so you're only asked once.

## What it can do

- Chat with a coding agent that can **read, write, and edit files** and **run shell commands** in your project
- Powered by Gemini (`gemini-2.5-flash` by default) — free
- Asks for confirmation before running commands or writing files (`forge --yolo` to skip)

## Commands

| Command | Action |
|---|---|
| `/help` | show help |
| `/clear` | reset the conversation |
| `/model <id>` | switch model (e.g. `gemini-2.5-flash`, `gemini-2.5-pro`) |
| `/cwd <path>` | change working directory |
| `/exit` | quit |

## Local development

```
git clone https://github.com/johnjones20902-lab/forge-cli
cd forge-cli
npm link      # makes the `forge` command available globally
forge
```

No dependencies — pure Node.js `fetch`.
