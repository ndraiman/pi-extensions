import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATE_PATH = join(getAgentDir(), "codex-fast.json");
const SUPPORTED_MODELS = new Set([
  "openai/gpt-5.4",
  "openai-codex/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.5",
]);
const PRIORITY_SERVICE_TIER = "priority";

type FastState = {
  enabled?: boolean;
};

function loadFastState(): boolean {
  if (!existsSync(STATE_PATH)) return false;

  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as FastState;
    return parsed.enabled === true;
  } catch (error) {
    console.error(`[codex-fast] Failed to read ${STATE_PATH}:`, error);
    return false;
  }
}

function saveFastState(enabled: boolean): void {
  writeFileSync(STATE_PATH, `${JSON.stringify({ enabled }, null, 2)}\n`, "utf8");
}

function getModelKey(ctx: ExtensionContext): string | undefined {
  const model = ctx.model;
  return model ? `${model.provider}/${model.id}` : undefined;
}

function isSupportedModelKey(modelKey: string | undefined): boolean {
  return modelKey ? SUPPORTED_MODELS.has(modelKey) : false;
}

function isSupportedModel(ctx: ExtensionContext): boolean {
  return isSupportedModelKey(getModelKey(ctx));
}

function supportedModelsText(): string {
  return Array.from(SUPPORTED_MODELS).join(", ");
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
  if (!ctx.hasUI) {
    return;
  }

  if (!enabled || !isSupportedModel(ctx)) {
    ctx.ui.setStatus("codex-fast", undefined);
    return;
  }

  const theme = ctx.ui.theme;
  ctx.ui.setStatus("codex-fast", theme.fg("accent", "fast"));
}

function formatUnsupportedMessage(ctx: ExtensionContext): string {
  const current = getModelKey(ctx) ?? "none";
  return `Fast mode is only supported for ${supportedModelsText()}. Current model: ${current}.`;
}

export default function codexFast(pi: ExtensionAPI): void {
  let enabled = loadFastState();

  pi.registerCommand("fast", {
    description: "Toggle Codex Fast mode for supported OpenAI GPT-5.4/5.5 models",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      const current = getModelKey(ctx) ?? "none";
      const supported = isSupportedModel(ctx);

      const persist = (nextEnabled: boolean): boolean => {
        try {
          saveFastState(nextEnabled);
          enabled = nextEnabled;
          updateStatus(ctx, enabled);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Failed to persist Fast mode: ${message}`, "error");
          return false;
        }
      };

      if (!action) {
        if (!supported) {
          ctx.ui.notify(formatUnsupportedMessage(ctx), "warning");
          return;
        }

        const nextEnabled = !enabled;
        if (!persist(nextEnabled)) return;
        ctx.ui.notify(
          `Fast mode ${nextEnabled ? "enabled" : "disabled"} for ${current}.`,
          "info",
        );
        return;
      }

      switch (action) {
        case "status": {
          if (supported) {
            ctx.ui.notify(`Fast mode is ${enabled ? "on" : "off"} for ${current}.`, "info");
          } else {
            ctx.ui.notify(
              `Fast mode is ${enabled ? "on" : "off"}. ${formatUnsupportedMessage(ctx)}`,
              "info",
            );
          }
          return;
        }

        case "on":
        case "off": {
          if (!supported) {
            ctx.ui.notify(formatUnsupportedMessage(ctx), "warning");
            return;
          }

          const nextEnabled = action === "on";
          if (!persist(nextEnabled)) return;
          ctx.ui.notify(`Fast mode ${nextEnabled ? "enabled" : "disabled"} for ${current}.`, "info");
          return;
        }

        default:
          ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    enabled = loadFastState();
    updateStatus(ctx, enabled);
  });

  pi.on("model_select", async (_event, ctx) => {
    updateStatus(ctx, enabled);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("codex-fast", undefined);
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !isSupportedModel(ctx)) return;
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;

    return {
      ...(event.payload as Record<string, unknown>),
      service_tier: PRIORITY_SERVICE_TIER,
    };
  });
}
