# pi-extensions

Personal extensions for [pi-coding-agent](https://github.com/badlogic/pi-mono).

## Extensions

- 📦 **[prompt-stash](prompt-stash.ts)** — Git-stash-like stack for editor prompts. `Ctrl+Shift+S` to push (editor has text) or pop (editor empty). Session-scoped.
- ⚡ **[tokens-per-second](tokens-per-second.ts)** — Displays output tokens/second in the status line during streaming.
- 🗜️ **[compact-tool-output](compact-tool-output.ts)** — Shows only the file name for `read`, keeps `write` to a filename-only header, and hides `bash` output until expanded.
- 🚀 **[codex-fast](codex-fast.ts)** — Adds `/fast [on|off|status]` for `openai/gpt-5.4`, `openai-codex/gpt-5.4`, `openai/gpt-5.5`, and `openai-codex/gpt-5.5`, injecting `service_tier: "priority"` when enabled.
