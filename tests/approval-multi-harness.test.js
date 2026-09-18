import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectApprovalPrompt } from '../desktop/approval.js';
import { readClaudeProjectUsage, collectUsage } from '../desktop/usage.js';

test('detectApprovalPrompt detects Claude Opus and Sonnet interactive tool prompts and selects option 1', () => {
  // Numbered list approval typical of Claude Code
  const claudeNumberedPrompt = `
  Allow Bash to run \`npm run build\`?
  1. Yes
  2. Yes, don't ask again for this session
  3. No
  `;
  const res = detectApprovalPrompt(claudeNumberedPrompt, 'claude');
  assert.ok(res, 'Should detect Claude numbered prompt');
  assert.equal(res.detected, true);
  assert.equal(res.response, '1\r');

  // Arrow list approval
  const arrowPrompt = `
  Allow tool Edit?
  ❯ 1. Yes
    2. No
  `;
  const resArrow = detectApprovalPrompt(arrowPrompt, 'claude');
  assert.ok(resArrow);
  assert.equal(resArrow.detected, true);
  assert.ok(resArrow.response === '1\r' || resArrow.response === '\r');

  // Claude "Allow once / Always allow" prompt
  const allowOncePrompt = `
  1. Allow once
  2. Always allow for this directory
  3. Deny
  `;
  const resAllowOnce = detectApprovalPrompt(allowOncePrompt, 'claude');
  assert.ok(resAllowOnce);
  assert.equal(resAllowOnce.detected, true);
  assert.equal(resAllowOnce.response, '1\r');
});

test('detectApprovalPrompt detects Antigravity and Gemini approval prompts', () => {
  const agyPrompt = `Allow this tool execution? [y/N]`;
  const resAgy = detectApprovalPrompt(agyPrompt, 'antigravity');
  assert.ok(resAgy);
  assert.equal(resAgy.detected, true);
  assert.equal(resAgy.response, 'y\r');

  const agyEditPrompt = `Do you want to apply these edits? (y/n)`;
  const resEdit = detectApprovalPrompt(agyEditPrompt, 'antigravity');
  assert.ok(resEdit);
  assert.equal(resEdit.detected, true);
  assert.equal(resEdit.response, 'y\r');
});

test('detectApprovalPrompt detects Codex approval prompts', () => {
  const codexPrompt = `Execute command 'vite build'? [y/n]`;
  const resCodex = detectApprovalPrompt(codexPrompt, 'codex');
  assert.ok(resCodex);
  assert.equal(resCodex.detected, true);
  assert.equal(resCodex.response, 'y\r');

  const enterPrompt = `Press Enter to continue...`;
  const resEnter = detectApprovalPrompt(enterPrompt, 'codex');
  assert.ok(resEnter);
  assert.equal(resEnter.detected, true);
  assert.equal(resEnter.response, '\r');
});

