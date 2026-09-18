import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PageQueue,nativeProjectSchema} from '../desktop/queue.js';

test('PageQueue remembers session ID and continues terminal coding tools from stored session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phiby-session-'));
  const dataDir = path.join(root, 'data');
  const projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  const launches = [];
  const fakeLaunch = async (role, provider, cwd, prompt, onData, onExit, options = {}) => {
    launches.push({ role, provider, options });
    return {
      write: () => {},
      resize: () => {},
      send: async () => {},
      kill: () => {}
    };
  };

  const queue = new PageQueue({
    dataDir,
    projectsDir: root,
    launch: fakeLaunch,
    capture: async () => ({}),
    startPreview: async () => 'http://127.0.0.1:3000/',
    stopPreview: () => {}
  });

  try {
    await queue.init();

    // 1. Start a project with a session ID and continueSession enabled
    const input = {
      name: 'Session Test',
      directory: projectDir,
      manager: 'claude',
      builder: 'antigravity',
      sessionId: 'sess-abc-123',
      sessions: { manager: 'sess-mgr-456', builder: 'sess-bld-789' },
      continueSession: true,
      pages: [{ name: 'Home', url: 'https://figma.com/design/x?node-id=1-1' }],
      viewport: { width: 1440, height: 900 }
    };

    const state = await queue.start(input);
    assert.equal(state.run.sessionId, 'sess-abc-123');
    assert.equal(state.run.continueSession, true);
    assert.equal(state.run.sessions.manager, 'sess-mgr-456');

    // Verify that options.session was passed to the launch function
    const managerLaunch = launches.find(l => l.role === 'manager');
    assert.ok(managerLaunch, 'Manager was launched');
    assert.equal(managerLaunch.options.session, 'sess-mgr-456');

    // 2. Test saving and updating in projects list
    assert.equal(queue.projects.length, 1);
    assert.equal(queue.projects[0].sessionId, 'sess-abc-123');

    // 3. Selecting a session from projects remembers and updates
    const selected = queue.projects[0];
    assert.equal(selected.id, state.run.project.id);
    assert.equal(selected.sessionId, 'sess-abc-123');

    // 4. Test starting another run with a builder session
    queue.killTerminals();
    const builderInput = {
      ...input,
      manager: 'codex',
      sessionId: 'codex-sess-999',
      sessions: { manager: 'codex-sess-999' },
      continueSession: true
    };
    const state2 = await queue.start(builderInput);
    assert.equal(state2.run.sessionId, 'codex-sess-999');
    const codexLaunch = launches.find(l => l.provider === 'codex');
    assert.ok(codexLaunch);
    assert.equal(codexLaunch.options.session, 'codex-sess-999');
  } finally {
    queue.killTerminals();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Universal Session Memory tracks progress and seamlessly restores state on continuation across providers', async () => {
  const { loadSessionMemory, saveSessionMemory, updateSessionMemory, formatMemoryContext, detectProviderSession } = await import('../desktop/memory.js');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phiby-mem-'));
  const runDir = path.join(root, 'run-1');
  const projDir = path.join(root, 'proj-1');
  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(path.join(projDir, 'src', 'components'), { recursive: true });
  await fs.writeFile(path.join(projDir, 'package.json'), '{"name":"my-app"}');
  await fs.writeFile(path.join(projDir, 'src', 'App.jsx'), 'export default function App() {}');
  await fs.writeFile(path.join(projDir, 'src', 'components', 'Navbar.jsx'), 'export function Navbar() {}');

  try {
    const run = {
      id: 'universal-run-123',
      directory: runDir,
      project: {
        name: 'Multi-Page Portal',
        directory: projDir,
        pages: [
          { name: 'Landing', url: 'https://figma.com/design/x?node-id=1-1' },
          { name: 'Dashboard', url: 'https://figma.com/design/x?node-id=2-2' }
        ]
      },
      pageIndex: 0,
      revision: 1,
      status: 'manager',
      sessions: { 'antigravity:manager': 'conv-agy-001' }
    };

    // 1. Record page completion
    await updateSessionMemory(run, 'page_completed', {
      summary: 'Landing page built and verified with responsive navigation',
      checks: ['Visual layout 100% match', 'Navbar buttons responsive']
    });

    // 2. Record builder build on next page
    run.pageIndex = 1;
    run.revision = 2;
    await updateSessionMemory(run, 'builder_done', {
      summary: 'Dashboard charts and stats grid implemented',
      previewPath: '/dashboard',
      checks: ['Dev server running', 'Charts rendered without overflow']
    });

    // 3. Verify memory.json was written with complete information
    const loaded = await loadSessionMemory(runDir);
    assert.ok(loaded, 'memory.json exists and loads');
    assert.equal(loaded.runId, 'universal-run-123');
    assert.equal(loaded.completedPages.length, 1);
    assert.equal(loaded.completedPages[0].name, 'Landing');
    assert.equal(loaded.lastBuild.summary, 'Dashboard charts and stats grid implemented');
    assert.ok(loaded.projectFiles.includes('package.json'));
    assert.ok(loaded.projectFiles.includes('src/App.jsx'));
    assert.ok(loaded.projectFiles.includes('src/components/Navbar.jsx'));

    // 4. Test formatMemoryContext provides rich context for continuing agents (like Opus or Gemini)
    const promptContext = formatMemoryContext(run, loaded, 'builder');
    assert.match(promptContext, /\[PERSISTENT SESSION MEMORY: CONTINUING SESSION #universa/);
    assert.match(promptContext, /COMPLETED PAGES \(MUST PRESERVE\):/);
    assert.match(promptContext, /Page 1 \(Landing\): Landing page built/);
    assert.match(promptContext, /EXISTING PROJECT CODEBASE \(ALREADY INITIALIZED\):/);
    assert.match(promptContext, /src\/components\/Navbar\.jsx/);
    assert.match(promptContext, /LAST BUILD STATUS:/);
    assert.match(promptContext, /DO NOT restart from scratch/);

    // 5. Test provider session detection from PTY output streams
    assert.equal(
      detectProviderSession('manager', 'claude', 'Claude session started. ID: 12345678-abcd-ef01-2345-6789abcdef01'),
      '12345678-abcd-ef01-2345-6789abcdef01'
    );
    assert.equal(
      detectProviderSession('builder', 'antigravity', 'Resuming conversation: 9adbb06a-3280-4f6a-96a0-8a0e5ddc0964'),
      '9adbb06a-3280-4f6a-96a0-8a0e5ddc0964'
    );
    assert.equal(
      detectProviderSession('builder', 'codex', 'Session established. thread_id: thread_abc123xyz'),
      'thread_abc123xyz'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('PageQueue start restores completed pages and pageIndex from saved memory when continuing session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phiby-restore-'));
  const dataDir = path.join(root, 'data');
  const projectDir = path.join(root, 'project');
  const sessionId = 'restore-test-session';
  const runDir = path.join(projectDir, '.align', 'runs', sessionId);
  await fs.mkdir(runDir, { recursive: true });

  const { saveSessionMemory } = await import('../desktop/memory.js');
  await saveSessionMemory(runDir, {
    runId: sessionId,
    pageIndex: 1,
    revision: 3,
    completedPages: [
      { index: 0, name: 'Home', summary: 'Home completed with rotator component', checks: ['Rotator works'] }
    ],
    lastBuild: { summary: 'About page cards rendered', previewPath: '/about', checks: [] },
    sessions: { 'antigravity:manager': 'agy-conv-777' }
  });

  const launches = [];
  const fakeLaunch = async (role, provider, cwd, prompt, onData, onExit, options = {}) => {
    launches.push({ role, provider, prompt, options });
    return { write: () => {}, resize: () => {}, send: async () => {}, kill: () => {} };
  };

  const queue = new PageQueue({
    dataDir,
    projectsDir: root,
    launch: fakeLaunch,
    capture: async () => ({}),
    startPreview: async () => 'http://127.0.0.1:3000/',
    stopPreview: () => {}
  });

  try {
    await queue.init();
    const state = await queue.start({
      name: 'Restore Test',
      directory: projectDir,
      manager: 'claude',
      builder: 'antigravity',
      sessionId,
      continueSession: true,
      pages: [
        { name: 'Home', url: 'https://figma.com/design/x?node-id=1-1' },
        { name: 'About', url: 'https://figma.com/design/x?node-id=2-2' }
      ],
      viewport: { width: 1440, height: 900 }
    });

    // Verify pageIndex was restored to 1 (not reset to 0!)
    assert.equal(state.run.pageIndex, 1);
    assert.equal(state.run.pages[0].status, 'done');
    assert.equal(state.run.pages[0].summary, 'Home completed with rotator component');
    assert.equal(state.run.pages[1].status, 'active');

    // Verify prompt delivered to manager has persistent memory block
    const managerLaunch = launches.find(l => l.role === 'manager');
    assert.ok(managerLaunch);
    assert.match(managerLaunch.prompt, /\[PERSISTENT SESSION MEMORY: CONTINUING SESSION #restore-\]/);
    assert.match(managerLaunch.prompt, /COMPLETED PAGES \(MUST PRESERVE\):/);
    assert.match(managerLaunch.prompt, /Page 1 \(Home\): Home completed with rotator component/);
  } finally {
    queue.killTerminals();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('PageQueue openSession loads memory and logs into terminals in paused state without starting agents until Resume', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phiby-open-sess-'));
  const dataDir = path.join(root, 'data');
  const projectDir = path.join(root, 'project');
  const sessionId = 'open-workplace-session';
  const runDir = path.join(projectDir, '.align', 'runs', sessionId);
  await fs.mkdir(path.join(runDir, 'logs'), { recursive: true });

  await fs.writeFile(path.join(runDir, 'logs', 'manager.log'), '[Manager Log Line 1: Inspected rotator]');
  await fs.writeFile(path.join(runDir, 'logs', 'builder.log'), '[Builder Log Line 1: Rotator component built at src/Rotator.jsx]');

  const { saveSessionMemory } = await import('../desktop/memory.js');
  await saveSessionMemory(runDir, {
    runId: sessionId,
    pageIndex: 0,
    revision: 1,
    completedPages: [],
    lastBuild: { summary: 'Galaziio rotator and sticky yellow pin rendered', previewUrl: 'http://localhost:5173/', previewPath: '/', checks: ['Rotator spins'] },
    sessions: { manager: 'conv-mgr-111', builder: 'conv-bld-222' }
  });

  const launches = [];
  const fakeLaunch = async (role, provider, cwd, prompt, onData, onExit, options = {}) => {
    launches.push({ role, provider, prompt, options });
    return { write: () => {}, resize: () => {}, send: async () => {}, kill: () => {} };
  };

  const queue = new PageQueue({
    dataDir,
    projectsDir: root,
    launch: fakeLaunch,
    capture: async () => ({}),
    startPreview: async () => 'http://127.0.0.1:3000/',
    stopPreview: () => {}
  });

  try {
    await queue.init();

    const state = await queue.openSession({
      name: 'Galaziio Studio',
      directory: projectDir,
      manager: 'claude',
      builder: 'antigravity',
      sessionId,
      pages: [{ name: 'Rotator Page', url: 'https://figma.com/design/x?node-id=1-1' }],
      viewport: { width: 1440, height: 900 }
    });

    assert.equal(state.run.status, 'paused');
    assert.equal(launches.length, 0, 'No agents launched before Resume is clicked');
    assert.equal(Object.keys(queue.terminals).length, 0, 'Terminals map is empty before Resume');

    assert.match(queue.buffers.manager, /\[Manager Log Line 1: Inspected rotator\]/);
    assert.match(queue.buffers.manager, /SESSION MEMORY LOADED[\s\S]*#open-wor/);
    assert.match(queue.buffers.manager, /Galaziio rotator and sticky yellow pin rendered/);

    assert.match(queue.buffers.builder, /\[Builder Log Line 1: Rotator component built/);
    assert.match(queue.buffers.builder, /SESSION MEMORY LOADED[\s\S]*#open-wor/);

    assert.ok(state.run.lastBuild, 'lastBuild is restored');
    assert.equal(state.run.lastBuild.previewUrl, 'http://localhost:5173/');
    assert.equal(state.run.previewUrl, 'http://localhost:5173/');

    const resumedState = await queue.resume();
    assert.equal(resumedState.run.status, 'manager');
    assert.equal(launches.length, 1, 'Manager launched on Resume');

    const managerLaunch = launches.find(l => l.role === 'manager');
    assert.ok(managerLaunch);
    assert.match(managerLaunch.prompt, /BUILD UPON EXISTING WEBSITE/);
    assert.match(managerLaunch.prompt, /The website is already built/);
    assert.match(managerLaunch.prompt, /Do NOT recreate or overwrite existing components/);
  } finally {
    queue.killTerminals();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Continuation prompts and builder guards prevent agents from restarting from scratch when resuming', async () => {
  const { isResuming, managerSystem, builderSystem, managerPrompt, builderPrompt } = await import('../desktop/prompts.js');

  const resumingRun = {
    id: 'run-resume-99',
    continueSession: true,
    directory: '/tmp/run-resume-99',
    ticket: 'ticket-99',
    pageIndex: 0,
    revision: 1,
    previewUrl: 'http://localhost:5173/',
    lastBuild: { summary: 'Working rotator app', previewUrl: 'http://localhost:5173/', previewPath: '/' },
    project: {
      name: 'Galaziio App',
      directory: '/tmp/project-99',
      stack: 'react',
      prompt: 'Keep rotator rotating and yellow card stuck',
      viewport: { width: 1440, height: 900 },
      pages: [{ name: 'Home', url: 'https://figma.com/design/x?node-id=1-1' }]
    },
    pages: [{ name: 'Home', status: 'active', iterations: 1 }]
  };

  assert.equal(isResuming(resumingRun), true);

  const mgrSys = managerSystem(resumingRun);
  assert.match(mgrSys, /CRITICAL CONTINUATION DIRECTIVE/);
  assert.match(mgrSys, /DO NOT restart from scratch/);
  assert.match(mgrSys, /DO NOT discard, overwrite, or break existing working components/);
  assert.match(mgrSys, /BUILD UPON AND REFINE THE EXISTING CODEBASE/);

  const bldSys = builderSystem(resumingRun);
  assert.match(bldSys, /CRITICAL BUILDER DIRECTIVE — BUILD UPON EXISTING WORK/);
  assert.match(bldSys, /DO NOT run "npm create vite"/);
  assert.match(bldSys, /DO NOT delete, wipe, or overwrite working components/);
  assert.match(bldSys, /MODIFY EXISTING FILES IN PLACE/);

  const bldPrompt = builderPrompt(resumingRun, 'Fix rotator margin');
  assert.match(bldPrompt, /CRITICAL BUILDER GUARD — BUILD UPON EXISTING CODEBASE \(DO NOT START AGAIN\)/);
  assert.match(bldPrompt, /The website is already initialized and working/);
  assert.match(bldPrompt, /modify them IN PLACE/);

  const mgrPrompt = managerPrompt(resumingRun);
  assert.match(mgrPrompt, /Continuing session #run-resu/);
  assert.match(mgrPrompt, /FOCUSED DELTA: Modify existing files in place/);
});

test('Live background sessions keep running without pausing and report activeRuns in state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phiby-live-bg-'));
  const dataDir = path.join(root, 'data');
  const projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  const queue = new PageQueue({
    dataDir,
    projectsDir: root,
    launch: async () => ({
      write: () => {},
      resize: () => {},
      send: async () => {},
      kill: () => {}
    }),
    capture: async () => ({}),
    startPreview: async () => 'http://127.0.0.1:3000/',
    stopPreview: () => {}
  });

  try {
    await queue.init();

    const input1 = {
      name: 'Project One',
      directory: path.join(root, 'p1'),
      manager: 'claude',
      builder: 'antigravity',
      sessionId: 'sess-p1-live',
      continueSession: true,
      pages: [{ name: 'Home', url: 'https://figma.com/design/x?node-id=1-1' }],
      viewport: { width: 1440, height: 900 }
    };
    await fs.mkdir(input1.directory, { recursive: true });

    // Start session 1
    const s1 = await queue.start(input1);
    assert.equal(s1.run.sessionId, 'sess-p1-live');

    // Simulate running state
    queue.run.status = 'builder';
    queue.run.message = 'Builder is coding the rotator component...';

    // Verify activeRuns contains session 1
    const st1 = queue.state();
    assert.ok(st1.activeRuns['sess-p1-live'], 'Session 1 is in activeRuns');
    assert.equal(st1.activeRuns['sess-p1-live'].status, 'builder');

    // 1. Selecting the same running session does NOT pause it
    const s1Again = await queue.openSession(input1);
    assert.equal(s1Again.run.status, 'builder', 'Session 1 remains actively running');
    assert.ok(queue.terminals.builder || queue.terminals.manager !== undefined);

    // 2. Open another session (Project 2)
    const input2 = {
      name: 'Project Two',
      directory: path.join(root, 'p2'),
      manager: 'claude',
      builder: 'antigravity',
      sessionId: 'sess-p2-other',
      continueSession: true,
      pages: [{ name: 'Dashboard', url: 'https://figma.com/design/x?node-id=2-1' }],
      viewport: { width: 1440, height: 900 }
    };
    await fs.mkdir(input2.directory, { recursive: true });

    const s2 = await queue.openSession(input2);
    // Project 1 should now be preserved in backgroundSessions
    assert.ok(queue.backgroundSessions.has('sess-p1-live'), 'Project 1 is preserved in backgroundSessions');
    assert.equal(queue.backgroundSessions.get('sess-p1-live').run.status, 'builder');

    // activeRuns still reports Project 1 as running!
    const st2 = queue.state();
    assert.ok(st2.activeRuns['sess-p1-live'], 'Project 1 is still in activeRuns while project 2 is open');
    assert.equal(st2.activeRuns['sess-p1-live'].name, 'Project One');

    // 3. Switch back to Project 1
    const backTo1 = await queue.openSession(input1);
    assert.equal(backTo1.run.sessionId, 'sess-p1-live');
    assert.equal(backTo1.run.status, 'builder', 'Project 1 restored in running status');
    assert.equal(queue.backgroundSessions.has('sess-p1-live'), false, 'Project 1 moved back to foreground');
  } finally {
    queue.killTerminals();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Seamless provider switch from Claude to Antigravity preserves persistent memory and builder continuation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phiby-switch-'));
  const dataDir = path.join(root, 'data');
  const projectDir = path.join(root, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  const launches = [];
  const fakeLaunch = async (role, provider, cwd, prompt, onData, onExit, options = {}) => {
    launches.push({ role, provider, prompt, options });
    return {
      write: () => {},
      resize: () => {},
      send: async () => {},
      kill: () => {}
    };
  };

  const queue = new PageQueue({
    dataDir,
    projectsDir: root,
    launch: fakeLaunch,
    capture: async () => ({}),
    startPreview: async () => 'http://127.0.0.1:3000/',
    stopPreview: () => {}
  });

  try {
    await queue.init();

    // 1. Start with Claude for both manager and builder
    const initialInput = {
      name: 'Switch Test',
      directory: projectDir,
      manager: 'claude',
      builder: 'claude',
      sessionId: 'sess-claude-orig',
      sessions: { manager: 'claude-uuid-mgr-111', builder: 'claude-uuid-bld-222' },
      continueSession: false,
      pages: [{ name: 'Home', url: 'https://figma.com/design/test?node-id=1-1' }],
      viewport: { width: 1440, height: 900 }
    };

    await queue.start(initialInput);
    assert.equal(launches.at(-1).provider, 'claude');

    // Create reference PNG mock
    const { pageDirectory } = await import('../desktop/prompts.js');
    const { PNG } = await import('pngjs');
    await fs.mkdir(pageDirectory(queue.run), { recursive: true });
    await fs.writeFile(path.join(pageDirectory(queue.run), 'reference.png'), PNG.sync.write(new PNG({ width: 20, height: 20 })));

    // Manager issues build action to builder
    await queue.handleManager({
      ticket: queue.run.ticket,
      type: 'build',
      prompt: 'Build the homepage navbar and hero section'
    });
    assert.equal(queue.run.status, 'builder');
    assert.equal(queue.run.lastActiveRole, 'builder');

    // 2. User stops the run (e.g. limit reached)
    await queue.stop();
    assert.equal(queue.run.status, 'stopped');

    // 3. User switches both Manager and Builder to Antigravity without selecting any model and clicks Continue Building
    const continueInput = {
      ...initialInput,
      manager: 'antigravity',
      builder: 'antigravity',
      managerModel: '',
      builderModel: '',
      continueSession: true,
      sessionId: 'sess-claude-orig'
    };

    launches.length = 0; // Clear launch log to check new launches
    const s = await queue.start(continueInput);

    // Verify engine continued as builder (since builder was working when stopped)
    assert.equal(s.run.status, 'builder');
    assert.equal(s.run.project.manager, 'antigravity');
    assert.equal(s.run.project.builder, 'antigravity');

    // Verify builder was launched with Antigravity
    const builderLaunch = launches.find(l => l.role === 'builder');
    assert.ok(builderLaunch, 'Builder was launched directly');
    assert.equal(builderLaunch.provider, 'antigravity');

    // Verify Antigravity was NOT given Claude's UUID session ID (clean provider switch)
    assert.equal(builderLaunch.options.session, '', 'Claude UUID was not passed to Antigravity');

    // Verify builder prompt contains seamless handoff banner and memory directives
    assert.match(builderLaunch.prompt, /SEAMLESS PROVIDER HANDOFF: ANTIGRAVITY TAKING OVER FROM CLAUDE/);
    assert.match(builderLaunch.prompt, /LAST ACTIVE AGENT: BUILDER/);
    assert.match(builderLaunch.prompt, /Build the homepage navbar and hero section/);
  } finally {
    queue.killTerminals();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Parallel sessions: queue.start() on new project preserves existing running session in backgroundSessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phiby-parallel-'));
  const dataDir = path.join(root, 'data');
  const p1Dir = path.join(root, 'p1');
  const p2Dir = path.join(root, 'p2');
  await fs.mkdir(p1Dir, { recursive: true });
  await fs.mkdir(p2Dir, { recursive: true });

  const launchedTerminals = [];
  let killedCount = 0;
  const fakeLaunch = async (role, provider, cwd, prompt, onData, onExit, options = {}) => {
    const term = {
      role,
      provider,
      write: () => {},
      resize: () => {},
      send: async () => {},
      kill: () => { killedCount++; }
    };
    launchedTerminals.push(term);
    return term;
  };

  const queue = new PageQueue({
    dataDir,
    projectsDir: root,
    launch: fakeLaunch,
    capture: async () => ({}),
    startPreview: async () => 'http://127.0.0.1:3000/',
    stopPreview: () => {}
  });

  try {
    await queue.init();

    // 1. Launch project 1
    const p1 = {
      name: 'Project 1',
      directory: p1Dir,
      manager: 'antigravity',
      builder: 'antigravity',
      sessionId: 'sess-parallel-1',
      continueSession: false,
      pages: [{ name: 'Home', url: 'https://figma.com/design/test?node-id=1-1' }],
      viewport: { width: 1440, height: 900 }
    };
    await queue.start(p1);
    queue.run.status = 'builder';

    assert.equal(queue.run.sessionId, 'sess-parallel-1');
    assert.equal(queue.run.status, 'builder');
    assert.equal(killedCount, 0, 'No terminals killed yet');

    // 2. Launch project 2 (parallel session!)
    const p2 = {
      name: 'Project 2',
      directory: p2Dir,
      manager: 'antigravity',
      builder: 'antigravity',
      sessionId: 'sess-parallel-2',
      continueSession: false,
      pages: [{ name: 'About', url: 'https://figma.com/design/test?node-id=2-2' }],
      viewport: { width: 1440, height: 900 }
    };
    await queue.start(p2);

    // Project 1 must NOT have been killed; it should be stashed in backgroundSessions!
    assert.equal(killedCount, 0, 'Project 1 terminals were not killed on parallel start');
    assert.ok(queue.backgroundSessions.has('sess-parallel-1'), 'Project 1 is active in backgroundSessions');
    assert.equal(queue.backgroundSessions.get('sess-parallel-1').run.status, 'builder');

    // Project 2 is now foreground
    assert.equal(queue.run.sessionId, 'sess-parallel-2');

    // Both sessions are reported in activeRuns
    const state = queue.state();
    assert.ok(state.activeRuns['sess-parallel-1'], 'Project 1 is in activeRuns');
    assert.equal(state.activeRuns['sess-parallel-1'].name, 'Project 1');
  } finally {
    await queue.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
