import fs from 'node:fs/promises';
import path from 'node:path';

// Universal Session Memory Manager for Phiby
// Maintains durable project memory across all AI providers (Claude, Antigravity, Codex)

export async function loadSessionMemory(runDirectory) {
  const file = path.join(runDirectory, 'memory.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveSessionMemory(runDirectory, memory) {
  const file = path.join(runDirectory, 'memory.json');
  const temp = file + '.' + Date.now() + '.tmp';
  try {
    await fs.mkdir(runDirectory, { recursive: true });
    await fs.writeFile(temp, JSON.stringify(memory, null, 2), { mode: 0o600 });
    try {
      await fs.rename(temp, file);
    } catch (err) {
      if (['EPERM', 'EBUSY', 'EXDEV'].includes(err.code) || process.platform === 'win32') {
        await fs.copyFile(temp, file);
        await fs.unlink(temp).catch(() => {});
        return;
      }
      throw err;
    }
  } catch (e) {
    try { await fs.unlink(temp); } catch {}
  }
}

export async function scanProjectFiles(projectDirectory) {
  const found = [];
  const ignore = new Set(['node_modules', '.git', '.align', 'dist', 'build', '.next', 'release', '.vercel', '.DS_Store', 'coverage', '.cache']);

  async function walk(dir, rel = '') {
    if (found.length > 50) return; // Cap at 50 most relevant files for prompt brevity
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink() || ignore.has(ent.name)) continue;
      const subRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (rel.split('/').length < 3) {
          await walk(path.join(dir, ent.name), subRel);
        }
      } else if (ent.isFile()) {
        found.push(subRel);
      }
    }
  }

  await walk(projectDirectory);
  return found;
}

export async function updateSessionMemory(run, eventType, data = {}) {
  if (!run || !run.directory) return;
  const existing = (await loadSessionMemory(run.directory)) || {
    runId: run.id,
    projectName: run.project?.name || 'Project',
    createdAt: run.createdAt || new Date().toISOString(),
    pageIndex: run.pageIndex || 0,
    completedPages: [],
    sessions: {},
    history: []
  };

  existing.updatedAt = new Date().toISOString();
  existing.pageIndex = run.pageIndex;
  existing.revision = run.revision;
  existing.status = run.status;
  existing.continueSession = true;
  existing.history = existing.history || [];
  existing.completedPages = existing.completedPages || [];
  existing.sessions = existing.sessions || {};

  if (run.sessions) {
    existing.sessions = { ...existing.sessions, ...run.sessions };
  }

  if (run.project) {
    existing.providers = { manager: run.project.manager, builder: run.project.builder };
    existing.models = { manager: run.project.managerModel || '', builder: run.project.builderModel || '' };
  }

  existing.lastActiveRole = data.lastActiveRole || run.lastActiveRole || existing.lastActiveRole || (run.status === 'builder' ? 'builder' : 'manager');
  existing.resumeStage = data.resumeStage || run.resumeStage || existing.resumeStage || (existing.lastActiveRole === 'builder' ? 'builder' : 'manager');

  if (eventType === 'builder_done') {
    existing.lastActiveRole = 'manager';
    existing.resumeStage = 'manager';
    existing.lastBuild = {
      summary: data.summary || '',
      previewPath: data.previewPath || '/',
      checks: data.checks || [],
      timestamp: new Date().toISOString()
    };
    existing.history.push({
      type: 'builder_build',
      page: run.pageIndex + 1,
      summary: data.summary,
      timestamp: new Date().toISOString()
    });
  } else if (eventType === 'manager_review') {
    existing.lastActiveRole = 'manager';
    existing.resumeStage = 'manager';
    existing.lastReview = {
      action: data.type,
      summary: data.summary || '',
      issues: data.issues || [],
      timestamp: new Date().toISOString()
    };
    existing.history.push({
      type: 'manager_review',
      page: run.pageIndex + 1,
      action: data.type,
      summary: data.summary,
      timestamp: new Date().toISOString()
    });
  } else if (eventType === 'page_completed') {
    existing.lastActiveRole = 'manager';
    existing.resumeStage = 'manager';
    const pageName = run.project?.pages?.[run.pageIndex]?.name || `Page ${run.pageIndex + 1}`;
    if (!existing.completedPages.some(p => p.index === run.pageIndex)) {
      existing.completedPages.push({
        index: run.pageIndex,
        name: pageName,
        summary: data.summary || 'Verified and completed',
        checks: data.checks || [],
        completedAt: new Date().toISOString()
      });
    }
    existing.history.push({
      type: 'page_completed',
      page: run.pageIndex + 1,
      name: pageName,
      timestamp: new Date().toISOString()
    });
  } else if (eventType === 'session_detected') {
    existing.sessions = existing.sessions || {};
    if (data.role && data.sessionId) existing.sessions[data.role] = data.sessionId;
    if (data.provider && data.role && data.sessionId) existing.sessions[data.provider + ':' + data.role] = data.sessionId;
  } else if (eventType === 'manager_build') {
    existing.lastActiveRole = 'builder';
    existing.resumeStage = 'builder';
    existing.history.push({
      type: 'manager_build_task',
      page: run.pageIndex + 1,
      promptSnippet: (data.prompt || '').slice(0, 150),
      timestamp: new Date().toISOString()
    });
  } else if (eventType === 'session_continued' || eventType === 'session_paused' || eventType === 'session_stopped') {
    existing.history.push({
      type: eventType,
      page: run.pageIndex + 1,
      lastActiveRole: existing.lastActiveRole,
      timestamp: new Date().toISOString()
    });
  }

  // Keep history bounded
  if (existing.history.length > 30) {
    existing.history = existing.history.slice(-30);
  }

  // Scan current project files
  if (run.project?.directory) {
    existing.projectFiles = await scanProjectFiles(run.project.directory);
  }

  await saveSessionMemory(run.directory, existing);
  return existing;
}

