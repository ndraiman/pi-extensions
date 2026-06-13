import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DynamicBorder,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  Input,
  Key,
  KeybindingsManager,
  matchesKey,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

const SYSTEM_PROMPT = `Generate a short kebab-case name (2-4 words) that captures the main topic of this conversation. Use lowercase words separated by hyphens. Return only JSON with a "name" field. Examples: fix-login-bug, add-auth-feature, refactor-api-client, debug-test-failures.`;
const CONFIG_PATH = join(getAgentDir(), "auto-name.json");

interface AutoNameConfig {
  model?: string;
}

interface ModelItem {
  value: string;
  provider: string;
  id: string;
}

interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

function loadConfig(): AutoNameConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AutoNameConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: AutoNameConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function getModelArg(config: AutoNameConfig): string[] {
  return config.model ? ["--model", config.model] : [];
}

function extractText(
  content: string | (TextContent | ImageContent)[]
): string | undefined {
  if (typeof content === "string") return content;
  const block = content.find((c): c is TextContent => c.type === "text");
  return block?.text;
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();
  const bare = text.match(/\{[\s\S]*\}/);
  if (bare) return bare[0].trim();
  return null;
}

function buildContext(entries: any[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    if (!msg.content) continue;
    const text = extractText(msg.content);
    if (!text) continue;
    if (msg.role === "user") lines.push(`User: ${text}`);
    else lines.push(`Assistant: ${text.slice(0, 200)}`);
  }
  return lines.join("\n");
}

function setName(pi: ExtensionAPI, ctx: ExtensionContext, name: string) {
  pi.setSessionName(name);
  ctx.ui.setTitle(`pi - ${name}`);
  ctx.ui.notify(`Named: ${name}`, "info");
}

async function generateTitle(
  context: string,
  pi: ExtensionAPI,
  config: AutoNameConfig
): Promise<{ name: string | null; error?: string }> {
  const args = [
    "--no-extensions",
    "--no-tools",
    "--no-skills",
    "--no-context-files",
    "--system-prompt",
    SYSTEM_PROMPT,
    "--mode",
    "json",
    ...getModelArg(config),
    "-p",
    context,
  ];

  try {
    const result = await pi.exec("pi", args, { cwd: process.cwd() });

    for (const line of result.stdout.split("\n").filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (
          event.type === "message_end" &&
          event.message?.role === "assistant"
        ) {
          const textBlock = event.message.content?.find(
            (c: any) => c.type === "text"
          )?.text;
          if (!textBlock) continue;

          const json = extractJson(textBlock);
          if (!json) continue;
          const parsed = JSON.parse(json);
          return { name: parsed.name || null };
        }
      } catch {
        continue;
      }
    }

    return { name: null, error: "No valid title in output" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name: null, error: message };
  }
}

class ModelPickerComponent extends Container {
  private items: ModelItem[];
  private filteredItems: ModelItem[] = [];
  private selectedIndex = 0;
  private searchInput: Input;
  private listContainer: Container;
  private keybindings: KeybindingsManager;
  private maxVisible = 10;
  private onSelect: (value: string) => void;
  private onCancel: () => void;

  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    items: ModelItem[],
    keybindings: KeybindingsManager,
    onSelect: (value: string) => void,
    onCancel: () => void
  ) {
    super();
    this.items = items;
    this.filteredItems = items;
    this.keybindings = keybindings;
    this.onSelect = onSelect;
    this.onCancel = onCancel;

    this.addChild(new DynamicBorder((s: string) => s));
    this.addChild(new Spacer(1));
    this.addChild(new Text("Select auto-name model", 0, 0));
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));
    this.addChild(
      new Text("↑↓ navigate · enter select · esc cancel · type to filter", 0, 0)
    );
    this.addChild(new DynamicBorder((s: string) => s));

    this.updateList();
  }

  refresh() {
    const query = this.searchInput.getValue();
    this.filteredItems = query
      ? fuzzyFilter(this.items, query, (i) => `${i.provider} ${i.id}`)
      : this.items;
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredItems.length - 1)
    );
    this.updateList();
  }

  updateList() {
    this.listContainer.clear();

    if (this.filteredItems.length === 0) {
      this.listContainer.addChild(new Text("  No matching models", 0, 0));
      return;
    }

    const start = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.filteredItems.length - this.maxVisible
      )
    );
    const end = Math.min(start + this.maxVisible, this.filteredItems.length);

    for (let i = start; i < end; i++) {
      const item = this.filteredItems[i];
      const prefix = i === this.selectedIndex ? "> " : "  ";
      this.listContainer.addChild(
        new Text(`${prefix}${item.provider}/${item.id}`, 0, 0)
      );
    }

    if (start > 0 || end < this.filteredItems.length) {
      this.listContainer.addChild(
        new Text(`  (${this.selectedIndex + 1}/${this.filteredItems.length})`, 0, 0)
      );
    }
  }

  handleInput(data: string) {
    const kb = this.keybindings;

    if (kb.matches(data, "tui.select.up")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filteredItems.length - 1
          : this.selectedIndex - 1;
      this.updateList();
      return;
    }

    if (kb.matches(data, "tui.select.down")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredItems.length - 1
          ? 0
          : this.selectedIndex + 1;
      this.updateList();
      return;
    }

    if (kb.matches(data, "tui.select.confirm")) {
      const item = this.filteredItems[this.selectedIndex];
      if (item) this.onSelect(item.value);
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.onCancel();
      return;
    }

    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.searchInput.getValue()) {
        this.searchInput.setValue("");
        this.refresh();
      } else {
        this.onCancel();
      }
      return;
    }

    this.searchInput.handleInput(data);
    this.refresh();
  }
}

