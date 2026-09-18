# Phiby Master Agent Execution Plan & Long-Session Durable Todo

> **IMPORTANT**: This is the agent's dedicated tracking document (`AGENT_TODO.md`). The user's original `todo.md` is strictly preserved and untouched. This document persists all past user requirements, file references, verification criteria, and offline/disconnect recovery protocols so that even across internet cut-offs, model context compactions, or long sessions, complete operational context is preserved.

---

## 🎯 High-Level Mission & Architecture Overview
Phiby is an autonomous, local-first Figma-to-React studio desktop app designed for macOS. It pairs a **Manager agent** (visual inspection, design context extraction, verification) with a **Builder agent** (code generation, Vite dev server, file editing) to implement pixel-accurate React codebases.

### Key Tenets:
1. **Office/Workplace Persistence**: A session is like a physical office. Opening a session restores terminal history and preview state in place without moving or restarting anything.
2. **Universal Session Memory**: Progress is tracked locally on disk (`.align/runs/<sessionId>/memory.json`) across all providers (Codex, Claude Code, Antigravity).
3. **Non-Destructive Resuming**: Resuming NEVER restarts from scratch or wipes components. It modifies files in place.
4. **Live Background Execution**: Long-running tasks continue live in the background while browsing other sessions.
5. **Clean, Premium UI**: No AI slop, no unnecessary toggles, dark mode by default, hidden scrollbars, sleek status indicators.

---

## 📋 Comprehensive Master Task Breakdown

### Section 1: Session Memory Continuity & Non-Destructive In-Place Building
*Addresses User Requests 1, 4, 5 (Task 1)*

- [x] **1.1 Universal Session Memory System**
  - **Location**: `desktop/memory.js`
  - **Mechanism**: Reads and writes `.align/runs/<sessionId>/memory.json`. Tracks `runId`, `pageIndex`, `revision`, `completedPages` (with summary and checks), `lastBuild` (with summary, `previewUrl`, `previewPath`), `sessions` map (`codex`, `claude`, `antigravity`), and scanned `projectFiles`.
  - **Verification**: Verified by unit test 26 (`Universal Session Memory tracks progress and seamlessly restores state on continuation across providers`).

- [x] **1.2 Manager Dynamic Continuation Prompt**
  - **Location**: `desktop/prompts.js` (`managerSystem(run)`)
  - **Mechanism**: When `isResuming(run)` is true, commands the manager agent: "CRITICAL: BUILD UPON EXISTING CODEBASE. The website is already built (preview: ...). Do NOT start again or rewrite components. Inspect existing files and issue delta enhancements or submit page_done."
  - **Verification**: Verified by unit test 29 (`Continuation prompts and builder guards prevent agents from restarting from scratch when resuming`).

- [x] **1.3 Builder Dynamic Continuation Guard**
  - **Location**: `desktop/prompts.js` (`builderSystem(run)` & `builderPrompt(...)`), `desktop/main.cjs`
  - **Mechanism**:
    - Prepend `CRITICAL BUILDER GUARD — BUILD UPON EXISTING CODEBASE (DO NOT START AGAIN)` to the prompt sent to the builder.
    - Command builder to NEVER run `npm create vite` or wipe existing components/styles.
    - Claude CLI integration in `desktop/main.cjs` passes continuation prompt dynamically via `--append-system-prompt`.
  - **Verification**: Verified by unit test 29.

- [x] **1.4 Stored Session Terminal Buffer Preloading on Open**
  - **Location**: `desktop/queue.js` (`openSession(...)`, `loadBuffersFromLogs(...)`)
  - **Mechanism**: When opening a session, historical terminal logs from `logs/manager.log` and `logs/builder.log` are formatted with session memory banners and loaded into `this.buffers`. The user sees the full previous context immediately before clicking Resume.
  - **Verification**: Verified by unit test 28 (`PageQueue openSession loads memory and logs into terminals in paused state without starting agents until Resume`).

- [x] **1.5 Paused State Until Explicit Resume**
  - **Location**: `desktop/queue.js` (`openSession(...)`)
  - **Mechanism**: `openSession` sets `this.run.status = 'paused'` and creates no PTY processes. Agents are only spawned when `resume()` or `start()` is explicitly invoked by the user.
  - **Verification**: Verified by unit test 28 (`launches.length === 0`, `terminals === {}`).

