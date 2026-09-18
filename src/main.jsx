import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  ArrowRight, ArrowUp, ArrowDown, Plus, X, Folder, ChevronDown, ChevronLeft, ChevronRight,
  Play, Pause, Square, Loader2, Code, FolderTree, ExternalLink, RefreshCw,
  Sparkles, Bot, Zap, Check, Search, Smartphone
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import beeAvatar from '../bee.png';

const native = window.align;
const names = { codex: 'codex', claude: 'Claude Code', antigravity: 'Antigravity' };

const PROVIDER_MODELS = {
  antigravity: [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
    { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
    { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
    { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)' },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
    { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
  ],
  claude: [
    { id: 'sonnet', label: 'Claude Sonnet 5' },
    { id: 'opus', label: 'Claude Opus 5' },
    { id: 'fable', label: 'Claude Fable 5.1' },
    { id: 'haiku', label: 'Claude Haiku 4.5' }
  ],
  codex: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'o3-mini', label: 'o3-mini' },
    { id: 'o1', label: 'o1' }
  ]
};

function getFullModelName(provider, modelId) {
  if (!modelId) {
    if (provider === 'claude') return 'Claude Sonnet 5';
    if (provider === 'codex') return 'GPT-4o';
    return 'Gemini 3.8 Flash';
  }
  for (const list of Object.values(PROVIDER_MODELS)) {
    const match = list.find(m => m.id === modelId);
    if (match) return match.label;
  }
  const map = {
    sonnet: 'Claude Sonnet 5',
    opus: 'Claude Opus 5',
    fable: 'Claude Fable 5.1',
    haiku: 'Claude Haiku 4.5',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6 (Thinking)',
    'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
    'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
    'gemini-3.8-flash-medium': 'Gemini 3.8 Flash (Medium)',
    'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)',
    'gemini-3.7-flash-high': 'Gemini 3.7 Flash (High)',
    'gemini-3.7-flash-medium': 'Gemini 3.7 Flash (Medium)',
    'gemini-3.7-flash-low': 'Gemini 3.7 Flash (Low)',
    'gemini-3.6-flash-high': 'Gemini 3.6 Flash (High)',
    'gemini-3.6-flash-medium': 'Gemini 3.6 Flash (Medium)',
    'gemini-3.6-flash-low': 'Gemini 3.6 Flash (Low)',
    'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
    'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
    'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
    'gpt-4o': 'GPT-4o',
    'o3-mini': 'o3-mini',
    'o1': 'o1'
  };
  return map[modelId] || modelId;
}

function ModelDropdown({ role, provider, value, onChange, liveModels = null }) {
  const models = (liveModels && liveModels.length > 0) ? liveModels : (PROVIDER_MODELS[provider] || []);
  const defaultLabel = provider === 'antigravity'
    ? 'Gemini 3.8 Flash'
    : provider === 'claude'
    ? 'Claude Sonnet 5'
    : 'GPT-4o';

  const isValid = !value || models.some(m => m.id === value);
  const selectValue = isValid ? (value || '') : '';

  return (
    <div className="black-capsule-select">
      <select
        aria-label={`${role === 'manager' ? 'Manager' : role === 'responsive' ? 'Responsive' : 'Builder'} Model`}
        value={selectValue}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">Default ({defaultLabel})</option>
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.label || m.id}
          </option>
        ))}
      </select>
      <ChevronDown size={18} strokeWidth={2.4} className="capsule-chevron" />
    </div>
  );
}
const emptyProject = () => ({
  name: '',
  stack: 'react',
  directory: '',
  prompt: '',
  instructionMode: 'single',
  pages: [{ name: 'Home', url: '', notes: '' }],
  viewport: { width: 1440, height: 900 },
  manager: 'codex',
  builder: 'antigravity',
  managerModel: '',
  builderModel: '',
  responsiveProvider: 'claude',
  responsiveModel: '',
  autonomous: true
});

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem('align-native-draft')) || emptyProject();
    if (d.autonomous === undefined) {
      const saved = localStorage.getItem('phiby-autonomous');
      d.autonomous = saved !== null ? saved === 'true' : true;
    }
    if (!d.responsiveProvider) d.responsiveProvider = 'claude';
    if (d.responsiveModel === undefined) d.responsiveModel = '';
    return d;
  } catch {
    return emptyProject();
  }
}

// Half-filled circle dark mode toggle icon matching Figma Vector [33x33]
function ThemeIcon() {
  return (
    <svg className="theme-toggle-icon" width="26" height="26" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 2 A 10 10 0 0 1 12 22 Z" fill="currentColor" />
    </svg>
  );
}

