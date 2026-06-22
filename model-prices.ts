/**
 * model-prices extension - shows the active model's base pricing in the
 * status bar.
 *
 * Reads the `cost` field present on built-in and custom models (opencode-go,
 * Anthropic, OpenAI, etc.). Displays base input/output USD per million
 * tokens. Cache read/write pricing is intentionally omitted for now.
 *
 * Updates on `model_select` (via /model, Ctrl+P, or session restore) and
 * `session_start`. Clears the status slot on `session_shutdown`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type AnyModel = NonNullable<ExtensionContext["model"]>;

const STATUS_KEY = "model-prices";

function formatPrice(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	if (value === 0) return "0";
	// Trim trailing zeros: 0.0028 -> "0.0028", 1.74 -> "1.74", 0.40 -> "0.4"
	const fixed = value.toFixed(4).replace(/\.?0+$/, "");
	return fixed === "" ? "0" : fixed;
}

function renderStatus(ctx: ExtensionContext, model: AnyModel | undefined) {
	const theme = ctx.ui.theme;

	if (!model) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const cost = model.cost;
	const hasCost = cost && (cost.input > 0 || cost.output > 0);

	if (!hasCost) {
		// Priced at zero (e.g. local, bridged, or free-tier models).
		ctx.ui.setStatus(STATUS_KEY, `${theme.fg("success", "💰 free")}`);
		return;
	}

	const input = formatPrice(cost!.input);
	const output = formatPrice(cost!.output);
	const icon = theme.fg("accent", "💰");
	const price = theme.fg("text", `$${input}/$${output}`);
	const unit = theme.fg("dim", "/M");
	ctx.ui.setStatus(STATUS_KEY, `${icon} ${price}${unit}`);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		renderStatus(ctx, ctx.model);
	});

	pi.on("model_select", async (event, ctx) => {
		renderStatus(ctx, event.model);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
