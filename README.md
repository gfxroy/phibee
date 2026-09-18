# Phiby

Phiby is the renamed native Align workspace. The interface follows the supplied Figma setup and two-terminal designs, with shared (Singles) and per-page (Pages) instruction editors. Each page keeps its notes through reordering and renaming, and both agent prompts receive only the current page’s notes plus the shared brief. Existing state remains in Application Support/Align for compatibility with the Figma bridge and saved runs. New default projects use Documents/Phiby Projects.

# Align for Mac

A local Mac app with one setup screen and two real coding-agent terminals. Builder on the left, manager on the right. The manager reviews and corrects each Figma page before the queue advances.

## Open the app

Open `release/Align-darwin-arm64/Align.app`. This is a local Apple Silicon build, not a signed/notarized distribution release. No web server is needed for Align itself.

To build from source with Node.js 22+:

```sh
npm install
npm run build
npm start
# Create the Mac application bundle:
npm run package:mac
```

## Use

1. Name your project. Optionally choose an existing folder; otherwise Align creates one under `Documents/Align Projects`.
2. Add Figma Dev Mode selection links in order. Name the pages and reorder them with the arrows. Pasting multiple newline-separated links creates multiple pages.
3. Add your instructions: stack, interactions, visual details and constraints. This brief stays in every manager and builder handoff.
4. Select the manager and builder coding tools and the target viewport size.
5. Start building. Approve any native workspace, tool or Figma requests in the coding-agent terminals.

Align uses installed Codex, Claude Code or Antigravity CLIs and their existing accounts. There are no account connections or MCP configuration screens in Align. The selected provider owns Figma access and asset retrieval. If its Figma tools are unavailable, the run pauses for you to resolve access in that provider; Align does not install MCP servers or modify global provider configuration.

The manager uses existing Figma MCP tools to save context.md, reference.png and original assets under .align/runs/<run>/page-N/. It then launches the builder with the full brief, selection link and local asset paths. Align automatically captures the page when the builder reports its localhost route. The manager inspects a fresh local browser render (a preview window appears briefly without taking keyboard focus), and requests focused corrections. Completion requires current-page evidence from the latest build and no reported browser console errors or horizontal overflow. The next page is withheld until the current page passes. A manager's judgment is still required for visual fidelity and interactions; the app cannot guarantee pixel-perfect output.

Pause saves progress and closes both agent processes. Resume reopens the tools with saved context on the same page. Closing Align also pauses the run. Each page allows 20 corrections before a review pause; Resume permits another batch. A three-hour execution limit also pauses, rather than advancing unfinished work.

## Implementation

- `desktop/main.cjs`: native Electron window, restricted IPC, real PTYs, local Chromium captures, folder picker and notifications.
- `desktop/preload.cjs`: narrowly scoped renderer-to-host bridge.
- `desktop/queue.js`: durable ordered queue, manager-first startup, direct builder task launch, handoff tickets, fresh-verification gates and pause/resume.
- `desktop/prompts.js`: manager instructions, builder instructions and persistent human context.
- `src/main.jsx`, `src/style.css`: minimal black interface with gradient accents.
- `scripts/package-mac.js`: packages a self-contained Mac application including the terminal native module.

The renderer loads packaged local files. There is no Align HTTP API or remote login service in the desktop workflow. Project records are stored in the app's Application Support directory. Protocol messages, source checkpoints, assets and render evidence live under the project's `.align/runs/` directory. Checkpoints exclude dependencies, build output, `.env` files and `.align`; this UI does not offer automatic restoration.

The coding tools still communicate with their model providers and Figma. Native provider sandbox and approval controls remain enabled. The manager's restriction against editing application source is instructed, not a universal OS filesystem restriction. Avoid having unrelated agents modify the same project during a run.

The earlier `server/index.js` web workflow is retained for reference and regression tests; the Mac app does not start it. Shared filesystem and CLI helpers are reused.

## Validation

```sh
npm test
```

Tests exercise ordered pages, persistent context, direct task handoffs, automatic post-build screenshots, stale completion rejection, fresh evidence after corrections, runtime-error gates, pause/resume and source checkpoint exclusions, plus shared helper regressions. Native smoke checks additionally launch the packaged app, exercise a real shell PTY, verify the local renderer and capture a real localhost page with Electron Chromium without invoking paid models.

