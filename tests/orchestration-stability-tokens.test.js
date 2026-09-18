import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PageQueue } from '../desktop/queue.js';
import { readClaudeProjectUsage, collectUsage } from '../desktop/usage.js';

function createMockTerminal() {
  return {
    write: () => {},
    send: async () => {},
    resize: () => {},
    kill: () => {},
    onExit: () => {}
  };
}

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'align-issues-fixture-'));
  const projectDir = path.join(dir, 'project');
  await fs.mkdir(projectDir, { recursive: true });

  const opened = [];
  const sent = [];
  const engine = new PageQueue({
    dataDir: path.join(dir, 'state'),
    projectsDir: dir,
    interval: 100000,
    launch: async (role, provider, cwd, prompt, onData, onExit, options) => {
      const term = createMockTerminal();
      term.onExit = onExit;
      opened.push({ role, provider, prompt, term, onExit, options });
      return term;
    }
  });
  await engine.init();

  const project = {
    name: 'TestApp',
    directory: projectDir,
    manager: 'claude',
    builder: 'antigravity',
    viewport: { width: 1440, height: 900 },
    pages: [
      { name: 'Home', url: 'https://figma.com/design/test/site?node-id=1-1' }
    ]
  };

  const close = async () => {
    engine.killTerminals();
    clearInterval(engine.timer);
    clearTimeout(engine.deadline);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  return { dir, projectDir, project, opened, sent, engine, close };
}

// --------------------------------------------------------------------------
// Issue 1: Session Status & Action Button State (Idempotency)
// --------------------------------------------------------------------------
test('Issue 1: start() is idempotent when pipeline is already actively running', async () => {
  const f = await createFixture();
  try {
    await f.engine.start(f.project);
    assert.equal(f.engine.run.status, 'manager');
    const originalTicket = f.engine.run.ticket;
    const initialOpenedCount = f.opened.length;

    // Trigger start again on the same session while it is actively running
    const state = await f.engine.start({
      ...f.project,
      sessionId: f.engine.run.id,
      continueSession: true
    });

    // Terminals were NOT killed and ticket was NOT reset
    assert.equal(state.run?.status, 'manager');
    assert.equal(f.engine.run.ticket, originalTicket);
    assert.equal(f.opened.length, initialOpenedCount, 'Should not re-launch terminals if already running');
  } finally {
    await f.close();
  }
});

test('Issue 1: resume() is idempotent and returns state when already running', async () => {
  const f = await createFixture();
  try {
    await f.engine.start(f.project);
    assert.equal(f.engine.run.status, 'manager');

    // Calling resume while actively running should return state idempotently
    const state = await f.engine.resume();
    assert.equal(state.run?.status, 'manager');
  } finally {
    await f.close();
  }
});

// --------------------------------------------------------------------------
// Issue 2: Orchestration & State Management (Manager vs. Builder)
// --------------------------------------------------------------------------
test('Issue 2: Scoped Resumption launches only builder directly without re-running manager', async () => {
  const f = await createFixture();
  try {
    // Write fake 1x1 PNG reference
    const pageDir = path.join(f.projectDir, '.align', 'runs');
    await f.engine.start(f.project);
    const runDir = f.engine.run.directory;
    const runPageDir = path.join(runDir, 'page-1');
    await fs.mkdir(runPageDir, { recursive: true });
    const refPath = path.join(runPageDir, 'reference.png');
    // Valid PNG signature
    await fs.writeFile(refPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));

    // Manager instructs build
    await f.engine.handleManager({
      ticket: f.engine.run.ticket,
      type: 'build',
      prompt: 'Implement navigation bar and hero section'
    });

    assert.equal(f.engine.run.status, 'builder');
    assert.equal(f.opened.at(-1).role, 'builder');

    // Pause while builder is active
    await f.engine.pause();
    assert.equal(f.engine.run.status, 'paused');
    const openedBeforeResume = f.opened.length;

    // Resume session
    await f.engine.resume();

    // Scoped Resumption: Builder is launched directly; Manager is NOT launched
    assert.equal(f.engine.run.status, 'builder');
    const newlyOpened = f.opened.slice(openedBeforeResume);
    assert.equal(newlyOpened.length, 1, 'Only one terminal should be opened on scoped resume');
    assert.equal(newlyOpened[0].role, 'builder', 'Must resume directly into the builder');
    assert.match(newlyOpened[0].prompt, /Implement navigation bar and hero section/);
    assert.ok(f.engine.buffers.manager.includes('Manager is awaiting builder completion'));
  } finally {
    await f.close();
  }
});