- [x] **1.6 Auto-Restore Preview URL & Preview Server on Resume**
  - **Location**: `desktop/queue.js` (`openSession(...)`, `resume(...)`)
  - **Mechanism**: Restores `lastBuild` and `previewUrl` from session memory or scanned project files. On `resume()`, launches Vite preview server via `this.startPreview` and restores active preview route.
  - **Verification**: Verified by unit test 27 and 28.

---

### Section 2: Live Background Sessions & Real-Time History Indicators
*Addresses User Requests 3, 5 (Task 2)*

- [x] **2.1 Non-Interrupting Session Switching**
  - **Location**: `desktop/queue.js` (`openSession(...)`)
  - **Mechanism**: If `openSession` is called with the ID of the currently running session, it immediately returns `this.state()` without restarting, pausing, or killing running child processes.
  - **Verification**: Verified in `openSession` guard lines 222-224.

- [x] **2.2 Background Session Persistence Map**
  - **Location**: `desktop/queue.js` (`this.backgroundSessions = new Map()`)
  - **Mechanism**: When switching away from a running session, the running session is stashed into `this.backgroundSessions` along with its PTYs, buffers, timer, deadline, and cancellation signal. It continues executing live. Navigating back swaps it back in seamlessly.
  - **Verification**: Verified by unit test 30 (`Live background sessions keep running without pausing and report activeRuns in state`).

- [x] **2.3 Active Background Runs State Reporting**
  - **Location**: `desktop/queue.js` (`state()`)
  - **Mechanism**: `state()` returns `activeRuns: { [sessionId]: { id, name, status, message, pageIndex } }`, exposing all concurrently running sessions to the UI.
  - **Verification**: Verified by unit test 30.

- [x] **2.4 History Tab & Popover Live Loading Spinners**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**:
    - Sidebar session list and quick session popover display an animated `<Loader2 size={13} className="spin session-active-spinner" />` and `<span className="running-pill">Live</span>` badge next to any running session.
    - Titlebar `Sessions & History` tab displays a live running count badge with spinning indicator.
  - **Verification**: Visual inspection and DOM verification in `src/main.jsx`.

- [x] **2.5 Active Background Run Banner on Setup Screen**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**: If an agent is executing in the background while the user is on the Setup/History screen, a prominent banner appears showing the session name, current action message, and a 1-click `Open workspace →` jump button.
  - **Verification**: Implemented in `.live-session-banner`.

---

### Section 3: Dark Mode Design System
*Addresses User Requests 5 (Task 3)*

- [x] **3.1 Theme State & Persistence**
  - **Location**: `src/main.jsx`
  - **Mechanism**: Theme state initialized from `localStorage.getItem('phiby-theme') || 'dark'`. Sets `data-theme` attribute on `document.documentElement` and `.native-app`.
  - **Verification**: Persists across app launches and tab reloads.

- [x] **3.2 Titlebar Sun/Moon Toggle**
  - **Location**: `src/main.jsx`
  - **Mechanism**: Dedicated toggle button in titlebar with Sun/Moon icons for instant switching between dark and light modes.
  - **Verification**: Functional in UI header.

- [x] **3.3 Obsidian & Sage Color Palette**
  - **Location**: `src/style.css`
  - **Mechanism**:
    - Dark mode: Obsidian base (`#0c0d0e`), card surfaces (`#13151a`), borders (`#20242e`), sage-olive accents (`#8da874` / `#a2b384`), crisp off-white text (`#f3f4f6`), muted labels (`#9ca3af`).
    - Light mode: Clean editorial warm tones (`#fafaf8`, `#ffffff`, `#deded8`, `#171717`).
  - **Verification**: Complete CSS variable coverage across both modes.

- [x] **3.4 Native Window Background Color**
  - **Location**: `desktop/main.cjs`
  - **Mechanism**: BrowserWindow initialized with `backgroundColor: '#0c0d0e'` to eliminate white flashes on application startup.
  - **Verification**: Electron window creation options.

---

### Section 4: Developer Features & Organized Workflow
*Addresses User Requests 4, 5 (Task 4)*

- [x] **4.1 Side-by-Side Live Split Preview**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**:
    - Split preview mode (`viewMode === 'split'`) places builder terminal on the left and live website preview iframe on the right.
    - Viewport presets: Full (100%), Desktop (1440px), Mobile (390px).
    - Includes preview reload button, URL display, and browser launch button.
  - **Verification**: Interactive in workspace view.

