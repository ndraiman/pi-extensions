/**
 * Prompt Stash Extension
 *
 * Git-stash-like stack for editor prompts. Session-scoped (persisted via appendEntry).
 *
 * Keybinding:
 * - Ctrl+Shift+S: If editor has text → push to stash. If editor is empty → show stash list to pop.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";

interface StashEntry {
	text: string;
	preview: string;
	timestamp: number;
}

const MAX_PREVIEW_LENGTH = 60;

function makePreview(text: string): string {
	const oneLine = text.replace(/\n/g, " ").trim();
	if (oneLine.length <= MAX_PREVIEW_LENGTH) return oneLine;
	return oneLine.slice(0, MAX_PREVIEW_LENGTH - 1) + "…";
}

function timeAgo(ts: number): string {
	const seconds = Math.floor((Date.now() - ts) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ago`;
}

export default function promptStash(pi: ExtensionAPI) {
	let stack: StashEntry[] = [];

	// Reconstruct stack from session entries on start/reload/fork
	pi.on("session_start", async (_event, ctx) => {
		stack = [];
		for (const entry of ctx.sessionManager.getEntries()) {
			const e = entry as { type: string; customType?: string; data?: { stack?: StashEntry[] } };
			if (e.type === "custom" && e.customType === "prompt-stash") {
				stack = e.data?.stack ?? [];
			}
		}
	});

	function persist() {
		pi.appendEntry("prompt-stash", { stack: [...stack] });
	}

	// Ctrl+Shift+S: push if editor has text, pop if empty
	pi.registerShortcut(Key.ctrlShift("s"), {
		description: "Stash prompt (push/pop)",
		handler: async (ctx) => {
			const text = ctx.ui.getEditorText();

			// Editor has text → push
			if (text && text.trim()) {
				stack.push({
					text,
					preview: makePreview(text),
					timestamp: Date.now(),
				});
				persist();
				ctx.ui.setEditorText("");
				ctx.ui.notify(`Stashed (${stack.length} total)`, "info");
				return;
			}

			// Editor empty → pop
			if (stack.length === 0) {
				ctx.ui.notify("Stash is empty", "warning");
				return;
			}

			// Build items, newest first
			const items: SelectItem[] = stack
				.map((entry, i) => ({
					value: String(i),
					label: `{${i}} ${entry.preview}`,
					description: timeAgo(entry.timestamp),
				}))
				.reverse();

			const result = await ctx.ui.custom<number | null>((tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(
					new Text(theme.fg("accent", theme.bold(`Stash (${stack.length})`)), 1, 0),
				);

				const selectList = new SelectList(items, Math.min(items.length, 10), {
					selectedPrefix: (t: string) => theme.fg("accent", t),
					selectedText: (t: string) => theme.fg("accent", t),
					description: (t: string) => theme.fg("muted", t),
					scrollInfo: (t: string) => theme.fg("dim", t),
					noMatch: (t: string) => theme.fg("warning", t),
				});

				selectList.onSelect = (item) => done(Number(item.value));
				selectList.onCancel = () => done(null);
				container.addChild(selectList);

				container.addChild(
					new Text(theme.fg("dim", "↑↓ navigate • enter pop • esc cancel"), 1, 0),
				);
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (result === null) return;

			const entry = stack[result];
			if (!entry) return;

			// Pop: restore to editor and remove from stack
			stack.splice(result, 1);
			persist();
			ctx.ui.setEditorText(entry.text);
			ctx.ui.notify(`Popped stash{${result}} (${stack.length} remaining)`, "info");
		},
	});
}
