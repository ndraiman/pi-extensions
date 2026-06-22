import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Binds a hotkey to the rpiv-voice `/voice` dictation flow.
//
// Why we capture the handler instead of dispatching the command:
//  - pi.sendUserMessage("/voice") skips command handling on purpose
//    (expandPromptTemplates:false), so "/voice" would reach the LLM verbatim.
//  - pi.getCommands() only exposes name/description, not the handler.
// So we call rpiv-voice's exported registerVoiceCommand() with a mock pi that
// records the handler closure, then invoke it from the shortcut. The closure
// binds the real STT/mic/view modules, so dictation runs identically to /voice.
//
// Relative path: this extension lives at ~/.pi/agent/extensions/, and the
// package is installed at ~/.pi/agent/npm/node_modules/@juicesharp/rpiv-voice.
// The package ships no main/exports field, so a bare import won't resolve.
import { registerVoiceCommand } from "../npm/node_modules/@juicesharp/rpiv-voice/command/voice-command.js";

// See docs/keybindings.md for the format. On macOS, `alt+` (Option) needs the
// terminal set to use Option as Meta; a ctrl-based combo works out of the box.
const VOICE_HOTKEY = "ctrl+shift+v";

type VoiceHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

export default function (pi: ExtensionAPI) {
  let voiceHandler: VoiceHandler | undefined;

  // Capture the handler without registering a duplicate /voice command
  // (the rpiv-voice package registers it itself when it loads).
  registerVoiceCommand({
    registerCommand: (_name, options) => {
      voiceHandler = options.handler as VoiceHandler;
    },
  } as unknown as ExtensionAPI);

  pi.registerShortcut(VOICE_HOTKEY, {
    description: "Voice dictation (rpiv-voice /voice)",
    handler: async (ctx) => {
      if (!voiceHandler) {
        ctx.ui.notify(
          "Voice dictation unavailable — is @juicesharp/rpiv-voice installed?",
          "error",
        );
        return;
      }
      await voiceHandler("", ctx);
    },
  });
}