test('Issue 2: Manager process turn exit during builder execution does not block session', async () => {
  const f = await createFixture();
  try {
    await f.engine.start(f.project);
    const runPageDir = path.join(f.engine.run.directory, 'page-1');
    await fs.mkdir(runPageDir, { recursive: true });
    await fs.writeFile(path.join(runPageDir, 'reference.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));

    await f.engine.handleManager({
      ticket: f.engine.run.ticket,
      type: 'build',
      prompt: 'Build page'
    });

    assert.equal(f.engine.run.status, 'builder');

    // Manager process completes its CLI turn and exits while builder is running
    const managerTerminal = f.opened.find(t => t.role === 'manager');
    managerTerminal.onExit();

    // The session should NOT be blocked!
    assert.equal(f.engine.run.status, 'builder', 'Session must stay active in builder stage');
    assert.ok(f.engine.buffers.manager.includes('waiting for builder'));
  } finally {
    await f.close();
  }
});

// --------------------------------------------------------------------------
// Issue 3: Unhandled Session Terminations & Stability
// --------------------------------------------------------------------------
test('Issue 3: heartbeat() tracks activity timestamp and returns health status', async () => {
  const f = await createFixture();
  try {
    await f.engine.start(f.project);
    const hb = f.engine.heartbeat();
    assert.equal(hb.ok, true);
    assert.ok(Number.isFinite(hb.lastHeartbeatAt));
    assert.equal(hb.status, 'manager');
  } finally {
    await f.close();
  }
});

test('Issue 3: Unexpected terminal exit triggers transient retry instead of immediate block', async () => {
  const f = await createFixture();
  try {
    await f.engine.start(f.project);
    assert.equal(f.engine.run.status, 'manager');

    // Manager crashes unexpectedly (no action file written)
    const managerTerminal = f.opened[0];
    managerTerminal.onExit();
    await new Promise(r => setTimeout(r, 50));

    // Session is NOT immediately blocked or killed; it records retry attempt
    assert.notEqual(f.engine.run.status, 'blocked');
    assert.equal(f.engine.run.retryCount?.manager, 1);
    assert.ok(f.engine.buffers.manager.includes('Auto-recovering terminal (attempt 1 of 3)'));
  } finally {
    await f.close();
  }
});

// --------------------------------------------------------------------------
// Issue 4: Claude Token Counter with AWS Bedrock & Standard Plans
// --------------------------------------------------------------------------
test('Issue 4: readClaudeProjectUsage correctly parses AWS Bedrock models, thinking tokens, and cache tokens', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-claude-test-'));
  try {
    const slug = tmpDir.replace(/[:\\/]+/g, '-');
    const claudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
    await fs.mkdir(claudeDir, { recursive: true });

    const bedrockSessionId = 'bedrock-session-uuid-1234';
    const jsonlPath = path.join(claudeDir, `${bedrockSessionId}.jsonl`);

    // Sample lines mimicking real AWS Bedrock session with thinkingTokens and cacheReadInputTokens
    const events = [
      JSON.stringify({ type: 'session_start', sessionId: bedrockSessionId }),
      JSON.stringify({
        type: 'cost-state',
        sessionId: bedrockSessionId,
        totalCostUSD: 2.15,
        modelUsage: {
          'us.anthropic.claude-sonnet-4-5-20250929-v1:0': {
            inputTokens: 5000,
            outputTokens: 120,
            thinkingTokens: 0,
            cacheReadInputTokens: 15000,
            cacheCreationInputTokens: 2000,
            costUSD: 0.05
          },
          'us.anthropic.claude-opus-4-6-v1': {
            inputTokens: 250,
            outputTokens: 4500,
            thinkingTokens: 2100,
            cacheReadInputTokens: 50000,
            cacheCreationInputTokens: 5000,
            costUSD: 2.10
          }
        }
      })
    ];
    await fs.writeFile(jsonlPath, events.join('\n'), 'utf8');

    const usage = await readClaudeProjectUsage(tmpDir, bedrockSessionId);
    assert.ok(usage, 'Should read usage from AWS Bedrock session');

    // Expected inputs: 5000 + 15000 + 2000 (sonnet) + 250 + 50000 + 5000 (opus) = 77,250
    assert.equal(usage.input, 77250);

    // Expected outputs: 120 + 0 (sonnet) + 4500 + 2100 (opus) = 6,720
    assert.equal(usage.output, 6720);

    // Clean up temporary claude project dir
    await fs.rm(claudeDir, { recursive: true, force: true });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Issue 4: readClaudeProjectUsage falls back to real-time assistant message events when cost-state is pending', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streaming-claude-test-'));
  try {
    const slug = tmpDir.replace(/[:\\/]+/g, '-');
    const claudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
    await fs.mkdir(claudeDir, { recursive: true });

    const sessionId = 'realtime-assistant-stream';
    const jsonlPath = path.join(claudeDir, `${sessionId}.jsonl`);

    // Stream of assistant turns without cost-state yet written
    const events = [
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 1200,
            cache_read_input_tokens: 3000,
            cache_creation_input_tokens: 400,
            output_tokens: 650,
            output_tokens_details: { thinking_tokens: 200 }
          }
        }
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 800,
            cache_read_input_tokens: 1500,
            cache_creation_input_tokens: 0,
            output_tokens: 450,
            output_tokens_details: { thinking_tokens: 50 }
          }
        }
      })
    ];
    await fs.writeFile(jsonlPath, events.join('\n'), 'utf8');

    const usage = await readClaudeProjectUsage(tmpDir, sessionId);
    assert.ok(usage, 'Should read usage from assistant message events');

    // Input: (1200 + 3000 + 400) + (800 + 1500 + 0) = 6,900
    assert.equal(usage.input, 6900);

    // Output: (650 + 200) + (450 + 50) = 1,350
    assert.equal(usage.output, 1350);

    await fs.rm(claudeDir, { recursive: true, force: true });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Issue 4: collectUsage prioritizes Claude project metrics when provider is claude', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collect-usage-claude-'));
  try {
    const slug = tmpDir.replace(/[:\\/]+/g, '-');
    const claudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
    await fs.mkdir(claudeDir, { recursive: true });

    const sessionId = 'collect-usage-session';
    const jsonlPath = path.join(claudeDir, `${sessionId}.jsonl`);

    await fs.writeFile(jsonlPath, JSON.stringify({
      type: 'cost-state',
      sessionId,
      modelUsage: {
        'claude-3-7-sonnet-20250219': {
          inputTokens: 8400,
          outputTokens: 1200
        }
      }
    }), 'utf8');

    const usage = await collectUsage(tmpDir, {}, {
      project: { manager: 'claude', builder: 'gemini' },
      sessions: { 'claude:manager': sessionId },
      terminalTokens: {},
      manualTokens: {}
    });

    assert.equal(usage.manager.input, 8400);
    assert.equal(usage.manager.output, 1200);
    assert.equal(usage.manager.reported, true);

    await fs.rm(claudeDir, { recursive: true, force: true });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
