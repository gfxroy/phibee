// Hardcoded high-speed approval detection and auto-response across all AI harnesses
// Supported: Claude (Opus, Sonnet, Haiku), Antigravity (Gemini), Codex

export function cleanTerminalText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\].*?(\x07|\x1b\\)/g, '')
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

export function detectApprovalPrompt(text, provider = '') {
  if (!text) return null;
  const clean = cleanTerminalText(text);

  // 0. Workspace / Folder / Author trust prompts (Claude Code on first run in a directory)
  const isTrust = [
    /trust\s+(?:the\s+)?(?:authors|contents|files|folder|directory|workspace|project|repo|codebase)\b/i,
    /do\s+you\s+trust\b/i,
    /trusted\s+(?:folder|directory|workspace|author)/i,
    /is\s+it\s+(?:safe|okay|ok)\s+to\s+trust\b/i,
    /(?:safety\s+check|one\s+you\s+trust|trust\s+this\s+folder|I\s+trust\s+this)/i
  ].some(re => re.test(clean));

  if (isTrust) {
    // Claude Code's workspace safety check:  ❯ No, exit  /  Yes, I trust this folder
    // Arrow starts on "No, exit" — we must press arrow-down then Enter to select "Yes"
    const arrowOnNo = /[❯>]\s*No[,\s]/i.test(clean) && /Yes[,\s].*trust/i.test(clean);
    if (arrowOnNo) {
      // Arrow down to "Yes, I trust this folder", then Enter
      return { detected: true, type: 'trust-arrow-reorder', response: '\x1b[B\r' };
    }
    const num = clean.match(/(?:^|\n)\s*(?:[❯>]\s*)?(?:\[?1[.)\]:]?)\s*(?:yes|trust|proceed|allow|continue|accept)\b/im);
    if (num) return { detected: true, type: 'trust-numbered-1', response: '1\r' };
    if (/(?:^|\n)\s*[❯>]\s*(?:yes|trust|proceed|allow)\b/i.test(clean)) {
      return { detected: true, type: 'trust-arrow', response: '\r' };
    }
    return { detected: true, type: 'trust-yes', response: 'y\r' };
  }

  // 1. Check for "Press Enter to continue" or "Press any key"
  if (/press\s+(?:enter|return|any\s+key)\s+to\s+continue/i.test(clean)) {
    return { detected: true, type: 'press-enter', response: '\r' };
  }

  // 2. Check for numbered options (e.g., Claude Opus/Sonnet interactive tool approval)
  // Example:
  // 1. Yes / 1. Allow / 1. Always allow
  // 2. No / 2. Reject
  const numberedMatch = clean.match(/(?:^|\n)\s*(?:[❯>]\s*)?(?:\[?1[.)\]:]?)\s*(?:yes|allow|always|proceed|continue|execute|accept|run|approve)\b/im);
  if (numberedMatch) {
    return { detected: true, type: 'numbered-option-1', response: '1\r' };
  }

  // Check if option 1 is "Allow once" and option 2 is "Always allow"
  if (/(?:^|\n)\s*(?:\[?1[.)\]:]?)\s*allow\s+once/i.test(clean)) {
    return { detected: true, type: 'numbered-option-allow-once', response: '1\r' };
  }

  // 3. Arrow selection menu where the arrow is on affirmative choice (e.g. Inquirer / Ink menu)
  // Example:
  // ❯ Yes
  //   No
  // or
  // ❯ Allow
  //   Deny
  const arrowMatch = clean.match(/(?:^|\n)\s*[❯>]\s*(?:yes|allow|always|proceed|continue|accept|run|approve)\b/i);
  if (arrowMatch) {
    return { detected: true, type: 'arrow-select', response: '\r' };
  }

  // 4. Standard Yes/No prompts [y/n], [Y/n], [y/N], (y/n), (Y/n)
  const isYesNo = [
    /\[y(?:es)?\/n(?:o)?\]/i,
    /\(y(?:es)?\/n(?:o)?\)/i,
    /\b(?:yes|no)\s*\[y\/n\]/i,
    /\[Y\]es\s*\/\s*\[N\]o/i,
    /\(Y\)es\s*\/\s*\(N\)o/i,
    /\b\(A\)lways\s*\/\s*\(Y\)es\s*\/\s*\(N\)o\b/i,
    /\[y\/n\]\s*:?\s*$/im,
    /\(y\/n\)\s*:?\s*$/im
  ].some(re => re.test(clean));

  if (isYesNo) {
    return { detected: true, type: 'yes-no', response: 'y\r' };
  }

  // 5. Tool / Command / Permission approval questions across Claude, Antigravity, and Codex
  const isQuestionPrompt = [
    // Claude Opus / Sonnet: "Allow Bash to run `...`?", "Allow Edit tool to write ...?"
    /allow\s+(?:bash|edit|write|read|tool|command|action|execution|operation|mcp|subprocess|network)?\s+(?:to\s+)?(?:run|execute|write|read|modify|apply)?\s*[`'"\w\s./-]*\s*\?/i,
    // "Do you want to run this command?", "Do you want to proceed?"
    /do\s+you\s+want\s+to\s+(?:proceed|run|continue|execute|allow|apply|save|accept|make\s+these\s+changes)\s*[?:]?/i,
    // "Approve this tool call?", "Approve command?"
    /approve\s+(?:this\s+)?(?:tool\s+call|command|execution|edit|action|request)?\s*[?:]?/i,
    // "Would you like to proceed?", "Are you sure you want to continue?"
    /would\s+you\s+like\s+to\s+(?:proceed|continue|run|execute|allow)\s*[?:]?/i,
    /are\s+you\s+sure\s+you\s+want\s+to\s+(?:proceed|continue|run|execute|apply)\s*[?:]?/i,
    // "Permission requested for ...", "Requires your approval"
    /permission\s+requested\s+for/i,
    /requires\s+(?:your\s+)?approval/i,
    /waiting\s+for\s+approval/i,
    /confirm\s+(?:this\s+)?(?:action|execution|command|edit)\s*[?:]?/i
  ].some(re => re.test(clean));

  if (isQuestionPrompt) {
    // Check if the prompt ends with or includes an options hint
    if (/enter\s+(?:a\s+)?choice|select\s+an\s+option/i.test(clean)) {
      return { detected: true, type: 'choice-prompt', response: '1\r' };
    }
    return { detected: true, type: 'question-prompt', response: 'y\r' };
  }

  return null;
}