export default function (pi: ExtensionAPI) {
  let config = loadConfig();

  // Auto-name on first assistant response
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    if (pi.getSessionName()) return;

    const entries = ctx.sessionManager.getEntries();
    const context = buildContext(entries);
    if (!context) return;

    if (ctx.hasUI) ctx.ui.setStatus("auto-name", "Auto-naming session...");
    const result = await generateTitle(context, pi, config);
    if (ctx.hasUI) ctx.ui.setStatus("auto-name", undefined);
    if (result.name) {
      setName(pi, ctx, result.name);
    } else if (result.error && ctx.hasUI) {
      ctx.ui.notify(`Auto-name failed: ${result.error}`, "error");
    }
  });

  // Manual /rename command
  pi.registerCommand("rename", {
    description: "Rename the current session (usage: /rename [name])",
    handler: async (args, ctx) => {
      const name = args.trim();

      if (name) {
        setName(pi, ctx, name);
        return;
      }

      const entries = ctx.sessionManager.getEntries();
      const context = buildContext(entries);
      if (!context) {
        ctx.ui.notify("No conversation context to generate a name from", "warning");
        return;
      }

      if (ctx.hasUI) ctx.ui.setStatus("auto-name", "Generating name...");
      const result = await generateTitle(context, pi, config);
      if (ctx.hasUI) ctx.ui.setStatus("auto-name", undefined);
      if (result.name) {
        setName(pi, ctx, result.name);
      } else if (ctx.hasUI) {
        ctx.ui.notify(`Could not generate a name: ${result.error || "unknown error"}`, "error");
      }
    },
  });

  // Model picker command
  pi.registerCommand("auto-name-model", {
    description:
      "Set the model for auto-naming (usage: /auto-name-model <provider>/<model>)",
    handler: async (args, ctx) => {
      const models = ctx.modelRegistry.getAvailable();
      const items: ModelItem[] = models.map((m) => ({
        value: `${m.provider}/${m.id}`,
        provider: m.provider,
        id: m.id,
      }));

      if (args.trim()) {
        const selected = args.trim();
        if (!items.some((i) => i.value === selected)) {
          ctx.ui.notify(`Unknown model: ${selected}`, "error");
          return;
        }
        config = { model: selected };
        saveConfig(config);
        ctx.ui.notify(`Auto-name model set to ${selected}`, "info");
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("Model picker requires interactive UI", "error");
        return;
      }

      const selected = await ctx.ui.custom<string | null>(
        (_tui, _theme, _kb, done) =>
          new ModelPickerComponent(
            items,
            _kb,
            (value) => done(value),
            () => done(null)
          )
      );

      if (!selected) return;

      config = { model: selected };
      saveConfig(config);
      ctx.ui.notify(`Auto-name model set to ${selected}`, "info");
    },
  });

  // Reload config on session start
  pi.on("session_start", async () => {
    config = loadConfig();
  });
}
