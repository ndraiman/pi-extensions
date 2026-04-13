import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type PullRequest = {
	number: number;
	url: string;
};

function hyperlink({ label, url }: { label: string; url: string }): string {
	return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

export default function prStatusExtension(pi: ExtensionAPI) {
	let refreshPromise: Promise<void> | null = null;

	async function refresh(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (refreshPromise) return refreshPromise;

		refreshPromise = (async () => {
			const result = await pi.exec("gh", ["pr", "view", "--json", "number,url"], {
				cwd: ctx.cwd,
				timeout: 5000,
				signal: ctx.signal,
			});

			if (result.code !== 0) {
				ctx.ui.setStatus("pr-link", undefined);
				return;
			}

			let pr: PullRequest;
			try {
				pr = JSON.parse(result.stdout) as PullRequest;
			} catch {
				ctx.ui.setStatus("pr-link", undefined);
				return;
			}

			ctx.ui.setStatus(
				"pr-link",
				hyperlink({
					label: ctx.ui.theme.underline(ctx.ui.theme.fg("warning", `PR #${pr.number}`)),
					url: pr.url,
				}),
			);
		})();

		try {
			await refreshPromise;
		} finally {
			refreshPromise = null;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("pr-link", undefined);
	});
}
