# Forge

Your own AI coding agent in the terminal — same concept as Claude Code / OpenCode, but yours.

```
curl -fsSL https://raw.githubusercontent.com/johnjones20902-lab/forge-cli/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/johnjones20902-lab/forge-cli/main/install.ps1 | iex
```

Then run `forge` — you'll be asked for your [Anthropic API key](https://platform.claude.com/) on first launch (saved to `~/.forge/config.json`).

## What it can do

- Chat with a coding agent that can **read, write, and edit files** and **run shell commands** in your project
- Streaming responses, adaptive thinking, prompt caching
- Asks for confirmation before running commands or writing files (`forge --yolo` to skip)

## Commands

| Command | Action |
|---|---|
| `/help` | show help |
| `/clear` | reset the conversation |
| `/model <id>` | switch model (default `claude-opus-4-8`) |
| `/cwd <path>` | change working directory |
| `/exit` | quit |

## Local development

```
cd forge-cli
npm install
npm link      # makes the `forge` command available globally
forge
```

## Hosting the one-line installer

1. The raw GitHub URL works as-is:
   `curl -fsSL https://raw.githubusercontent.com/johnjones20902-lab/forge-cli/main/install.sh | bash`
2. For a short URL like `https://forge.yourdomain.com/install`, put the script behind any static host (Cloudflare Pages, Vercel, GitHub Pages) or add a redirect rule pointing at the raw GitHub URL.