- [x] **4.2 "Open in Editor" (Code) Integration**
  - **Location**: `desktop/main.cjs`, `desktop/preload.cjs`, `src/main.jsx`
  - **Mechanism**: IPC handler `align:open-editor` attempts to open the active project directory in Cursor (`cursor .`), falls back to VS Code (`code .`), and falls back to macOS Finder (`shell.openPath`). Triggered via the "Code" button in workspace controls.
  - **Verification**: Handler registered in `desktop/main.cjs` lines 95-108.

- [x] **4.3 Project Codebase Files Inspector**
  - **Location**: `desktop/main.cjs`, `desktop/memory.js`, `src/main.jsx`, `src/style.css`
  - **Mechanism**: IPC handler `align:list-files` returns relative paths of generated project files. "Files" button opens a quick sliding drawer with file count and 1-click open in editor.
  - **Verification**: Handler registered in `desktop/main.cjs` lines 109-114.

- [x] **4.4 Direct Titlebar Navigation**
  - **Location**: `src/main.jsx`
  - **Mechanism**: Top-level tabs for "Workspace" and "Sessions & History" allow 1-click switching without modal popovers.
  - **Verification**: Functional in header bar.

---

### Section 5: UI Polish & AI Slop Elimination
*Addresses User Requests 5 (Task 5), 6, 7*

- [x] **5.1 Remove Autonomous Execution Toggle from UI**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**: Removed the redundant toggle card and titlebar pill. Autonomous execution is preserved under the hood (`autonomous = true` default) so agents run without user intervention.
  - **Verification**: Clean setup form without toggle clutter.

- [x] **5.2 Eliminate Sidebar Scrollbars**
  - **Location**: `src/style.css`
  - **Mechanism**: Added `scrollbar-width: none; -ms-overflow-style: none;` and `::-webkit-scrollbar { display: none; }` across `.project-sidebar nav`, `.queue-track`, `.project-popover`, and `.files-list`.
  - **Verification**: Clean, seamless scrolling without native OS scrollbar thumb bars.

- [x] **5.3 Remove Ugly Green Side Border Bump & Refine Active Session UI**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**:
    - Removed harsh `border-left` from active session items.
    - Replaced with subtle rounded tinted background (`rgba(141, 168, 116, 0.12)`) with delicate border (`rgba(141, 168, 116, 0.3)`).
    - Added subtle glowing emerald dot indicator (`.active-dot-indicator`) for active session and `<Loader2 className="spin" />` for running session.
  - **Verification**: Clean, modern aesthetics in sidebar and history popover.

- [x] **5.4 Clean Up Orphan CSS Classes**
  - **Location**: `src/style.css`
  - **Mechanism**: Removed unused `.autonomous-card`, `.autonomous-toggle`, `.toggle-slider`, and `.autonomous-tag` CSS blocks.
  - **Verification**: Verified with zero dead autonomous style declarations.

---

### Section 6: System Prompts Speed & Quality Optimization
*Addresses User Request 8*

- [x] **6.1 Eliminate Conversational Monologue for Faster Execution**
  - **Location**: `desktop/prompts.js`
  - **Mechanism**: Added explicit directives commanding agents to never write conversational conversational intros/outros before calling tools. Inspect files and emit commands immediately.
  - **Verification**: Refined system prompts in `desktop/prompts.js`.

- [x] **6.2 High-Fidelity Design Mandate**
  - **Location**: `desktop/prompts.js`
  - **Mechanism**: Mandated exact font families/weights, pixel geometry matching, responsive container layout, CSS variable extraction, and complete visual fidelity.
  - **Verification**: Verified in `builderSystem` and `managerSystem`.

- [x] **6.3 Real Interactive Wiring (Zero AI Stub Code)**
  - **Location**: `desktop/prompts.js`
  - **Mechanism**: Explicitly commanded builders to implement real interaction handlers (rotators, sliders, dropdowns, tabs, mobile menus) with actual JavaScript/React logic rather than leaving placeholder `// TODO` comments.
  - **Verification**: Verified in `builderPrompt`.

---

### Section 7: Packaging, Local Installation & Cloud Distribution
*Addresses User Requests 2, 9*

- [x] **7.1 Production Frontend Compilation**
  - **Command**: `npm run build`
  - **Output**: Clean Vite production bundle in `dist/`.

- [x] **7.2 Electron Desktop App Packaging**
  - **Command**: `node scripts/package-desktop.js`
  - **Output**: Standalone Apple Silicon app in `dist/mac-arm64/Phiby.app`.

- [x] **7.3 Local Machine Installation**
  - **Location**: `/Applications/Phiby.app`
  - **Status**: Updated and verified in local macOS Applications directory.