function cleanTerminalText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\].*?(\x07|\x1b\\)/g, '')
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function AgentTerminal({
  role,
  provider,
  model,
  sessionId,
  theme,
  run,
  state,
  onBack,
  onStart,
  onPause,
  onResume,
  onStop,
  isPaused,
  isRunning
}) {
  const element = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [message, setMessage] = useState('');
  const [isExpanded, setIsExpanded] = useState(role === 'builder' || role === 'responsive');
  const [lastLine, setLastLine] = useState('');

  const getThemeConfig = () => ({
    background: '#0a0b0d',
    foreground: '#ffffff',
    cursor: '#ffffff',
    selectionBackground: 'rgba(255,255,255,0.25)',
    black: '#000000',
    brightBlack: '#666666',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#ffffff'
  });

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getThemeConfig();
    }
  }, [theme]);

  useEffect(() => {
    if (!native) return;
    let disposed = false, ready = false;
    const terminal = new Terminal({
      fontFamily: "'Iosevka Charon', 'Iosevka', 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
      theme: getThemeConfig()
    });
    terminalRef.current = terminal;

    const fit = new FitAddon();
    fitAddonRef.current = fit;
    terminal.loadAddon(fit);
    if (element.current) {
      element.current.innerHTML = '';
      terminal.open(element.current);
    }
    terminal.attachCustomKeyEventHandler(e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && terminal.hasSelection()) {
        navigator.clipboard?.writeText(terminal.getSelection());
        return false;
      }
      return true;
    });

    const earlyQueue = [];
    const off = native.onTerminal(event => {
      if (event.role === role) {
        const clean = cleanTerminalText(event.data).trim();
        if (clean) {
          const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            setLastLine(lines[lines.length - 1].slice(0, 140));
          }
        }
        if (ready) {
          terminal.write(event.data);
        } else {
          earlyQueue.push(event.data);
        }
      }
    });

    native.attach(role).then(buffer => {
      if (disposed) return;
      if (buffer) {
        terminal.write(buffer);
        const clean = cleanTerminalText(buffer).trim();
        if (clean) {
          const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            setLastLine(lines[lines.length - 1].slice(0, 140));
          }
        }
      }
      ready = true;
      while (earlyQueue.length > 0) {
        terminal.write(earlyQueue.shift());
      }
    }).catch(() => {
      ready = true;
      while (earlyQueue.length > 0) {
        terminal.write(earlyQueue.shift());
      }
    });

    const sendSize = () => {
      if (disposed || !element.current) return;
      try {
        fit.fit();
        if (terminal.cols > 0 && terminal.rows > 0) {
          native.resize(role, terminal.cols, terminal.rows);
        }
      } catch {}
    };

    let observer = null;
    if (element.current) {
      observer = new ResizeObserver(sendSize);
      observer.observe(element.current);
      sendSize();
      setTimeout(sendSize, 80);
    }

    const input = terminal.onData(data => native.input(role, data));
    return () => {
      disposed = true;
      off();
      observer?.disconnect();
      input.dispose();
      terminal.dispose();
    };
  }, [role, provider, sessionId]);

  useEffect(() => {
    if (isExpanded && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current.fit();
          if (terminalRef.current && terminalRef.current.cols > 0 && terminalRef.current.rows > 0) {
            native.resize(role, terminalRef.current.cols, terminalRef.current.rows);
          }
        } catch {}
      }, 60);
    }
  }, [isExpanded, role]);

  const roleTitle = role === 'builder' ? 'Builder' : (role === 'responsive' ? 'Responsive Maker' : 'Manager');

  let steps = [];
  let currentStepIndex = 0;
  let processBadge = 'STANDBY';
  let processTitle = '';
  let processDescription = '';

  const isWebsiteBuilt = Boolean(run?.previewUrl || run?.lastBuild?.previewUrl || run?.project?.previewUrl);
  const isGuideGen = Boolean(state?.guideGenerating || run?.guideGenerating);

  if (role === 'manager') {
    steps = [
      { id: 'import', label: 'Figma Import' },
      { id: 'context', label: 'Context & Assets' },
      { id: 'handoff', label: 'Design Handoff' },
      { id: 'review', label: 'Review & Parity' }
    ];
    if (run?.status === 'manager') {
      processBadge = 'ACTIVE';
      currentStepIndex = run?.reference ? 2 : 1;
      processTitle = currentStepIndex === 2 ? 'Formulating Design Handoff' : 'Analyzing Figma Architecture';
      processDescription = run?.message || 'Manager is inspecting Figma frame nodes, extracting styles, typography, and preparing builder instructions.';
    } else if (run?.status === 'verifying') {
      processBadge = 'REVIEWING';
      currentStepIndex = 3;
      processTitle = 'Reviewing Visual Implementation';
      processDescription = 'Comparing captured browser render against Figma reference screenshot.';
    } else if (run?.status === 'builder') {
      processBadge = 'MONITORING';
      currentStepIndex = 2;
      processTitle = 'Standing By For Builder';
      processDescription = 'Design handoff completed. Standing by for builder completion and live preview.';
    } else if (run?.status === 'completed') {
      processBadge = 'APPROVED';
      currentStepIndex = 3;
      processTitle = 'Design Verified & Approved';
      processDescription = 'All pages and components verified successfully.';
    } else {
      processBadge = isPaused ? 'PAUSED' : 'READY';
      currentStepIndex = 0;
      processTitle = 'Manager Ready';
      processDescription = isPaused ? 'Session paused. Click Resume to continue.' : 'Standing by for project start.';
    }
  } else if (role === 'builder') {
    steps = [
      { id: 'setup', label: 'Scaffold & Config' },
      { id: 'layout', label: 'Layout & Structure' },
      { id: 'styling', label: 'Styles & Motion' },
      { id: 'preview', label: 'Live Preview Ready' }
    ];
    if (run?.status === 'builder') {
      processBadge = 'BUILDING';
      currentStepIndex = isWebsiteBuilt ? 2 : 1;
      processTitle = isWebsiteBuilt ? 'Refining Styling & Interactions' : 'Building HTML & Components';
      processDescription = run?.message || 'Builder is actively generating code, styling, and assembling project files.';
    } else if (isWebsiteBuilt) {
      processBadge = 'LIVE PREVIEW';
      currentStepIndex = 3;
      processTitle = 'Website Preview Online';
      processDescription = `Vite preview is running at ${run?.previewUrl || run?.lastBuild?.previewUrl || 'localhost'}.`;
    } else if (run?.status === 'manager') {
      processBadge = 'AWAITING HANDOFF';
      currentStepIndex = 0;
      processTitle = 'Waiting For Manager';
      processDescription = 'Awaiting Figma styles, components, reference screenshot, and instructions from Manager.';
    } else {
      processBadge = isPaused ? 'PAUSED' : 'STANDBY';
      currentStepIndex = 0;
      processTitle = 'Builder Ready';
      processDescription = isPaused ? 'Session paused. Click Resume to continue.' : 'Ready to build upon design handoff.';
    }
  } else {
    // responsive (Responsive Maker)
    steps = [
      { id: 'audit', label: 'Structure Audit' },
      { id: 'tablet', label: 'Tablet (768px)' },
      { id: 'mobile', label: 'Mobile (375px)' },
      { id: 'zero', label: 'Zero Overflow' }
    ];
    if (isGuideGen) {
      processBadge = 'BLUEPRINT';
      currentStepIndex = 0;
      processTitle = 'Generating Responsive Blueprint';
      processDescription = 'Manager is inspecting the website DOM and styling to produce responsive-guide.md.';
    } else if (isRunning) {
      processBadge = 'OPTIMIZING';
      currentStepIndex = 2;
      processTitle = 'Applying Responsive Media Queries';
      processDescription = 'Injecting mobile & tablet breakpoints, converting flex/grid rows to columns, scaling headers.';
    } else if (isPaused) {
      processBadge = 'PAUSED';
      currentStepIndex = 1;
      processTitle = 'Responsive Maker Paused';
      processDescription = 'Responsive styling paused. Click Resume to continue.';
    } else if (run?.guideGenerated) {
      processBadge = 'BLUEPRINT READY';
      currentStepIndex = 1;
      processTitle = 'Responsive Blueprint Ready';
      processDescription = 'Design blueprint prepared. Click Start to launch Responsive Maker.';
    } else {
      processBadge = 'READY';
      currentStepIndex = 0;
      processTitle = 'Responsive Maker Ready';
      processDescription = 'Ready to optimize website across mobile (375px), tablet (768px), and desktop screen sizes. Click Start when ready.';
    }
  }

  return (
    <section className={`agent-process-card ${role} ${isExpanded ? 'expanded' : ''}`}>
      {/* Top Header Row */}
      <div className="process-card-header">
        <div className="card-header-left">
          <span className="capsule-pill role-pill">{roleTitle}</span>
          <span className="capsule-pill model-tag-pill">{getFullModelName(provider, model)}</span>
        </div>

        <div className="card-header-right">
          {onBack && (
            <button
              type="button"
              className="responsive-back-pill"
              onClick={onBack}
              title="Return to Manager & Builder terminals"
            >
              ← Back
            </button>
          )}

          {role === 'responsive' && (
            <div className="responsive-header-controls">
              {!isRunning && !isPaused ? (
                <button
                  type="button"
                  className="responsive-header-action-btn start"
                  onClick={onStart}
                  title="Start Responsive Maker"
                >
                  <Play size={11} fill="currentColor" />
                  <span>Start</span>
                </button>
              ) : isPaused ? (
                <button
                  type="button"
                  className="responsive-header-action-btn resume"
                  onClick={onResume}
                  title="Resume Responsive Maker"
                >
                  <Play size={11} fill="currentColor" />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="responsive-header-action-btn pause"
                  onClick={onPause}
                  title="Pause Responsive Maker"
                >
                  <Pause size={11} fill="currentColor" />
                  <span>Pause</span>
                </button>
              )}

              <button
                type="button"
                className="responsive-header-action-btn stop"
                onClick={onStop}
                title="Stop Responsive Maker"
                disabled={!isRunning && !isPaused}
              >
                <Square size={10} fill="currentColor" />
                <span>Stop</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hero: Hovering Bee + Active Process Narrative */}
      <div className="process-hero-section">
        <div className="bee-visual-unit" title="Phibee AI Agent">
          <div className="bee-glow-halo" />
          <img src={beeAvatar} alt="Phibee Bee" className="bee-hover-avatar" />
          <div className="bee-shadow-pulse" />
        </div>

        <div className="process-narrative-block">
          <h3 className="process-headline">{processTitle}</h3>
          <p className="process-description">{processDescription}</p>
        </div>
      </div>

      {/* Visual Timeline Stepper */}
      <div className="process-timeline-stepper">
        {steps.map((step, idx) => {
          const isDone = idx < currentStepIndex;
          const isActive = idx === currentStepIndex && (isRunning || run?.status === role);
          return (
            <div
              key={step.id}
              className={`timeline-step-item ${isDone ? 'completed' : ''} ${isActive ? 'active' : ''}`}
            >
              <div className="timeline-node">
                {isDone ? (
                  <Check size={12} strokeWidth={3} className="step-check-icon" />
                ) : (
                  <span className="step-number">{idx + 1}</span>
                )}
                {isActive && <div className="step-pulse-ring" />}
              </div>
              <span className="timeline-step-label">{step.label}</span>
              {idx < steps.length - 1 && (
                <div className={`timeline-connector-bar ${isDone ? 'filled' : ''}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Collapsible Terminal Card */}
      <div className={`terminal-collapsible-drawer ${isExpanded ? 'open' : 'collapsed'}`}>
        <div
          className="terminal-collapsed-bar"
          style={{ display: isExpanded ? 'none' : 'flex' }}
          onClick={() => setIsExpanded(true)}
          role="button"
          tabIndex={0}
          title="Click to expand live terminal"
        >
          <div className="collapsed-bar-left">
            <span className="terminal-badge-icon">&gt;_</span>
            <span className="collapsed-role-title">{roleTitle} Console</span>
            <span className="collapsed-preview-line">
              {lastLine ? lastLine : (isRunning ? 'Terminal stream active… click to expand' : 'Console idle · click to expand')}
            </span>
          </div>
          <button
            type="button"
            className="collapsed-expand-btn"
            onClick={e => {
              e.stopPropagation();
              setIsExpanded(true);
            }}
          >
            Expand Console ↗
          </button>
        </div>

        <div className="terminal-expanded-body" style={{ display: isExpanded ? 'flex' : 'none' }}>
          <div className="expanded-topbar">
            <div className="topbar-left">
              <span className="terminal-badge-icon">&gt;_</span>
              <span className="expanded-role-title">{roleTitle} Terminal</span>
            </div>
            <div className="topbar-right">
              <button
                type="button"
                className="drawer-action-btn"
                onClick={() => terminalRef.current?.clear()}
              >
                Clear
              </button>
              <button
                type="button"
                className="drawer-action-btn collapse-trigger"
                onClick={() => setIsExpanded(false)}
              >
                Collapse ↘
              </button>
            </div>
          </div>

          <div className="terminal-body-pane" ref={element} />

          <form
            className="terminal-bottom-input-bar"
            onSubmit={e => {
              e.preventDefault();
              if (message.trim()) {
                native.input(role, message.replaceAll('\x1b', '') + '\r');
                setMessage('');
              }
            }}
          >
            <input
              aria-label={`Message ${roleTitle}`}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={`Message ${roleTitle}…`}
            />
            <button
              type="submit"
              aria-label={`Send to ${roleTitle}`}
              disabled={!message.trim()}
              className="circular-arrow-btn"
            >
              <ArrowUp size={18} strokeWidth={2.6} />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('phibee-theme') || localStorage.getItem('phiby-theme') || 'dark');
  const [form, setForm] = useState(readDraft);
  const [state, setState] = useState({ projects: [], run: null, activeRuns: {} });
  const [screen, setScreen] = useState('setup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sidebarTab, setSidebarTab] = useState('projects'); // 'projects' | 'live'
  const [workspaceView, setWorkspaceView] = useState('terminal'); // 'terminal' | 'website'
  const [showOptions, setShowOptions] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [projectFiles, setProjectFiles] = useState([]);
  const [liveModelsByProvider, setLiveModelsByProvider] = useState({ antigravity: null, claude: null, codex: null });
  const [viewedLiveSessions, setViewedLiveSessions] = useState(() => new Set());
  const iframeRef = useRef(null);
  const optionsRef = useRef(null);
  const promptRef = useRef(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('phibee-notifications') !== 'false');
  const [autonomousEnabled, setAutonomousEnabled] = useState(() => localStorage.getItem('phibee-autonomous') !== 'false');
  const [approvalPrompt, setApprovalPrompt] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef(null);
  const showToast = (msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 4500);
  };

  useEffect(() => {
    if (!native?.onApproval) return;
    return native.onApproval(prompt => {
      setApprovalPrompt(prompt);
    });
  }, []);

  const handleStartResponsive = async () => {
    if (state.guideGenerating || run?.guideGenerating) {
      showToast('Manager is analyzing website structure and preparing responsive design guide. Please wait...');
      return;
    }
    try {
      await native.startResponsive?.();
    } catch (err) {
      console.error('Failed to start responsive maker:', err);
      showToast('Could not start Responsive Maker: ' + (err.message || err));
    }
  };
  const run = state.run;
  const responsiveRunning = Boolean(state.terminals?.includes('responsive') || state.responsiveRunning);
  const isGuideGenerating = Boolean(state.guideGenerating || run?.guideGenerating);
  const isFormForNewProject = !form.id && !form.sessionId && !form.continueSession;
  const isSessionLiveRunning = Boolean(
    run &&
    (['manager', 'builder', 'verifying', 'preparing', 'starting'].includes(run.status) || responsiveRunning || isGuideGenerating) &&
    form.sessionId &&
    form.sessionId === (run.sessionId || run.id || run.project?.sessionId || run.project?.id)
  );
  const isCurrentProjectSession = Boolean(
    run && !isFormForNewProject && (
      (form.id && (run.id === form.id || run.project?.id === form.id)) ||
      (form.sessionId && (run.sessionId === form.sessionId || run.project?.sessionId === form.sessionId))
    )
  );
  const hasExistingSession = Boolean(
    !isFormForNewProject && (
      isSessionLiveRunning ||
      (form.continueSession && form.sessionId) ||
      isCurrentProjectSession
    )
  );
  const anySessionRunning = Boolean(
    (run && ['manager', 'builder', 'verifying', 'preparing', 'starting'].includes(run.status)) ||
    responsiveRunning ||
    isGuideGenerating ||
    Object.keys(state.activeRuns || {}).length > 0
  );
  const isWebsiteBuilt = Boolean(
    run?.previewUrl ||
    run?.lastBuild?.previewUrl ||
    run?.memory?.lastBuild?.previewUrl ||
    run?.project?.previewUrl ||
    run?.project?.lastBuild?.previewUrl ||
    run?.status === 'completed' ||
    run?.pages?.some(p => p.status === 'done')
  );
  const [now, setNow] = useState(Date.now());

  // Automatically transition to responsive terminal view when responsive agent launches
  useEffect(() => {
    if (responsiveRunning && workspaceView !== 'responsive' && !isGuideGenerating) {
      setWorkspaceView('responsive');
    }
  }, [responsiveRunning, isGuideGenerating]);

  useEffect(() => {
    if (!native?.heartbeat) return;
    const timer = setInterval(() => {
      native.heartbeat().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (native?.setNotifications) native.setNotifications(notificationsEnabled);
  }, [notificationsEnabled]);

  useEffect(() => {
    if (native?.setAutonomous) native.setAutonomous(autonomousEnabled);
  }, [autonomousEnabled]);

  useEffect(() => {
    if (promptRef.current) {
      promptRef.current.style.height = 'auto';
      promptRef.current.style.height = Math.max(66, promptRef.current.scrollHeight) + 'px';
    }
  }, [form.prompt, form.instructionMode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('phibee-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    const handleClickOutside = e => {
      if (optionsRef.current && !optionsRef.current.contains(e.target)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch models by provider so provider switching is instant without cross-provider bleed
  useEffect(() => {
    if (!native?.models) return;
    for (const p of ['antigravity', 'claude', 'codex']) {
      native.models(p).then(m => {
        if (Array.isArray(m) && m.length > 0) {
          setLiveModelsByProvider(prev => ({ ...prev, [p]: m }));
        }
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!native) return;
    native.state().then(async s => {
      setState(s);
      if (s.run && ['manager', 'builder', 'verifying', 'preparing'].includes(s.run.status)) {
        setScreen('work');
      } else {
        const rememberedId = localStorage.getItem('phibee-selected-session-id') || localStorage.getItem('phiby-selected-session-id');
        let matched = null;
        if (s.run?.project) {
          matched = {
            ...s.run.project,
            id: s.run.project.id || s.run.id,
            sessionId: s.run.sessionId || s.run.id,
            continueSession: true
          };
        } else if (rememberedId && s.projects?.length) {
          matched = s.projects.find(p => p.sessionId === rememberedId || p.id === rememberedId);
        }
        if (!matched && s.projects?.length) {
          matched = s.projects[0];
        }
        if (matched) {
          const sessionId = matched.sessionId || matched.sessions?.builder || matched.sessions?.manager || matched.id;
          const nextForm = {
            ...emptyProject(),
            ...matched,
            id: matched.id || sessionId,
            pages: (matched.pages && matched.pages.length > 0) ? matched.pages : [{ name: 'Home', url: '', notes: '' }],
            instructionMode: matched.instructionMode || 'single',
            sessionId: sessionId || '',
            previewUrl: matched.previewUrl || '',
            managerModel: matched.managerModel || '',
            builderModel: matched.builderModel || '',
            sessions: matched.sessions || {},
            continueSession: Boolean(sessionId)
          };
          setForm(nextForm);
          if (native?.openSession) {
            try {
              const opened = await native.openSession(nextForm);
              setState(opened);
            } catch (err) {
              console.error('Pre-loading session failed:', err);
            }
          }
        }
        setScreen('setup');
      }
    });
    return native.onState(s => setState(s));
  }, []);

  const set = (key, value) => setForm(f => {
    const next = { ...f, [key]: value };
    localStorage.setItem('align-native-draft', JSON.stringify(next));
    return next;
  });

  const setBatch = updates => setForm(f => {
    const next = { ...f, ...updates };
    localStorage.setItem('align-native-draft', JSON.stringify(next));
    return next;
  });

  const selectSession = async p => {
    act(async () => {
      const sessionId = p.sessionId || p.sessions?.builder || p.sessions?.manager || p.id;
      const nextForm = {
        ...emptyProject(),
        ...p,
        id: p.id || sessionId,
        pages: (p.pages && p.pages.length > 0) ? p.pages : [{ name: 'Home', url: '', notes: '' }],
        instructionMode: p.instructionMode || 'single',
        sessionId: sessionId || '',
        previewUrl: p.previewUrl || '',
        managerModel: p.managerModel || '',
        builderModel: p.builderModel || '',
        sessions: p.sessions || {},
        continueSession: Boolean(sessionId)
      };
      setForm(nextForm);
      localStorage.setItem('align-native-draft', JSON.stringify(nextForm));
      if (sessionId) {
        localStorage.setItem('phibee-selected-session-id', sessionId);
        localStorage.setItem('phiby-selected-session-id', sessionId);
      }

      if (native?.openSession) {
        const s = await native.openSession(nextForm);
        setState(s);
      }
      setScreen('setup');
    });
  };

  const loadFiles = async () => {
    if (!showFiles && native?.listFiles) {
      try {
        const files = await native.listFiles();
        setProjectFiles(files || []);
      } catch {}
    }
    setShowFiles(!showFiles);
  };

  const pageChange = (i, key, value) => set('pages', form.pages.map((p, n) => n === i ? { ...p, [key]: value } : p));
  const move = (i, delta) => {
    const pages = [...form.pages];
    [pages[i], pages[i + delta]] = [pages[i + delta], pages[i]];
    set('pages', pages);
  };

  const act = async fn => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setBusy(false);
    }
  };

  const start = e => {
    e.preventDefault();
    if (isSessionLiveRunning && !isFormForNewProject) {
      setScreen('work');
      return;
    }
    act(async () => {
      if (!native) throw Error('Open the Phibee desktop app to launch your coding tools.');
      if (!form.directory) throw Error('Please choose a folder for your project before starting.');
      try {
        if (!isFormForNewProject && run && ['manager', 'builder', 'verifying', 'preparing', 'starting'].includes(run.status)) {
          setScreen('work');
          return;
        }
        const isContinuing = Boolean(form.continueSession && form.sessionId);
        const s = await native.start({
          ...form,
          id: form.id || form.sessionId,
          continueSession: isContinuing,
          sessionId: form.sessionId || '',
          previewUrl: form.previewUrl || '',
          managerModel: form.managerModel || '',
          builderModel: form.builderModel || '',
          notifications: notificationsEnabled,
          autonomous: autonomousEnabled
        });
        setState(s);
        setScreen('work');
        localStorage.removeItem('align-native-draft');
      } catch (e) {
        const s = await native.state();
        setState(s);
        if (s.run) setScreen('work');
        throw e;
      }
    });
  };

  const fresh = () => {
    setForm(emptyProject());
    localStorage.removeItem('align-native-draft');
    localStorage.removeItem('phibee-selected-session-id');
    localStorage.removeItem('phiby-selected-session-id');
    setScreen('setup');
  };

  const paused = run && ['paused', 'blocked'].includes(run.status);
  const done = run?.status === 'completed';

  const uniqueRunsMap = new Map();
  for (const r of Object.values(state.activeRuns || {})) {
    const key = r.sessionId || r.id || r.projectId || r.name;
    if (key && !uniqueRunsMap.has(key)) {
      uniqueRunsMap.set(key, { ...r, key });
    }
  }
  const isResponsiveActive = Boolean(state.responsiveRunning || run?.responsivePaused || state.guideGenerating);
  if (run && (['manager', 'builder', 'starting', 'verifying', 'preparing'].includes(run.status) || isResponsiveActive || (run.status === 'completed' && !viewedLiveSessions.has(run.sessionId || run.id || run.project?.name)))) {
    const key = run.sessionId || run.id || run.project?.id || run.project?.name || form.name;
    if (key && !uniqueRunsMap.has(key)) {
      const dispStatus = state.guideGenerating ? 'guide' : (state.responsiveRunning ? 'responsive' : run.status);
      const dispMsg = state.guideGenerating ? 'Manager is analyzing website structure and preparing responsive guide…' : (state.responsiveRunning ? 'Responsive Maker is active…' : run.message);
      uniqueRunsMap.set(key, {
        id: run.sessionId || run.id || key,
        sessionId: run.sessionId || run.id,
        name: run.project?.name || form.name || 'Current Session',
        status: dispStatus,
        message: dispMsg,
        key
      });
    }
  }
  const activeRunsList = Array.from(uniqueRunsMap.values()).filter(r => !viewedLiveSessions.has(r.key) || ['manager', 'builder', 'starting', 'verifying', 'preparing', 'responsive', 'guide'].includes(r.status));

  // Active page index
  const activePageIndex = run?.pageIndex || 0;
  const pagesList = (run?.pages && run.pages.length > 0)
    ? run.pages
    : (run?.project?.pages && run.project.pages.length > 0)
      ? run.project.pages
      : (form.pages && form.pages.length > 0)
        ? form.pages
        : [{ name: 'LOGIN' }];
  const currentPage = pagesList[activePageIndex] || pagesList[0] || { name: 'LOGIN' };

  const selectedProjectInState = state.projects?.find(p =>
    (form.id && p.id === form.id) ||
    (form.sessionId && (p.sessionId === form.sessionId || p.id === form.sessionId)) ||
    (form.name && p.name === form.name)
  );
  const isFormBuilt = Boolean(
    form.lastBuild ||
    form.previewUrl ||
    form.hasBuilt ||
    (form.completedPages && form.completedPages.length > 0) ||
    selectedProjectInState?.lastBuild ||
    selectedProjectInState?.previewUrl ||
    selectedProjectInState?.hasBuilt ||
    (selectedProjectInState?.completedPages && selectedProjectInState.completedPages.length > 0) ||
    (run && (run.id === form.id || run.sessionId === form.sessionId) && (run.lastBuild || run.previewUrl || run.completedPages?.length > 0))
  );

  const selectedFolderName = (form.directory || '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '';

  return (
    <div className={'app-root ' + (screen === 'work' ? 'workspace-mode' : 'setup-mode')} data-theme={theme}>
      {/* Titlebar Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand-wordmark" onClick={fresh} title="Phibee Home">
            PHIBEE.
          </div>
        </div>

        <div className="header-center">
          {screen === 'setup' ? (
            <div className="home-tagline">
              Give your manager the plan. Let<br />your builder handle the details.
            </div>
          ) : (
            <div className="workspace-project-title">
              {(run?.project?.name || form.name || 'XCOACH').toUpperCase()}
            </div>
          )}
        </div>

        <div className="header-right">
          {isFormBuilt && screen === 'setup' && (
            <button
              type="button"
              className="header-view-website-btn"
              onClick={() => act(async () => {
                if (!native) return;
                if (form.continueSession && form.sessionId && native.openSession) {
                  await native.openSession(form);
                }
                await native.viewWebsite();
              })}
              title="Open built website in browser"
            >
              <span>View Website</span>
              <ExternalLink size={13} strokeWidth={2.4} />
            </button>
          )}

          <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle dark/light mode">
            <ThemeIcon />
          </button>

          {screen === 'work' && (
            <button
              className="header-projects-btn"
              onClick={() => {
                if (run?.project) {
                  setForm(f => ({
                    ...f,
                    ...run.project,
                    id: run.project.id || run.sessionId || run.id,
                    sessionId: run.sessionId || run.id,
                    previewUrl: run.previewUrl || run.lastBuild?.previewUrl || '',
                    manager: run.project.manager,
                    builder: run.project.builder,
                    managerModel: run.project.managerModel || '',
                    builderModel: run.project.builderModel || '',
                    continueSession: true
                  }));
                }
                setScreen('setup');
              }}
              title="Switch to Projects"
            >
              <span>projects</span>
              <ChevronDown size={22} strokeWidth={2.8} />
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button>
        </div>
      )}

      {/* Screen 1: Home / Setup Screen (Figma 1:87) */}
      {screen === 'setup' ? (
        <main className="home-view-container">
          {/* Row 1, Col 1: Top Pill Tab */}
          <div className="home-top-tab-cell">
            <div className="sidebar-tab-capsule">
              <button
                type="button"
                className={'tab-item ' + (sidebarTab === 'projects' ? 'active' : '')}
                onClick={() => setSidebarTab('projects')}
              >
                YOUR PROJECTS
              </button>
              <button
                type="button"
                className={'tab-item ' + (sidebarTab === 'live' ? 'active' : '')}
                onClick={() => setSidebarTab('live')}
              >
                LIVE SESSIONS
              </button>
            </div>
          </div>
          {/* Row 1, Col 2: Top Spacer */}
          <div className="home-top-right-cell" aria-hidden="true" />

          {/* Row 2, Col 1: Black Sidebar Card */}
          <aside className="black-sidebar-card">
            <div className="sidebar-card-header">
              <span className="sidebar-subheading">
                {sidebarTab === 'projects' ? 'Your Projects' : 'Live Sessions'}
              </span>
              <button className="sidebar-new-btn" aria-label="New project" onClick={fresh} title="New project">
                +
              </button>
            </div>

            <div className="sidebar-items-scroll">
              {sidebarTab === 'projects' ? (
                state.projects.length === 0 ? (
                  <div className="sidebar-empty">No projects yet. Create your first one.</div>
                ) : (
                  state.projects.map(p => {
                    const isSelected = Boolean((form.id && p.id === form.id) || (form.sessionId && (p.sessionId === form.sessionId || p.id === form.sessionId)) || (form.name && p.name === form.name));
                    const isBuilt = Boolean(p.lastBuild || p.previewUrl || p.hasBuilt || p.completedPages?.length > 0);
                    return (
                      <div
                        key={p.id}
                        className={'sidebar-project-row ' + (isSelected ? 'selected' : '')}
                        onClick={() => selectSession(p)}
                        title={p.name}
                      >
                        <div className="sidebar-project-left">
                          <span className="sidebar-project-name" title={p.name}>{p.name}</span>
                        </div>
                        {/* Folder icon: green if built, white if unbuilt */}
                        <Folder
                          size={16}
                          strokeWidth={1.8}
                          className={'sidebar-folder-icon ' + (isBuilt ? 'built-green' : 'unbuilt-white')}
                          fill={isBuilt ? '#00b900' : 'none'}
                        />
                      </div>
                    );
                  })
                )
              ) : (
                activeRunsList.length === 0 ? (
                  <div className="sidebar-empty">No live background sessions running.</div>
                ) : (
                  activeRunsList.map(r => (
                    <div
                      key={r.id || r.key}
                      className="sidebar-project-row live"
                      onClick={() => {
                        setViewedLiveSessions(prev => new Set([...prev, r.key, r.id, r.sessionId]));
                        if (run && (run.id === r.id || run.sessionId === r.sessionId)) {
                          if (r.status === 'responsive' || r.status === 'guide') {
                            setWorkspaceView('responsive');
                          }
                          setScreen('work');
                        } else {
                          const targetProj = state.projects?.find(p => p.id === r.id || p.sessionId === r.sessionId || p.name === r.name);
                          if (targetProj) selectSession(targetProj);
                          else setScreen('work');
                        }
                      }}
                    >
                      <div className="sidebar-project-left">
                        <Loader2 size={13} className="spin" />
                        <span className="sidebar-project-name">{r.name}</span>
                      </div>
                      <span className="live-pill">{r.status === 'responsive' ? 'Responsive Maker' : (r.status === 'guide' ? 'Guide' : 'Live')}</span>
                    </div>
                  ))
                )
              )}
            </div>
          </aside>

          {/* Row 2, Col 2: Right Form Column */}
          <section className="home-form-column">
            <form onSubmit={start} className="home-setup-form">
              {/* Project Name Row + Simpler Choose Folder Button */}
              <div className="project-name-folder-row">
                <div className="project-name-input-block">
                  <input
                    id="project-name-input"
                    aria-label="Name of the project"
                    required
                    maxLength={100}
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Name of the project"
                    className="project-name-line-input"
                    title={form.name || 'Name of the project'}
                  />
                </div>

                <button
                  type="button"
                  className={'choose-folder-btn ' + (selectedFolderName ? 'has-folder' : '')}
                  onClick={() => act(async () => {
                    if (!native) {
                      try {
                        if (typeof window.showDirectoryPicker === 'function') {
                          const handle = await window.showDirectoryPicker();
                          if (handle?.name) {
                            set('directory', handle.name);
                            return;
                          }
                        }
                      } catch {
                        return;
                      }
                      const dir = window.prompt('Enter project folder path or name:', form.directory || '');
                      if (dir) set('directory', dir);
                      return;
                    }
                    const dir = await native.chooseFolder();
                    if (dir) set('directory', dir);
                  })}
                  title={form.directory ? `Folder: ${form.directory} (Click to change)` : 'Choose folder'}
                >
                  <Folder size={14} strokeWidth={2} />
                  <span className="folder-btn-text">
                    {selectedFolderName || 'Choose Folder'}
                  </span>
                </button>
              </div>

              {/* figma sections/pages Box */}
              <div className="figma-sections-group">
                <div className="group-header-bar">
                  <span className="group-title">figma sections/pages</span>
                  <span className="group-subtitle">Built in this order, one at a time</span>
                </div>

                <div className="black-box-card pages-box">
                  {form.pages.map((page, i) => (
                    <div className="page-entry-unit" key={i}>
                      <div className="page-name-tag-row">
                        <input
                          className="page-name-pill-input"
                          aria-label={`Page ${i + 1} name`}
                          required
                          value={page.name}
                          onChange={e => pageChange(i, 'name', e.target.value)}
                          placeholder="name of the page"
                        />
                      </div>

                      <div className="page-link-row">
                        <span className="page-order-num">{String(i + 1).padStart(2, '0')}</span>
                        <input
                          className="figma-link-pill-input"
                          aria-label={`Page ${i + 1} Figma link`}
                          type={form.continueSession ? 'text' : 'url'}
                          required={!form.continueSession}
                          value={page.url}
                          onChange={e => pageChange(i, 'url', e.target.value)}
                          placeholder="paste your figma dev mode selection link "
                          onPaste={e => {
                            const links = e.clipboardData.getData('text').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                            if (links.length > 1) {
                              e.preventDefault();
                              const pages = [...form.pages];
                              pages.splice(i, 1, ...links.map((url, n) => ({
                                name: n === 0 ? page.name : `Page ${i + n + 1}`,
                                url,
                                notes: ''
                              })));
                              set('pages', pages.slice(0, 40));
                            }
                          }}
                        />

                        <div className="page-controls-right">
                          <button
                            type="button"
                            aria-label={`Move page ${i + 1} up`}
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            className="arrow-action-btn"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move page ${i + 1} down`}
                            disabled={i === form.pages.length - 1}
                            onClick={() => move(i, 1)}
                            className="arrow-action-btn"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove page ${i + 1}`}
                            disabled={form.pages.length === 1}
                            onClick={() => set('pages', form.pages.filter((_, n) => n !== i))}
                            className="arrow-action-btn delete-btn"
                          >
                            X
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="add-pages-button"
                  disabled={form.pages.length >= 40}
                  onClick={() => set('pages', [...form.pages, { name: `Page ${form.pages.length + 1}`, url: '', notes: '' }])}
                >
                  <span className="add-plus">+</span>
                  <span className="add-text">add more pages</span>
                </button>
              </div>

              {/* Instructions Box */}
              <div className="instructions-group">
                <div className="group-header-bar">
                  <div className="instructions-title-wrap">
                    <span className="group-title">Instructions</span>
                    <div className="instructions-toggle-pill" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        className={form.instructionMode !== 'pages' ? 'active' : ''}
                        onClick={() => set('instructionMode', 'single')}
                      >
                        single
                      </button>
                      <button
                        type="button"
                        role="tab"
                        className={form.instructionMode === 'pages' ? 'active' : ''}
                        onClick={() => set('instructionMode', 'pages')}
                      >
                        pages
                      </button>
                    </div>
                  </div>
                  <span className="group-subtitle">Optional, remembered throughout</span>
                </div>

                <div className="black-box-card instructions-box">
                  {form.instructionMode === 'pages' ? (
                    <div className="pages-instructions-list">
                      {form.pages.map((page, i) => (
                        <div className="page-instruction-item" key={i}>
                          <span className="page-instruction-label">{String(i + 1).padStart(2, '0')} {page.name || `Page ${i + 1}`}</span>
                          <textarea
                            aria-label={`Instructions for ${page.name || `Page ${i + 1}`}`}
                            value={page.notes || ''}
                            onChange={e => pageChange(i, 'notes', e.target.value)}
                            onInput={e => {
                              e.target.style.height = 'auto';
                              e.target.style.height = Math.max(54, e.target.scrollHeight) + 'px';
                            }}
                            placeholder="What should it feel like ? Interaction , visual details, add any thing preserve"
                            rows={2}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      ref={promptRef}
                      aria-label="Shared instructions"
                      className="instructions-textarea"
                      value={form.prompt}
                      onChange={e => set('prompt', e.target.value)}
                      onInput={e => {
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.max(66, e.target.scrollHeight) + 'px';
                      }}
                      placeholder="What should it feel like ? Interaction ,  visual details,  add any thing preserve"
                      rows={2}
                    />
                  )}
                </div>
              </div>

              {/* Combined Bottom Controls Grid (Matching image-2.png): 3-Row Grid */}
              <div className="bottom-controls-grid">
                {/* Row 1: Manager | Builder | Responsive (3 Provider Columns) */}
                <div className="form-select-unit provider-unit manager-unit">
                  <label className="field-label">Manager</label>
                  <div className="black-capsule-select">
                    <select aria-label="Manager provider" value={form.manager} onChange={e => setBatch({ manager: e.target.value, managerModel: '' })}>
                      {Object.entries(names).map(([v, n]) => <option value={v} key={v}>{n}</option>)}
                    </select>
                    <ChevronDown size={18} strokeWidth={2.4} className="capsule-chevron" />
                  </div>
                </div>

                <div className="form-select-unit provider-unit builder-unit">
                  <label className="field-label">Builder</label>
                  <div className="black-capsule-select">
                    <select aria-label="Builder provider" value={form.builder} onChange={e => setBatch({ builder: e.target.value, builderModel: '' })}>
                      {Object.entries(names).map(([v, n]) => <option value={v} key={v}>{n}</option>)}
                    </select>
                    <ChevronDown size={18} strokeWidth={2.4} className="capsule-chevron" />
                  </div>
                </div>

                <div className="form-select-unit provider-unit responsive-provider-unit">
                  <label className="field-label">Responsive Maker</label>
                  <div className="black-capsule-select">
                    <select aria-label="Responsive Maker provider" value={form.responsiveProvider || 'claude'} onChange={e => setBatch({ responsiveProvider: e.target.value, responsiveModel: '' })}>
                      {Object.entries(names).map(([v, n]) => <option value={v} key={v}>{n}</option>)}
                    </select>
                    <ChevronDown size={18} strokeWidth={2.4} className="capsule-chevron" />
                  </div>
                </div>

                {/* Row 2: Manager Model | Builder Model | Responsive Model (3 Model Columns) */}
                <div className="form-select-unit model-unit manager-model-unit">
                  <label className="field-label">Manager Model</label>
                  <ModelDropdown
                    role="manager"
                    provider={form.manager}
                    value={form.managerModel || ''}
                    onChange={val => set('managerModel', val)}
                    liveModels={liveModelsByProvider[form.manager]}
                  />
                </div>

                <div className="form-select-unit model-unit builder-model-unit">
                  <label className="field-label">Builder Model</label>
                  <ModelDropdown
                    role="builder"
                    provider={form.builder}
                    value={form.builderModel || ''}
                    onChange={val => set('builderModel', val)}
                    liveModels={liveModelsByProvider[form.builder]}
                  />
                </div>

                <div className="form-select-unit model-unit responsive-model-unit">
                  <label className="field-label">Responsive Maker Model</label>
                  <ModelDropdown
                    role="responsive"
                    provider={form.responsiveProvider || 'claude'}
                    value={form.responsiveModel || ''}
                    onChange={val => set('responsiveModel', val)}
                    liveModels={liveModelsByProvider[form.responsiveProvider || 'claude']}
                  />
                </div>

                {/* Row 3: Website Tech Stack on Left (Col 1), START BUILDING spanning Cols 2 & 3 */}
                <div className="form-select-unit stack-unit">
                  <label className="field-label">Website tech stack</label>
                  <div className="black-capsule-select">
                    <select value={form.stack || 'react'} onChange={e => set('stack', e.target.value)}>
                      <option value="react">React + vite</option>
                      <option value="next">Next.js + React</option>
                      <option value="vue">Vue + Vite</option>
                      <option value="html">HTML / CSS / JavaScript</option>
                      <option value="existing">Keep existing stack</option>
                    </select>
                    <ChevronDown size={18} strokeWidth={2.4} className="capsule-chevron" />
                  </div>
                </div>

                <div className="start-action-col-wide">
                  {hasExistingSession ? (
                    <button
                      type="button"
                      className="start-building-button live-running"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (form.sessionId && native?.openSession) {
                          try {
                            const s = await native.openSession(form);
                            setState(s);
                          } catch (err) {
                            console.error('Failed to open session on view workspace:', err);
                          }
                        }
                        setScreen('work');
                      }}
                      title="Session is active. Click to view workspace."
                    >
                      <span>VIEW WORKSPACE</span>
                      <span className="start-arrow">→</span>
                    </button>
                  ) : (
                    <button type="submit" className="start-building-button" disabled={busy}>
                      {busy && <Loader2 size={16} className="spin" />}
                      <span>START BUILDING</span>
                      <span className="start-arrow">————→</span>
                    </button>
                  )}
                  {isFormForNewProject && anySessionRunning && (
                    <div className="parallel-session-rate-notice">
                      <span className="rate-notice-dot" />
                      Another session is running. You can continue, but concurrent sessions share your provider's API rate limits.
                    </div>
                  )}
                </div>
              </div>

            </form>
          </section>

          {/* Row 3, Col 1: Left Footer */}
          <div className="sidebar-mac-footer">
            Runs on your Mac. Uses your own coding tools.
          </div>

          {/* Row 3, Col 2: Right Footer */}
          <div className="home-form-footer">
            <span className="no-accounts-note">No new accounts. Your coding tools handle Figma access.</span>
          </div>
        </main>
      ) : (
        /* Screen 2: Workspace View (Figma 1:98) */
        <main className="workspace-view-container">
          {/* Workspace Toolbar */}
          <div className="workspace-subbar">
            {/* Left: Working on page X of Y + Page Name */}
            <div className="workspace-page-meta">
              <span className="page-status-line">
                {done ? 'All Pages Done' : `Working On Page ${activePageIndex + 1} Of ${pagesList.length}`}
              </span>
              <strong className="page-current-name">
                {(currentPage?.name || 'LOGIN').toUpperCase()}
              </strong>
            </div>

            {/* Stepper Capsule (< 01 LOGIN >) */}
            <div className="stepper-capsule-box">
              <button
                type="button"
                className="stepper-nav-arrow"
                disabled={activePageIndex === 0}
                onClick={() => {
                  if (activePageIndex > 0 && run) native.openSession({ ...run.project, pageIndex: activePageIndex - 1 }).then(setState);
                }}
                title="Previous page"
              >
                &lt;
              </button>
              <div className="stepper-current-label">
                <span className="stepper-num">{String(activePageIndex + 1).padStart(2, '0')}</span>
                <span className="stepper-text">{(currentPage?.name || 'LOGIN').toUpperCase()}</span>
              </div>
              <button
                type="button"
                className="stepper-nav-arrow"
                disabled={activePageIndex >= pagesList.length - 1}
                onClick={() => {
                  if (activePageIndex < pagesList.length - 1 && run) native.openSession({ ...run.project, pageIndex: activePageIndex + 1 }).then(setState);
                }}
                title="Next page"
              >
                &gt;
              </button>
            </div>

            {/* Right Action Pills */}
            <div className="workspace-actions-group">
              <button
                type="button"
                className={'action-pill view-website-pill' + (isWebsiteBuilt ? ' built' : '')}
                disabled={busy}
                title={isWebsiteBuilt ? "Website is built! Click to open live preview in browser." : "Open live website in Chrome"}
                onClick={() => act(() => native.viewWebsite())}
              >
                <span>View Website</span>
              </button>

              <button
                type="button"
                className={'action-pill responsive-pill' + (workspaceView === 'responsive' ? ' active' : '')}
                disabled={busy}
                title={workspaceView === 'responsive' ? 'Switch back to Manager & Builder terminals' : 'View Responsive Maker'}
                onClick={() => {
                  setWorkspaceView(v => v === 'responsive' ? 'terminal' : 'responsive');
                }}
              >
                <Smartphone size={13} strokeWidth={2.2} />
                <span>{workspaceView === 'responsive' ? 'Main Terminals' : (responsiveRunning ? 'Responsive Maker' : (state.guideGenerating ? 'Generating Guide...' : 'Responsive Maker'))}</span>
              </button>

              <div className="options-dropdown-container" ref={optionsRef}>
                <button
                  type="button"
                  className={'action-pill options-pill ' + (showOptions ? 'active' : '')}
                  onClick={() => setShowOptions(!showOptions)}
                >
                  <span>Options</span>
                  <ChevronDown size={15} strokeWidth={2.4} />
                </button>

                {showOptions && (
                  <div className="options-popover-menu">
                    <button
                      type="button"
                      onClick={() => {
                        setWorkspaceView(v => v === 'terminal' ? 'website' : 'terminal');
                        setShowOptions(false);
                      }}
                    >
                      <span>{workspaceView === 'terminal' ? 'View Website Here' : 'Terminal'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowOptions(false);
                        setWorkspaceView(workspaceView === 'responsive' ? 'terminal' : 'responsive');
                      }}
                    >
                      <span>{workspaceView === 'responsive' ? 'View Main Terminals' : 'View Responsive Maker'}</span>
                    </button>
                    {responsiveRunning && (
                      <button
                        type="button"
                        onClick={async () => {
                          await native.stopResponsive?.().catch(console.error);
                          setShowOptions(false);
                        }}
                      >
                        <span>Stop Responsive Maker</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationsEnabled(prev => {
                          const next = !prev;
                          localStorage.setItem('phibee-notifications', String(next));
                          return next;
                        });
                      }}
                    >
                      <span>{`Notifications: ${notificationsEnabled ? 'ON' : 'OFF'}`}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAutonomousEnabled(prev => {
                          const next = !prev;
                          localStorage.setItem('phibee-autonomous', String(next));
                          return next;
                        });
                      }}
                    >
                      <span>{`Auto-Approve: ${autonomousEnabled ? 'ON' : 'OFF'}`}</span>
                    </button>
                    <button type="button" onClick={() => { loadFiles(); setShowOptions(false); }}>
                      <span>File structure</span>
                    </button>
                    <button type="button" onClick={() => { act(() => native.openEditor()); setShowOptions(false); }}>
                      <span>Code</span>
                    </button>
                    <button type="button" onClick={() => { act(() => native.openLogs()); setShowOptions(false); }}>
                      <span>Logs</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={busy || !run}
                className="action-pill pause-pill"
                title={paused ? 'Resume coding agents' : 'Pause execution'}
                onClick={() => act(() => paused ? native.resume() : native.pause())}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>

              <button
                type="button"
                className="action-pill stop-pill"
                disabled={busy || !run}
                onClick={() => act(async () => {
                  const s = await native.stop();
                  if (run?.project) {
                    const r = run;
                    const p = r.project;
                    const next = {
                      ...emptyProject(),
                      ...p,
                      id: p.id || r.id,
                      sessionId: r.sessionId || r.id,
                      continueSession: true,
                      manager: p.manager,
                      builder: p.builder,
                      managerModel: p.managerModel || '',
                      builderModel: p.builderModel || '',
                      pages: (p.pages && p.pages.length > 0) ? p.pages : [{ name: 'Home', url: '', notes: '' }],
                      instructionMode: p.instructionMode || 'single'
                    };
                    setForm(next);
                    localStorage.setItem('align-native-draft', JSON.stringify(next));
                    if (r.id) {
                      localStorage.setItem('phibee-selected-session-id', r.id);
                      localStorage.setItem('phiby-selected-session-id', r.id);
                    }
                  }
                  setScreen('setup');
                })}
              >
                <span className="stop-square-glyph" />
                <span>Stop</span>
              </button>
            </div>
          </div>

          {/* Files Drawer Modal/Tray if opened from Options */}
          {showFiles && (
            <div className="files-structure-overlay">
              <div className="files-structure-header">
                <div className="title-with-count">
                  <FolderTree size={16} />
                  <strong>Project Codebase</strong>
                  <span className="files-count-badge">{projectFiles.length} files</span>
                </div>
                <div className="header-actions">
                  <button type="button" onClick={() => act(() => native.openEditor())}>
                    <Code size={13} /> Open Editor
                  </button>
                  <button type="button" onClick={() => setShowFiles(false)}><X size={15} /></button>
                </div>
              </div>
              <div className="files-structure-body">
                {projectFiles.length === 0 ? (
                  <p className="no-files-msg">No files found yet.</p>
                ) : (
                  projectFiles.map(f => (
                    <div key={f} className="file-item-row" onClick={() => act(() => native.openEditor())}>
                      <span className="file-glyph">📄</span>
                      <span className="file-rel-path">{f}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {state.guideGenerating && (
            <div className="guide-generating-banner">
              <Loader2 size={16} className="spin" />
              <span>Manager is analyzing website structure and preparing responsive design guide...</span>
            </div>
          )}

          {/* Split Terminals Card / Ratio Website View (Figma 1:98) */}
          <div className="workspace-main-card">
            {/* Terminal Split View */}
            <div className="split-terminals-layout" style={{ display: workspaceView === 'terminal' ? 'grid' : 'none' }}>
              <AgentTerminal
                role="builder"
                sessionId={run?.sessionId || run?.id}
                model={run?.project?.builderModel}
                provider={run?.project?.builder || form.builder}
                theme={theme}
                run={run}
                state={state}
                isPaused={paused}
                isRunning={run?.status === 'builder'}
              />
              <div className="terminals-divider-line" />
              <AgentTerminal
                role="manager"
                sessionId={run?.sessionId || run?.id}
                model={run?.project?.managerModel}
                provider={run?.project?.manager || form.manager}
                theme={theme}
                run={run}
                state={state}
                isPaused={paused}
                isRunning={run?.status === 'manager'}
              />
            </div>

            {/* Responsive Agent Terminal View */}
            <div className="responsive-terminal-layout" style={{ display: workspaceView === 'responsive' ? 'flex' : 'none' }}>
              <AgentTerminal
                role="responsive"
                sessionId={run?.sessionId || run?.id}
                model={run?.project?.responsiveModel || run?.project?.builderModel || form.responsiveModel}
                provider={run?.project?.responsiveProvider || run?.project?.builder || form.responsiveProvider || form.builder}
                theme={theme}
                run={run}
                state={state}
                onBack={() => setWorkspaceView('terminal')}
                onStart={handleStartResponsive}
                onPause={() => native?.pauseResponsive?.()}
                onResume={() => native?.resumeResponsive?.()}
                onStop={() => native?.stopResponsive?.()}
                isPaused={Boolean(state.responsivePaused)}
                isRunning={Boolean(state.responsiveRunning)}
              />
            </div>

            {/* Embedded Website Screen View (When 'View Website Here' is selected) */}
            <div className="ratio-website-preview-screen" style={{ display: workspaceView === 'website' ? 'flex' : 'none' }}>
              <div className="preview-screen-topbar">
                <span className="preview-url-display">
                  {run?.previewUrl || run?.lastBuild?.previewUrl || 'http://localhost:5173'}
                </span>
                <div className="preview-quick-actions">
                  <button
                    type="button"
                    className="screen-tool-btn"
                    title="Reload page"
                    onClick={() => { if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; }}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    type="button"
                    className="screen-tool-btn"
                    title="Open in Chrome"
                    onClick={() => act(() => native.viewWebsite())}
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
              </div>

              <div className="ratio-iframe-container">
                {run?.previewUrl || run?.lastBuild?.previewUrl ? (
                  <iframe
                    ref={iframeRef}
                    src={run?.previewUrl || run?.lastBuild?.previewUrl}
                    className="ratio-iframe"
                    title="Live Website"
                  />
                ) : (
                  <div className="preview-not-running">
                    <p>Live preview will appear once the builder serves Vite.</p>
                    <button type="button" onClick={() => act(() => native.viewWebsite())}>
                      <Play size={13} fill="currentColor" /> Start Preview
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer Bar */}
          <footer className="workspace-footer">
            <div className="footer-status-text">
              {run?.logError ? 'Log writing failed: ' + run.logError : (run?.message || 'Manager Is Looking At The Screenshot.....')}
              {run?.stageStartedAt && !paused && !done ? ' · ' + Math.max(0, Math.floor((now - run.stageStartedAt) / 1000)) + 's' : ''}
            </div>
          </footer>
          {approvalPrompt && (
            <div className="phibee-trust-approval-modal">
              <div className="trust-modal-card">
                <div className="trust-modal-header">
                  <span className="trust-modal-shield">🛡️</span>
                  <h4>Folder Permission &amp; Trust Approval</h4>
                </div>
                <p className="trust-modal-body">
                  Claude Code is asking for folder trust permissions in your project directory. Click approve to proceed safely.
                </p>
                <div className="trust-modal-actions">
                  <button
                    type="button"
                    className="trust-approve-btn"
                    onClick={() => {
                      if (approvalPrompt.type === 'trust-arrow-reorder') {
                        native?.input?.(approvalPrompt.role, '\x1b[B');
                        setTimeout(() => {
                          native?.input?.(approvalPrompt.role, '\r');
                        }, 200);
                      } else {
                        native?.input?.(approvalPrompt.role, approvalPrompt.response || '1\r');
                      }
                      setApprovalPrompt(null);
                    }}
                  >
                    Yes, Trust &amp; Approve
                  </button>
                  <button
                    type="button"
                    className="trust-open-term-btn"
                    onClick={() => {
                      setWorkspaceView('terminal');
                      setApprovalPrompt(null);
                    }}
                  >
                    Open Terminal
                  </button>
                  <button
                    type="button"
                    className="trust-dismiss-btn"
                    onClick={() => setApprovalPrompt(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}
          {toastMessage && (
            <div className="phibee-toast-notification">
              <span className="toast-icon">ℹ️</span>
              <span className="toast-text">{toastMessage}</span>
              <button type="button" className="toast-close-btn" onClick={() => setToastMessage('')} aria-label="Close notification">×</button>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
