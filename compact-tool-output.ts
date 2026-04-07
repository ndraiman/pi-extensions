import path from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  SettingsManager,
  createBashToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  formatSize,
  getAgentDir,
  getLanguageFromPath,
  highlightCode,
  keyHint,
  type AgentToolResult,
  type BashToolDetails,
  type ExtensionAPI,
  type ReadToolDetails,
  type ReadToolInput,
  type Theme,
  type ToolDefinition,
  type ToolRenderContext,
  type WriteToolInput,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

const settingsManager = SettingsManager.create(process.cwd(), getAgentDir());

function replaceTabs(text: string): string {
  return text.replace(/\t/g, "    ");
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let endIndex = lines.length;

  while (endIndex > 0 && lines[endIndex - 1] === "") {
    endIndex -= 1;
  }

  return lines.slice(0, endIndex);
}

function getTextOutput(result: AgentToolResult<unknown>): string {
  return result.content
    .flatMap((contentPart) => (contentPart.type === "text" ? [contentPart.text] : []))
    .join("\n");
}

function getExpandHint(theme: Theme): string {
  return `${theme.fg("muted", "(")}${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
}

function getTextComponent<TState, TArgs>({
  context,
  text,
}: {
  context: ToolRenderContext<TState, TArgs>;
  text: string;
}): Text {
  const component = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);

  component.setText(text);

  return component;
}

function formatReadCollapsedResult({
  args,
  theme,
}: {
  args: ReadToolInput;
  theme: Theme;
}): string {
  const fileName = args.path ? path.basename(args.path) : "file";

  return `\n${theme.fg("accent", fileName)} ${getExpandHint(theme)}`;
}

function formatReadExpandedResult({
  args,
  result,
  theme,
}: {
  args: ReadToolInput;
  result: AgentToolResult<ReadToolDetails | undefined>;
  theme: Theme;
}): string {
  const output = getTextOutput(result);
  const language = args.path ? getLanguageFromPath(args.path) : undefined;
  const renderedLines = language ? highlightCode(replaceTabs(output), language) : replaceTabs(output).split("\n");
  const visibleLines = trimTrailingEmptyLines(renderedLines);
  let text = `\n${visibleLines.map((line) => (language ? line : theme.fg("toolOutput", line))).join("\n")}`;

  const truncation = result.details?.truncation;

  if (!truncation?.truncated) {
    return text;
  }

  if (truncation.firstLineExceedsLimit) {
    text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
    return text;
  }

  if (truncation.truncatedBy === "lines") {
    text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
    return text;
  }

  text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;

  return text;
}

function formatWriteCollapsedCall({
  args,
  theme,
}: {
  args: WriteToolInput & { file_path?: string };
  theme: Theme;
}): string {
  const filePath = args.path ?? args.file_path;
  const fileName = filePath ? path.basename(filePath) : "file";

  return `${theme.fg("toolTitle", theme.bold("write"))} ${theme.fg("accent", fileName)} ${getExpandHint(theme)}`;
}

function formatBashCollapsedResult(theme: Theme): string {
  return `\n${theme.fg("muted", "[output hidden, ")}${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", "]")}`;
}

function formatBashExpandedResult({
  result,
  theme,
}: {
  result: AgentToolResult<BashToolDetails | undefined>;
  theme: Theme;
}): string {
  const output = replaceTabs(getTextOutput(result)).trimEnd();
  let text = output
    ? `\n${output.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n")}`
    : `\n${theme.fg("muted", "[no output]")}`;

  const truncation = result.details?.truncation;

  if (truncation?.truncated) {
    if (truncation.firstLineExceedsLimit) {
      text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
    } else if (truncation.truncatedBy === "lines") {
      text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
    } else {
      text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
    }
  }

  if (result.details?.fullOutputPath) {
    text += `\n${theme.fg("muted", `Full output saved to ${result.details.fullOutputPath}`)}`;
  }

  return text;
}

function createCompactReadToolDefinition(): ToolDefinition<any, ReadToolDetails | undefined, any> {
  const baseDefinition = createReadToolDefinition(process.cwd(), {
    autoResizeImages: settingsManager.getImageAutoResize(),
  });

  return {
    ...baseDefinition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return createReadToolDefinition(ctx.cwd, {
        autoResizeImages: settingsManager.getImageAutoResize(),
      }).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      if (!baseDefinition.renderCall) {
        return getTextComponent({
          context,
          text: `${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", args.path)}`,
        });
      }

      return baseDefinition.renderCall(args, theme, context);
    },
    renderResult(result, options, theme, context) {
      const text = options.expanded
        ? formatReadExpandedResult({
            args: context.args as ReadToolInput,
            result,
            theme,
          })
        : formatReadCollapsedResult({
            args: context.args as ReadToolInput,
            theme,
          });

      return getTextComponent({ context, text });
    },
  };
}

function createCompactWriteToolDefinition(): ToolDefinition<any, undefined, any> {
  const baseDefinition = createWriteToolDefinition(process.cwd());

  return {
    ...baseDefinition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return createWriteToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      if (context.expanded && baseDefinition.renderCall) {
        return baseDefinition.renderCall(args, theme, context);
      }

      return getTextComponent({
        context,
        text: formatWriteCollapsedCall({
          args: args as WriteToolInput & { file_path?: string },
          theme,
        }),
      });
    },
    renderResult(result, options, theme, context) {
      if (!baseDefinition.renderResult) {
        return getTextComponent({ context, text: "" });
      }

      return baseDefinition.renderResult(result, options, theme, context);
    },
  };
}

function createCompactBashToolDefinition(): ToolDefinition<any, BashToolDetails | undefined, any> {
  const baseDefinition = createBashToolDefinition(process.cwd(), {
    commandPrefix: settingsManager.getShellCommandPrefix(),
  });

  return {
    ...baseDefinition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return createBashToolDefinition(ctx.cwd, {
        commandPrefix: settingsManager.getShellCommandPrefix(),
      }).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      if (!baseDefinition.renderCall) {
        return getTextComponent({
          context,
          text: `${theme.fg("toolTitle", theme.bold("bash"))} ${theme.fg("toolOutput", args.command)}`,
        });
      }

      return baseDefinition.renderCall(args, theme, context);
    },
    renderResult(result, options, theme, context) {
      const text = options.expanded
        ? formatBashExpandedResult({ result, theme })
        : formatBashCollapsedResult(theme);

      return getTextComponent({ context, text });
    },
  };
}

export default function compactToolOutput(pi: ExtensionAPI): void {
  pi.registerTool(createCompactReadToolDefinition());
  pi.registerTool(createCompactWriteToolDefinition());
  pi.registerTool(createCompactBashToolDefinition());
}