- [x] **7.4 Apple Silicon DMG Creation**
  - **Command**: `hdiutil create -volname Phiby -srcfolder dist/mac-arm64/Phiby.app -ov -format UDZO release/installers/Phiby-Mac-AppleSilicon.dmg`
  - **Output**: 169 MB compressed DMG installer in `release/installers/`.

- [x] **7.5 Resilient Cloud Storage Upload (Auto-Retry for Network Drops)**
  - **Script**: `scripts/upload-to-gcs.cjs`
  - **Mechanism**: Resumable Google Cloud Storage upload wrapped in a 3-attempt exponential backoff retry loop to survive transient socket resets (`write EPIPE`) or Wi-Fi flickers.
  - **Live Public URL**:
    `https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phiby-Mac-AppleSilicon.dmg`

- [x] **7.6 Automated Test Suite Execution**
  - **Command**: `npm test`
  - **Result**: 40/40 tests passing (0 failures).

---

### Section 8: High-Contrast Black & White Visual Identity (Images 1 & 2 Replicas)
*Addresses User Design Request 11*

- [x] **8.1 Stark Black & White Contrast Aesthetic**
  - **Location**: `src/style.css`, `src/main.jsx`
  - **Theme**: Crisp pure white canvas (`#ffffff`) contrasted with deep solid black rounded cards (`#000000`).
  - **Aesthetics**: Editorial/brutalist typography, monospace accents, high-contrast tactile buttons.

- [x] **8.2 Clean Header Breadcrumbs & Zero AI Slop**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**:
    - Product name: `PHIBEE.` in large bold display font (38px, font-weight 950).
    - Workspace breadcrumbs: `XCOACH` (bold uppercase project name) beside `PHIBEE STUDIO` (company/workspace).
    - Completely removed `#session-id` pill and `react` stack pill from the titlebar.
    - Completely eliminated all green dots, green glowing borders, and artificial badges.

- [x] **8.3 Setup Screen Visual Replica (Image 1)**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Features**:
    - Left Sidebar (`YOUR PROJECTS`): Solid black card (border-radius 28px) with white active pill (`background: #ffffff; color: #000000; font-weight: 700;`) + folder icon, and muted gray inactive projects. Subtitle: "Runs on your Mac. Uses your own coding tools."
    - Project Name: Underline input (`border-bottom: 2px solid #000000`) with clean label.
    - Choose Folder: Black folder tab button (`background: #000000; color: #ffffff; font-weight: 700; font-size: 11px;`).
    - Figma sections/pages: Solid black card with white page name pills, "01" monospace index, wide white URL input pills, and white navigation arrows + X. "+ add more pages" link below.
    - Instructions: Solid black card with textarea and toggle switch for `single` / `pages`.
    - Website tech stack: Solid black capsule dropdown (`React + vite`).
    - Providers: Solid black cards for Manager and Builder.
    - Start Button: Large tactile white pill with black border (`START BUILDING ⟶`).

- [x] **8.4 Workspace Toolbar & Dual Terminal Replica (Image 2)**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Features**:
    - Workspace Toolbar:
      - Left: `Working On Page 1 Of 4` + current page title `LOGIN` in bold uppercase.
      - Center: Black capsule page stepper (`<` `01 LOGIN` — `02 Onboarding (Name)` — `04 Onboarding (Goals)` `>`).
      - Right: `View Website` (black pill), `Files`, `Code`, `Split preview`, `Pause` / `Resume`, `Stop`.
    - Dual Terminal Black Card: Solid black container housing Builder on left, Manager on right.
    - White Role Pill: `Builder` / `Manager` in clean white rounded badge.
    - White Token Pill: `55790 In . 16000 Out` in clean white rounded badge.
    - Terminal Body: Pure black background with crisp white monospace text.
    - Terminal Bottom Input: White rounded pill input with placeholder `Message Builder` / `Message Manager` and black circular button with white upward arrow (`↑`).
    - Footer Status Bar: Monospace status message on left (`Manager Is Looking At The Screenshot.....`), token metrics on right (`Total - ... In . ... Out`).

---

### Section 9: Pixel-Perfect Figma Implementation (Nodes 1:87 & 1:98)
*Addresses Latest User Request for Figma Home (1:87) and Workspace (1:98)*