Live model/Figma behavior requires your real selection links and authorized installed tools. CLI versions and account permissions can differ; missing executables and blocked tools are surfaced in the app. The current capture gate checks the configured viewport, not every responsive breakpoint. Terminal task handoffs rely on the agent following the structured file protocol; malformed responses block the run rather than inventing success.

A manager stage pauses after five minutes without a handoff, with an explicit message. Missing MCP access must be reported immediately; manager instructions prohibit custom Figma API clients, credential searches and polling loops.

## Debugging

Click **Logs** in the run toolbar to open that run's `logs/events.jsonl` in Finder. It records phase transitions, prompts, tickets, accepted/stale handoffs, provider exits and pause/block reasons. `manager.log` and `builder.log` persist terminal output. Files rotate at 4 MB; common credential patterns are redacted and typed input is not separately logged. Logs can still contain private project/design information; inspect before sharing.

The local `align-figma-export` MCP now provides `prepare_design_bundle` (reference, image fills, full selected-node geometry and context in one call) and `submit_builder_prompt` (ticket-checked handoff without shell/file tools). These tools operate only on the active Align page. The local provider repair is installed under `~/.local/share/align`; its credentials remain in the provider MCP configuration.

## Stack, token counter and cleanup

New projects default to React + Vite. The setup screen also offers Next.js, Vue, plain HTML and preserving the existing stack. The choice is included in every agent handoff. Generated website source belongs in the project root and runtime assets in public/assets; .align is for temporary context and verification files.

The header shows live Antigravity input/output totals from its status-line payload, split by manager/builder and aggregated by distinct provider session. It refreshes when the provider emits usage, not every streamed token. Old sessions from before tracking was installed are not backfilled. Unsupported CLI adapters explicitly display unavailable, never a fabricated estimate. Counts are provider reports, not a bill or a monetary estimate.

After completion, Clean up previews the exact files and moves them to macOS Trash. It removes .align and explicitly registered, unchanged diagnostic scripts. It refuses to proceed when website source still references .align or a listed temporary file, or when a candidate has changed. Site source, package files and permanent assets stay. Cleanup disables resuming that run; usage totals remain in the app's local project record.

Align explicitly grants each selected project folder to Antigravity's sandbox before launching it, and passes that folder with `--add-dir`. This avoids project writes being rejected by the macOS sandbox. Existing deny/ask rules remain in effect; Align does not add unsandboxed command grants. The original provider settings are backed up when changed. Figma bundle tools and localhost preview access are pre-authorized for this workflow.

Before every builder handoff, Align copies supplied design images into content-addressed `public/assets/figma` files and writes a page-local `asset-map.json` with source paths and public URLs. Builders can use these directly without shell copy operations or repeated image downloads.

## Models and token efficiency

Before starting, choose the manager and builder model independently. Blank uses the provider default. Antigravity suggestions come from its installed CLI, Codex suggestions from its local model cache, and Claude offers provider aliases; exact custom model IDs are accepted. Changing a provider clears its previous model selection. Saved choices are forwarded on every launch, including resume.

Figma JSON retains every field/value and is read through bounded MCP chunks with explicit continuation offsets. Original images and screenshot/functional review remain intact. PNG metadata includes dimensions and nontransparent bounds when decoding is within the 16-million-pixel bound; other assets remain available for native inspection. A project inventory replaces repeated initial discovery, but is explicitly a snapshot rather than validation. React/Vite and Vue/Vite previews are started by Phiby on an automatically allocated localhost port after the builder's checks; the builder reports previewPath. Other frameworks retain the provider-managed server workflow. These changes remove mechanical agent work; actual token savings and end-result equivalence require comparable real runs, not an assumed percentage.

The **View website** button appears after the builder returns a result. It starts or reuses Phiby’s own project server, verifies the actual route, and opens that URL in the default browser. Vite and Next.js use an OS-selected free port; Vite uses strict-port mode and startup retries if another process takes the port. Plain HTML binds directly to an available port. Saved runs restart their preview after reopening the app rather than trusting a stale port. The builder reports a structured `previewPath`; Phiby records the actual `previewUrl`. Custom server frameworks require a supported adapter rather than a guessed URL.
