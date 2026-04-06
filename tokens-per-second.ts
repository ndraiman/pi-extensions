/**
 * Tokens Per Second Extension
 *
 * Displays output tokens/second (including thinking tokens) in the status line.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	let streamStartTime: number | undefined;
	let lastTps: string | undefined;

	pi.on("session_start", async (_event, ctx) => {
		if (lastTps) {
			updateStatus(ctx, lastTps);
		}
	});

	pi.on("turn_start", async (_event, _ctx) => {
		streamStartTime = undefined;
	});

	pi.on("message_update", async (event, ctx) => {
		const evt = event.assistantMessageEvent;

		// Record time on first streaming delta
		if (!streamStartTime && (evt.type === "text_delta" || evt.type === "thinking_delta" || evt.type === "toolcall_delta")) {
			streamStartTime = Date.now();
		}

		// Show live tok/s from partial usage during streaming
		if (streamStartTime && "partial" in evt) {
			const outputTokens = evt.partial.usage.output;
			if (outputTokens > 0) {
				const elapsed = (Date.now() - streamStartTime) / 1000;
				if (elapsed > 0.1) {
					const tps = (outputTokens / elapsed).toFixed(1);
					updateStatus(ctx, `${tps} tok/s`);
				}
			}
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (!streamStartTime) return;
		const msg = event.message;
		if (msg.role !== "assistant") return;

		const outputTokens = msg.usage.output;
		const elapsed = (Date.now() - streamStartTime) / 1000;

		if (elapsed > 0 && outputTokens > 0) {
			lastTps = `${(outputTokens / elapsed).toFixed(1)} tok/s`;
			updateStatus(ctx, lastTps);
		}

		streamStartTime = undefined;
	});

	function updateStatus(ctx: any, text: string) {
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("tps", theme.fg("dim", text));
	}
}