- [x] **9.1 Figma Home Screen (Node 1:87)**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Tabs Above Menu**: Added `YOUR PROJECTS` and `LIVE SESSIONS` pills above the sidebar list. Allows switching between stored projects and currently active live sessions running in the background.
  - **Clean Top-Right Corner**: Removed redundant top-right project selector dropdown. Kept only the clean dark mode toggle button aligned with Figma.
  - **Subtle "Built" Indicator & Green Folder**:
    - Removed built badge icon.
    - Subtle monospace text `"Built"` (`.subtle-built-text`) displayed next to project name.
    - Folder icon is explicitly colored `#00b900` (`.folder-built-green`) for all projects with built websites.
    - Name truncates cleanly with ellipsis (`text-overflow: ellipsis`) so even long project names preserve the green folder and built indicator.
  - **Brand & Icon Support**:
    - Brand wordmark: `PHIBEE.` in extra-bold display font.
    - Falcon icon support: Uses `b.png` / `bee.png` in header, built to `dist/b.png`.

- [x] **9.2 Figma Workspace Screen (Node 1:98)**
  - **Location**: `src/main.jsx`, `src/style.css`, `desktop/main.cjs`
  - **Workspace Toolbar Actions**:
    - Action pills: `#d9d9d9` light gray rounded pills matching Figma rectangles 29, 30, 31 (`View Website`, `Pause` / `Resume`, `Stop`, `Option`).
    - `View Website` button: Invokes `native.viewWebsite()` which opens the live URL directly in Google Chrome / default browser.
  - **Option Dropdown**:
    - Contains: "View Website Here" (or "Terminal" when website view is active), "File structure", "Code", "Logs".
  - **Exact Same Ratio Embedded Screen**:
    - When "View Website Here" is selected, the UI toggles to an embedded screen viewport container with a 16:10 aspect ratio and live iframe preview.
    - Both Builder and Manager terminals stay mounted in the DOM (`display: none`), preserving their PTY streams, xterm buffers, and background activity without interruption.
    - When Option -> "Terminal" is selected, the embedded website disappears and the dual terminals reappear seamlessly.
  - **B&W Contrast Dual Terminal Card**:
    - Solid black card with 30px radius.
    - White role pills: `Builder` / `Manager`.
    - White token badges: `55790 In . 16000 Out`.
    - White rounded pill input with circular black send button with `↑`.
  - **Workspace Footer**:
    - Monospace status message on left (`Manager Is Looking At The Screenshot.....` with live elapsed seconds).
    - Monospace total token usage on right (`Total - ... In . ... Out`).

- [x] **9.3 Phibee Universal Renaming**
  - **Locations**: `landing/dist/index.html`, `landing/dist/site.js`, `desktop/main.cjs`, `electron-builder.config.cjs`, `scripts/upload-to-gcs.cjs`, `tests/landing-downloads.test.js`
  - **Scope**: Replaced all product references from "Phiby" to "Phibee" across window titles, process names, bundle IDs (`local.phibee.desktop`), download cards, asset links, and documentation.

---

### Section 10: Homepage Layout Centering, Dynamic Folder Tab & Vertical Expansion
*Addresses User Requests for Centered Layout, Dynamic Folder Tab, and Height Alignment*

- [x] **10.1 Centered Homepage Layout**
  - **Location**: `src/style.css`
  - **Mechanism**: Set `.app-header` and `.home-view-container` to `max-width: 1440px; margin: 0 auto; width: 100%;`. Ensures balanced horizontal margins on wide displays without skewing left or right.

- [x] **10.2 Dynamic Folder Tab Button**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**:
    - Derives `selectedFolderName = (form.directory || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || ''`.
    - When no folder is selected: displays exclusively `<span className="tab-text">CHOOSE<br />FOLDER</span>`.
    - When a folder is selected: displays exclusively the folder name (e.g. `xcoach`) in bold with ellipsis truncation up to 180px width, while retaining the full path in the hover tooltip.
    - Added browser directory fallback via `window.showDirectoryPicker()` and `window.prompt()`.

- [x] **10.3 Vertical Height Expansion & Matching Baselines**
  - **Location**: `src/style.css`
  - **Mechanism**:
    - `.home-view-container` uses `min-height: calc(100vh - 96px); align-items: stretch;`.
    - `.home-sidebar-column` and `.home-form-column` both span `height: 100%`.
    - `.home-setup-form` flexes vertically with `justify-content: space-between; flex: 1;`.
    - `.instructions-group` expands flex height and `.options-models-group` anchors with `margin-top: auto;`.
    - Both the left sidebar card and the right setup form share the exact same bottom baseline.