test('readClaudeProjectUsage extracts authoritative tokens from Claude project cost-state JSONL', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-test-proj-'));
  try {
    const slug = tmpDir.replace(/[\/\\]+/g, '-');
    const claudeDir = path.join(os.homedir(), '.claude', 'projects', slug);
    await fs.mkdir(claudeDir, { recursive: true });

    const sessionFile = path.join(claudeDir, 'test-session.jsonl');
    const jsonlData = [
      JSON.stringify({ type: 'user', content: 'hello' }),
      JSON.stringify({
        type: 'cost-state',
        sessionId: 'test-session',
        modelUsage: {
          'us.anthropic.claude-opus-4-6-v1': {
            inputTokens: 3500,
            outputTokens: 1200,
            cacheReadInputTokens: 500,
            cacheCreationInputTokens: 200
          }
        }
      })
    ].join('\n') + '\n';

    await fs.writeFile(sessionFile, jsonlData);

    const usage = await readClaudeProjectUsage(tmpDir, 'test-session');
    assert.ok(usage, 'Should read Claude usage');
    assert.equal(usage.input, 3500 + 500 + 200); // 4200
    assert.equal(usage.output, 1200);

    // Should also resolve correctly when run subdirectory (.align/runs/<sessionId>) is passed
    const runSubDirUsage = await readClaudeProjectUsage(path.join(tmpDir, '.align', 'runs', 'some-session-uuid'), 'test-session');
    assert.ok(runSubDirUsage, 'Should read Claude usage when passed .align/runs subpath');
    assert.equal(runSubDirUsage.input, 4200);
    assert.equal(runSubDirUsage.output, 1200);

    // Clean up temporary claude dir
    await fs.rm(claudeDir, { recursive: true, force: true });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('nativeProjectSchema cleanly parses null previewUrl, null models, and null session parameters without throwing', async () => {
  const { nativeProjectSchema } = await import('../desktop/queue.js');
  const input = {
    name: 'Landing Page Test',
    directory: '/Users/aaditya/test',
    pages: [{ name: 'Home', url: 'https://www.figma.com/design/abc/test?node-id=1-2', notes: null }],
    viewport: { width: 1440, height: 900 },
    manager: 'antigravity',
    builder: 'antigravity',
    managerModel: null,
    builderModel: null,
    previewUrl: null,
    sessionId: null,
    sessions: null,
    continueSession: null,
    autonomous: null,
    completedPages: null,
    pageIndex: null,
    revision: null,
    lastBuild: null,
    usage: null
  };

  const parsed = nativeProjectSchema.parse(input);
  assert.equal(parsed.previewUrl, '');
  assert.equal(parsed.managerModel, '');
  assert.equal(parsed.builderModel, '');
  assert.equal(parsed.sessionId, '');
  assert.deepEqual(parsed.sessions, {});
  assert.equal(parsed.continueSession, false);
  assert.equal(parsed.autonomous, true);
  assert.deepEqual(parsed.completedPages, []);
  assert.equal(parsed.pageIndex, 0);
  assert.equal(parsed.revision, 0);
});

test('collectUsage gives 0 tokens to waiting builder without leaking unrelated Claude project metrics', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-leak-test-'));
  const slug = tmpDir.replace(/[\/\\]+/g, '-');
  const claudeDir = path.join(os.homedir(), '.claude', 'projects', slug);

  try {
    // 1. Simulate an old Claude session in the user project directory with 149k tokens
    await fs.mkdir(claudeDir, { recursive: true });
    const oldSessionFile = path.join(claudeDir, 'old-session.jsonl');
    await fs.writeFile(oldSessionFile, JSON.stringify({
      type: 'cost-state',
      sessionId: 'old-session',
      modelUsage: {
        'claude-opus': { inputTokens: 149476, outputTokens: 3471 }
      }
    }) + '\n');

    // 2. Set up current run directory where Manager is Antigravity (37,262 in, 3,471 out)
    // and Builder is waiting for manager handoff (0 actions, 0 output, waiting log)
    const runDir = path.join(tmpDir, '.align', 'runs', 'active-run-uuid');
    await fs.mkdir(path.join(runDir, 'logs'), { recursive: true });

    await fs.writeFile(path.join(runDir, 'logs', 'manager.log'), [
      'Thinking with high effort...',
      'Tokens: 37,262 in · 3,471 out',
      'Calling MCP tool read_design_context...'
    ].join('\n'));

    await fs.writeFile(path.join(runDir, 'logs', 'builder.log'), [
      'Waiting for the manager to retrieve Figma context and send the implementation prompt.'
    ].join('\n'));

    // 3. Collect usage for this run
    const u = await collectUsage(runDir, {}, {
      project: { manager: 'antigravity', builder: 'antigravity' },
      sessions: {}
    });

    // Manager should report its exact 37,262 in and 3,471 out
    assert.equal(u.manager.input, 37262);
    assert.equal(u.manager.output, 3471);
    assert.equal(u.manager.reported, true);

    // Builder was idle and waiting: MUST NOT inherit leftover 112,214 tokens from old Claude session!
    assert.equal(u.builder.input, 0, 'Idle builder must have 0 input tokens');
    assert.equal(u.builder.output, 0, 'Idle builder must have 0 output tokens');
    assert.equal(u.builder.reported, false, 'Idle builder must not be reported as active');

    // Total must strictly reflect actual active usage
    assert.equal(u.input, 37262);
    assert.equal(u.output, 3471);
  } finally {
    await fs.rm(claudeDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('detectApprovalPrompt handles Claude Code workspace trust prompt and arrow reorder', () => {
  const trustPrompt = `Accessing workspace:

 /Users/aaditya/testttt

 Quick safety check: Is this a project you created or one you trust? (Like your
 own code, a well-known open source project, or work from your team). If not,
 take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel`;

  const res = detectApprovalPrompt(trustPrompt, 'claude');
  assert.ok(res, 'Should detect workspace trust prompt');
  assert.equal(res.detected, true);
  assert.equal(res.type, 'trust-arrow-reorder');
  assert.equal(res.response, '\x1b[B\r');
});