export function formatMemoryContext(run, memory, role) {
  if (!memory) return '';
  const lines = [
    '================================================================================',
    `[PERSISTENT SESSION MEMORY: CONTINUING SESSION #${(run.id || '').slice(0, 8)}]`,
    `Project: ${run.project?.name || 'Project'} | Continuing active development from stored state.`,
    `Current Page: Page ${(run.pageIndex || 0) + 1} of ${run.project?.pages?.length || 1} (${run.project?.pages?.[run.pageIndex || 0]?.name || 'Current'})`
  ];

  if (run.providerHandoff?.[role]) {
    const handoff = run.providerHandoff[role];
    lines.push('\n================================================================================');
    lines.push(`[SEAMLESS PROVIDER HANDOFF: ${handoff.to.toUpperCase()} TAKING OVER FROM ${handoff.from.toUpperCase()}]`);
    lines.push(`You are taking over development as the ${role === 'builder' ? 'Implementation Builder' : 'Design Manager'} using ${handoff.to}.`);
    lines.push(`The previous model/provider (${handoff.from}) handed off to you. Full workspace state and memory are preserved.`);
    lines.push('Directives: Continue seamlessly from existing files and public assets in the project. DO NOT restart or wipe.');
    lines.push('================================================================================');
  } else if (run.modelHandoff?.[role]) {
    const handoff = run.modelHandoff[role];
    lines.push('\n================================================================================');
    lines.push(`[SEAMLESS MODEL UPDATE: ${handoff.to.toUpperCase()} TAKING OVER FROM ${handoff.from.toUpperCase()}]`);
    lines.push(`You are taking over development as the ${role === 'builder' ? 'Implementation Builder' : 'Design Manager'} using model ${handoff.to}.`);
    lines.push(`The previous model (${handoff.from}) handed off to you. Full workspace state and memory are preserved.`);
    lines.push('Directives: Continue seamlessly from existing files and public assets in the project. DO NOT restart or wipe.');
    lines.push('================================================================================');
  }

  if (memory.completedPages && memory.completedPages.length > 0) {
    lines.push('\nCOMPLETED PAGES (MUST PRESERVE):');
    for (const p of memory.completedPages) {
      lines.push(`- Page ${p.index + 1} (${p.name}): ${p.summary}`);
    }
  }

  if (memory.projectFiles && memory.projectFiles.length > 0) {
    lines.push('\nEXISTING PROJECT CODEBASE (ALREADY INITIALIZED):');
    lines.push(`Files present in project root: ${memory.projectFiles.slice(0, 25).join(', ')}${memory.projectFiles.length > 25 ? ` (+${memory.projectFiles.length - 25} more)` : ''}`);
  }

  if (memory.lastBuild) {
    lines.push(`\nLAST BUILD STATUS:`);
    lines.push(`Summary: ${memory.lastBuild.summary}`);
    if (memory.lastBuild.checks?.length) {
      lines.push(`Checks passed: ${memory.lastBuild.checks.join('; ')}`);
    }
  }

  if (memory.lastReview) {
    lines.push(`\nLAST MANAGER REVIEW:`);
    lines.push(`Verdict/Action: ${memory.lastReview.action}`);
    if (memory.lastReview.summary) lines.push(`Notes: ${memory.lastReview.summary}`);
  }

  const activeRole = memory.lastActiveRole || (memory.resumeStage === 'builder' ? 'builder' : 'manager');
  lines.push(`\nLAST ACTIVE AGENT: ${activeRole.toUpperCase()}`);
  if (activeRole === 'builder') {
    lines.push('The Manager already retrieved Figma designs, extracted assets, and submitted the implementation task to the Builder.');
    if (role === 'builder') {
      lines.push('Directives: Continue implementing the pending task directly from handoff.json and existing files. Do NOT wait for the manager.');
    } else {
      lines.push('Directives: The Builder is currently executing the task. Do NOT overwrite or call tools now. Wait for builder completion.');
    }
  } else {
    lines.push('The Manager was last working. Continue design inspection, prompt creation, or review from the saved context.');
  }

  lines.push('\nSESSION CONTINUATION DIRECTIVES:');
  lines.push('1. You are actively continuing from this saved session. All prior work is preserved in the project.');
  lines.push('2. DO NOT restart from scratch, re-initialize dependencies, or discard existing components.');
  lines.push('3. Inspect the existing project files and pick up immediately from where the previous turn left off.');
  lines.push('================================================================================\n');

  return lines.join('\n');
}

// Extract live provider session IDs from streamed terminal text
export function detectProviderSession(role, provider, text) {
  if (!text || typeof text !== 'string') return null;

  if (provider === 'claude') {
    // Look for UUID patterns commonly output by Claude Code
    const match = text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
    if (match) return match[1];
  } else if (provider === 'antigravity') {
    // Look for conversation ID patterns
    const match = text.match(/(?:conversation(?:_id)?)\s*[:=]\s*([a-zA-Z0-9_-]{8,64})/i) ||
                  text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
    if (match) return match[1];
  } else if (provider === 'codex') {
    const match = text.match(/(?:thread(?:_id)?|session(?:_id)?)\s*[:=]\s*([a-zA-Z0-9_-]{8,64})/i);
    if (match) return match[1];
  }

  return null;
}