- [x] **10.4 Local Application Installation & Clean Packages**
  - **Applications**: Installed and verified at `/Applications/Phibee.app` and `/Applications/Phiby.app` with `xattr -cr` quarantine flags cleared.
  - **Installers**: Created `release/installers/Phibee-Mac-AppleSilicon.dmg`, `release/downloads/Phibee-Mac-AppleSilicon.dmg`, and `release/downloads/Phibee-Mac-AppleSilicon.zip`.
  - **Screenshots**: Fresh high-res screenshots generated at `landing/dist/assets/setup.png` and `landing/dist/assets/workspace.png`.

---

### Section 11: Red-Line Boundary Confinement, Simpler Choose Folder & Expanded Start Button
*Addresses User's Red-Line Reference, Compact Instructions, Project Name Integration, and Button Sizing*

- [x] **11.1 Bound Confinement Inside Red Lines**
  - **Location**: `src/style.css`
  - **Mechanism**: Added `padding-top: 58px;` to `.home-form-column` so the right-hand form starts at the exact horizontal level of the left black card (`Your Projects`). The bottom row (`Manager Model`, `Builder Model`, `START BUILDING`) finishes level with the bottom of the left card, ensuring all right-side content stays strictly within the top and bottom red boundaries.

- [x] **11.2 Compact Instructions Box**
  - **Location**: `src/style.css`
  - **Mechanism**: Removed `flex: 1` and `min-height: 140px;` from `.instructions-group`. Configured `.instructions-box` to a compact `height: 96px;` with non-resizable textarea (`height: 100%; resize: none;`). Prevents vertical bloat and keeps the entire setup screen visible without vertical pushing.

- [x] **11.3 Tightly Integrated Project Name Type Field**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**:
    - Connected `<label className="field-label" htmlFor="project-name-input">` tightly with `gap: 4px` above the underline input.
    - Set `placeholder="Name of the project"` and `title={form.name || 'Name of the project'}`.
    - Full project name is displayed inside the line input when selected, and placeholder text appears when empty.
    - Updated sidebar selection state to track `(form.name && p.name === form.name)` and added `title={p.name}` tooltips.

- [x] **11.4 Simpler Choose Folder Button**
  - **Location**: `src/main.jsx`, `src/style.css`
  - **Mechanism**:
    - Removed old tab folder notch styling (`.choose-folder-tab-btn::before`).
    - Replaced with `.choose-folder-btn`: clean tactile pill button (`border-radius: 20px; height: 38px; padding: 0 16px;`) with a subtle `<Folder size={14} />` icon and folder name (or `Choose Folder` when empty).

- [x] **11.5 Bigger Full-Width Start Building Button**
  - **Location**: `src/style.css`
  - **Mechanism**: Configured `.start-building-button` with `flex: 1; width: 100%; height: 46px;` inside `.start-action-buttons-row`, expanding to fill the entire empty 3rd column area. When `View Website` is also present, it shares the row with `View Website` taking pill width and `CONTINUE BUILDING` taking all remaining space.

---

## 🛡️ Offline / Internet Cut-Off & Context Recovery Protocol

When an internet cut-off, system restart, or context compaction occurs, follow these steps to resume work instantly without losing context or restarting from scratch:

### 1. State Recovery Checklist
1. **Check Local Run Directory**:
   All active run data is saved at:
   `/Users/aaditya/Documents/Phiby Projects/<ProjectName>/.align/runs/<sessionId>/`
   - `control.json`: Current run status, tickets, page indices, and timestamps.
   - `memory.json`: Universal session memory (pageIndex, completedPages, lastBuild, previewUrl).
   - `logs/events.jsonl`: Complete audit log of all events and tool calls.
   - `logs/manager.log` & `logs/builder.log`: Raw terminal outputs.

2. **Verify Project Codebase Files**:
   Project source files exist untouched inside `/Users/aaditya/Documents/Phiby Projects/<ProjectName>/`.
   Existing React components, styles, and configs are never wiped.

3. **Check Test Suite Health**:
   Run `npm test` to ensure all 40 automated integration tests are passing.

4. **Verify DMG Build & Download URL**:
   Ensure `release/installers/Phibee-Mac-AppleSilicon.dmg` exists and the local Applications bundle is ready.

### 2. Immediate Agent Continuation Instructions
- Do **NOT** touch the user's `todo.md`.
- Keep this `AGENT_TODO.md` updated with any new observations or tasks.
- If a user asks to continue, open the session via `openSession` which loads memory in a paused state, and only continue when `resume()` is called.
