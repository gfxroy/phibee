import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { PageQueue, nativeProjectSchema } from '../desktop/queue.js';
import { pageDirectory } from '../desktop/prompts.js';
import { collectUsage } from '../desktop/usage.js';

async function createQueueFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phibee-responsive-test-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(
    path.join(project, 'responsive-guide.md'),
    '# TEST RESPONSIVE BLUEPRINT GUIDE\nBreakpoints: 768px, 480px. Stack hero container and navigation menu.'
  );
  const opened = [], sent = [];

  const q = new PageQueue({
    dataDir: path.join(root, 'state'),
    projectsDir: root,
    interval: 100000,
    launch: async (role, provider, cwd, prompt, onData, onExit, options) => {
      opened.push({ role, provider, prompt, onExit, options });
      let isAlive = true;
      return {
        send: async p => sent.push({ role, prompt: p }),
        kill() { isAlive = false; onExit?.(); },
        resize() {},
        write() {}
      };
    },
    capture: async (url, viewport, dir) => ({
      url,
      viewport,
      screenshot: path.join(dir, 'render.png'),
      report: path.join(dir, 'geometry.json'),
      errors: [],
      overflow: false
    })
  });

  await q.init();
  await q.start({
    name: 'ResponsiveTestSite',
    directory: project,
    prompt: 'Build landing page',
    manager: 'claude',
    builder: 'antigravity',
    responsiveProvider: 'claude',
    responsiveModel: 'sonnet',
    viewport: { width: 1440, height: 900 },
    pages: [{ name: 'Home', url: 'https://www.figma.com/design/xyz/site?node-id=1-1' }]
  });

  const reference = async () => {
    await fs.writeFile(path.join(pageDirectory(q.run), 'reference.png'), PNG.sync.write(new PNG({ width: 20, height: 20 })));
  };

  return {
    q,
    root,
    project,
    opened,
    sent,
    reference,
    close: async () => {
      await q.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

test('nativeProjectSchema validates responsiveProvider and responsiveModel defaults and values', () => {
  const parsedDefault = nativeProjectSchema.parse({
    name: 'Test Project',
    manager: 'claude',
    builder: 'antigravity',
    viewport: { width: 1440, height: 900 },
    pages: [{ name: 'Home', url: 'https://www.figma.com/design/test/site?node-id=1-1' }]
  });
  assert.equal(parsedDefault.responsiveProvider, 'claude');
  assert.equal(parsedDefault.responsiveModel, '');

  const parsedCustom = nativeProjectSchema.parse({
    name: 'Custom Project',
    manager: 'codex',
    builder: 'claude',
    responsiveProvider: 'antigravity',
    responsiveModel: 'gemini-3.8-flash-high',
    viewport: { width: 1440, height: 900 },
    pages: [{ name: 'Home', url: 'https://www.figma.com/design/test/site?node-id=1-1' }]
  });
  assert.equal(parsedCustom.responsiveProvider, 'antigravity');
  assert.equal(parsedCustom.responsiveModel, 'gemini-3.8-flash-high');
});

test('responsive agent dedicated pause, resume, and stop maintain granular state', async () => {
  const f = await createQueueFixture();
  try {
    const q = f.q;
    // 1. Start responsive agent
    await q.startResponsive();
    assert.equal(q.state().responsiveRunning, true);
    assert.equal(q.state().responsivePaused, false);
    assert.equal(q.run.lastActiveRole, 'responsive');

    // 2. Pause responsive agent
    q.pauseResponsive();
    assert.equal(q.state().responsiveRunning, false);
    assert.equal(q.state().responsivePaused, true);
    assert.equal(q.run.responsivePaused, true);
    assert.equal(q.run.lastActiveRole, 'responsive');

    // 3. Resume responsive agent via dedicated resume
    await q.resumeResponsive();
    assert.equal(q.state().responsiveRunning, true);
    assert.equal(q.state().responsivePaused, false);
    assert.equal(q.run.responsivePaused, false);

    // 4. Stop responsive agent
    q.stopResponsive();
    assert.equal(q.state().responsiveRunning, false);
    assert.equal(q.state().responsivePaused, false);
    assert.equal(q.run.responsivePaused, false);
  } finally {
    await f.close();
  }
});

test('global pause and resume seamlessly remembers responsive agent when it was last active', async () => {
  const f = await createQueueFixture();
  try {
    const q = f.q;
    // 1. Start responsive agent
    await q.startResponsive();
    assert.equal(q.state().responsiveRunning, true);
    assert.equal(q.run.lastActiveRole, 'responsive');

    // 2. Global pause called from workspace action group
    await q.pause('Global pause requested');
    assert.equal(q.run.status, 'paused');
    assert.equal(q.run.responsivePaused, true);
    assert.equal(q.run.lastActiveRole, 'responsive');
    assert.equal(q.state().responsiveRunning, false);
    assert.equal(q.state().responsivePaused, true);

    // 3. Global resume called from workspace action group
    const resState = await q.resume();
    assert.equal(resState.responsiveRunning, true);
    assert.equal(resState.responsivePaused, false);
    assert.equal(q.run.lastActiveRole, 'responsive');
  } finally {
    await f.close();
  }
});

test('global pause and resume resumes builder when builder was last active, not responsive', async () => {
  const f = await createQueueFixture();
  try {
    const q = f.q;
    await f.reference();
    await q.handleManager({ ticket: q.run.ticket, type: 'build', prompt: 'Implement Home using saved image assets' });
    assert.equal(q.run.status, 'builder');
    assert.equal(q.run.lastActiveRole, 'builder');

    await q.pause('Paused on builder');
    assert.equal(q.run.status, 'paused');
    assert.equal(q.run.lastActiveRole, 'builder');
    assert.equal(q.run.responsivePaused, false);

    await q.resume();
    assert.equal(q.run.status, 'builder');
    assert.equal(q.state().responsiveRunning, false);
  } finally {
    await f.close();
  }
});

test('collectUsage accounts for responsive agent tokens from usage files', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phibee-usage-test-'));
  try {
    const respUsageDir = path.join(tmpDir, 'usage', 'responsive');
    await fs.mkdir(respUsageDir, { recursive: true });

    await fs.writeFile(
      path.join(respUsageDir, '001.json'),
      JSON.stringify({ role: 'responsive', session: 'resp-sess-1', input: 4500, output: 1200 })
    );

    const usage = await collectUsage(tmpDir, {}, {});
    assert.equal(usage.responsive.input, 4500);
    assert.equal(usage.responsive.output, 1200);
    assert.equal(usage.input, 4500);
    assert.equal(usage.output, 1200);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('generateResponsiveGuide generates blueprint and passes it to responsive agent prompt', async () => {
  const f = await createQueueFixture();
  try {
    const q = f.q;
    const guidePath = path.join(f.project, 'responsive-guide.md');
    await fs.writeFile(guidePath, '# RESPONSIVE BLUEPRINT\nBreakpoints: 768px, 480px. Stack hero container and navigation menu.', 'utf8');

    const guideContent = await q.generateResponsiveGuide();
    assert.ok(guideContent);
    assert.match(guideContent, /RESPONSIVE BLUEPRINT/);

    await q.startResponsive();
    const responsiveLaunch = f.opened.find(x => x.role === 'responsive');
    assert.ok(responsiveLaunch);
    assert.match(responsiveLaunch.prompt, /RESPONSIVE BLUEPRINT/);
    assert.match(responsiveLaunch.prompt, /PRESERVE DESKTOP/);
  } finally {
    await f.close();
  }
});

test('responsive agent active state appears in state().activeRuns with status responsive', async () => {
  const f = await createQueueFixture();
  try {
    const q = f.q;
    await q.startResponsive();
    const st = q.state();
    assert.equal(st.responsiveRunning, true);
    const rId = q.run.sessionId || q.run.id;
    assert.ok(st.activeRuns[rId]);
    assert.equal(st.activeRuns[rId].status, 'responsive');
    assert.match(st.activeRuns[rId].message, /Responsive agent/);
  } finally {
    await f.close();
  }
});

test('builder handoff invalidates previous guideGenerated flag', async () => {
  const f = await createQueueFixture();
  try {
    const q = f.q;
    q.run.guideGenerated = true;
    await f.reference();
    await q.handleManager({ ticket: q.run.ticket, type: 'build', prompt: 'Implement Home using saved image assets' });
    assert.equal(q.run.guideGenerated, false);
  } finally {
    await f.close();
  }
});
