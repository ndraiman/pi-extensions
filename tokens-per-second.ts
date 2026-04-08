import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";

type TurnStats = {
	turnIndex: number;
	completedOutputTokens: number;
	completedGenerationMs: number;
	activeAssistantStartMs?: number;
	activeAssistantVisibleChars: number;
};

function formatRate(rate?: number): string {
	if (rate === undefined || !Number.isFinite(rate) || rate <= 0) return "—";
	if (rate >= 100) return rate.toFixed(0);
	if (rate >= 10) return rate.toFixed(1);
	return rate.toFixed(2);
}

function calcRate(tokens: number, ms: number): number | undefined {
	if (tokens <= 0 || ms <= 0) return undefined;
	return tokens / (ms / 1000);
}

function estimateTokensFromChars(chars: number): number {
	return Math.max(0, chars / 4);
}

export default function (pi: ExtensionAPI) {
	let currentTurn: TurnStats | undefined;
	let lastRate: number | undefined;
	let lastRateEstimated = false;
	let sessionOutputTokens = 0;
	let sessionGenerationMs = 0;

	function renderStatus(ctx: ExtensionContext, opts?: { liveRate?: number; live?: boolean; estimated?: boolean }) {
		const theme = ctx.ui.theme;
		const avgRate = calcRate(sessionOutputTokens, sessionGenerationMs);
		const live = opts?.live ?? false;
		const primaryRate = opts?.liveRate ?? lastRate;
		const estimated = opts?.estimated ?? lastRateEstimated;
		const rateSuffix = estimated ? " est" : "";
		const avgSuffix = estimated && !opts?.liveRate ? " est" : "";
		const iconColor = live ? "accent" : primaryRate ? "success" : "dim";
		const icon = theme.fg(iconColor, "⚡");
		const rateText = primaryRate
			? theme.fg(live ? "accent" : "text", `${formatRate(primaryRate)} tok/s${rateSuffix}`)
			: theme.fg("dim", live ? "measuring..." : "tok/s —");
		const avgText = avgRate ? theme.fg("dim", ` · avg ${formatRate(avgRate)}${avgSuffix}`) : "";
		ctx.ui.setStatus("tokens-per-second", `${icon} ${rateText}${avgText}`);
	}

	function finalizeActiveAssistant(message: AssistantMessage | undefined): boolean {
		if (!currentTurn?.activeAssistantStartMs || !message) return false;
		currentTurn.completedGenerationMs += Math.max(1, Date.now() - currentTurn.activeAssistantStartMs);
		const outputTokens = Math.max(0, message.usage.output || 0);
		const estimated = outputTokens <= 0 && currentTurn.activeAssistantVisibleChars > 0;
		currentTurn.completedOutputTokens += estimated
			? estimateTokensFromChars(currentTurn.activeAssistantVisibleChars)
			: outputTokens;
		currentTurn.activeAssistantStartMs = undefined;
		currentTurn.activeAssistantVisibleChars = 0;
		return estimated;
	}

	pi.on("session_start", async (_event, ctx) => {
		renderStatus(ctx);
	});

	pi.on("turn_start", async (event, ctx) => {
		currentTurn = {
			turnIndex: event.turnIndex,
			completedOutputTokens: 0,
			completedGenerationMs: 0,
			activeAssistantVisibleChars: 0,
		};
		renderStatus(ctx);
	});

	pi.on("message_start", async (event, ctx) => {
		if (event.message.role !== "assistant" || !currentTurn) return;
		currentTurn.activeAssistantStartMs = Date.now();
		currentTurn.activeAssistantVisibleChars = 0;
		renderStatus(ctx, { live: true });
	});

	pi.on("message_update", async (event, ctx) => {
		if (event.message.role !== "assistant" || !currentTurn?.activeAssistantStartMs) return;

		if (event.assistantMessageEvent.type === "text_delta" || event.assistantMessageEvent.type === "thinking_delta") {
			currentTurn.activeAssistantVisibleChars += event.assistantMessageEvent.delta.length;
		}

		const partial = event.assistantMessageEvent.partial;
		const partialOutputTokens = Math.max(0, partial.usage.output || 0);
		const estimated = partialOutputTokens <= 0 && currentTurn.activeAssistantVisibleChars > 0;
		const currentMessageTokens = estimated
			? estimateTokensFromChars(currentTurn.activeAssistantVisibleChars)
			: partialOutputTokens;
		const elapsedMs = currentTurn.completedGenerationMs + Math.max(1, Date.now() - currentTurn.activeAssistantStartMs);
		const tokens = currentTurn.completedOutputTokens + currentMessageTokens;
		const liveRate = calcRate(tokens, elapsedMs);

		renderStatus(ctx, { live: true, liveRate, estimated });
	});

	pi.on("message_end", async (event, _ctx) => {
		if (event.message.role !== "assistant") return;
		finalizeActiveAssistant(event.message as AssistantMessage);
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!currentTurn) return;

		let estimated = false;
		if (event.message.role === "assistant") {
			estimated = finalizeActiveAssistant(event.message as AssistantMessage);
		}

		lastRate = calcRate(currentTurn.completedOutputTokens, currentTurn.completedGenerationMs);
		lastRateEstimated = estimated;
		if (lastRate) {
			sessionOutputTokens += currentTurn.completedOutputTokens;
			sessionGenerationMs += currentTurn.completedGenerationMs;
		}

		renderStatus(ctx, { estimated });
		currentTurn = undefined;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("tokens-per-second", undefined);
	});
}
