const image = document.querySelector('#product-image');
document.querySelectorAll('[data-image]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-image]').forEach(b => b.setAttribute('aria-selected', String(b === button)));
  image.src = `assets/${button.dataset.image}.png`;
  image.alt = button.dataset.image === 'workspace'
    ? 'Phibee workspace with illustrative demo text in both agent terminals'
    : 'Phibee project setup, Figma pages, instructions, and model choices';
}));

// Downloads configuration
const DOWNLOADS = {
  windows: {
    os: 'windows',
    name: 'Windows',
    label: 'Windows (64-bit)',
    filename: 'Phibee-Windows.exe',
    url: 'https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phibee-Windows.exe',
    cardId: 'card-windows'
  },
  linux: {
    os: 'linux',
    name: 'Linux',
    label: 'Linux (x86_64)',
    filename: 'Phibee-Linux.AppImage',
    url: 'https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phibee-Linux.AppImage',
    cardId: 'card-linux'
  },
  macArm: {
    os: 'mac',
    name: 'macOS',
    label: 'macOS (Apple Silicon)',
    filename: 'Phibee-Mac-AppleSilicon.dmg',
    url: 'https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phibee-Mac-AppleSilicon.dmg',
    cardId: 'card-mac'
  },
  macIntel: {
    os: 'mac',
    name: 'macOS',
    label: 'macOS (Intel)',
    filename: 'Phibee-Mac-Intel.dmg',
    url: 'https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phibee-Mac-Intel.dmg',
    cardId: 'card-mac'
  }
};

function detectVisitorOS() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const userAgentData = navigator.userAgentData;

  if (userAgentData && userAgentData.platform) {
    const p = userAgentData.platform.toLowerCase();
    if (p.includes('win')) return DOWNLOADS.windows;
    if (p.includes('mac')) return DOWNLOADS.macArm;
    if (p.includes('linux')) return DOWNLOADS.linux;
  }

  if (/windows|win32|win64/i.test(ua) || /win/i.test(platform)) {
    return DOWNLOADS.windows;
  }

  if (/macintosh|mac os x/i.test(ua) || /mac/i.test(platform)) {
    return DOWNLOADS.macArm;
  }

  if (/linux/i.test(ua) || /linux/i.test(platform)) {
    if (!/android/i.test(ua)) {
      return DOWNLOADS.linux;
    }
  }

  return null;
}

function initOSDownload() {
  const detected = detectVisitorOS();
  const heroBtn = document.querySelector('#hero-download-btn');

  if (detected) {
    if (heroBtn) {
      heroBtn.href = detected.url;
      heroBtn.innerHTML = `Download for ${detected.label} <span>↓</span>`;
      heroBtn.setAttribute('download', detected.filename);
    }

    const targetCard = document.getElementById(detected.cardId);
    if (targetCard) {
      targetCard.classList.add('is-detected');
    }
  }
}

// B Icon Cursor (b.png is the actual cursor)
function initBCursor() {
  const cursorEl = document.getElementById('b-cursor') || document.getElementById('bee-cursor');
  if (!cursorEl || !window.matchMedia('(pointer: fine)').matches) return;

  let visible = false;

  const onMouseMove = (e) => {
    // Instant, zero-latency positioning directly at the pointer
    cursorEl.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;

    if (!visible) {
      visible = true;
      cursorEl.classList.add('active');
      document.body.classList.add('has-custom-cursor');
    }
  };

  window.addEventListener('mousemove', onMouseMove, { passive: true });

  document.addEventListener('mouseleave', () => {
    visible = false;
    cursorEl.classList.remove('active');
    document.body.classList.remove('has-custom-cursor');
  });

  document.addEventListener('mouseenter', () => {
    visible = true;
    cursorEl.classList.add('active');
    document.body.classList.add('has-custom-cursor');
  });

  document.addEventListener('mousedown', () => {
    cursorEl.classList.add('clicking');
  });

  document.addEventListener('mouseup', () => {
    cursorEl.classList.remove('clicking');
  });

  const updateHoverState = (e) => {
    const target = e.target;
    if (target && (target.closest('a') || target.closest('button') || target.closest('summary') || target.closest('.switch') || target.closest('input') || target.closest('.download-card') || target.closest('[role="tab"]'))) {
      cursorEl.classList.add('hovering');
    } else {
      cursorEl.classList.remove('hovering');
    }
  };

  document.addEventListener('mouseover', updateHoverState, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initOSDownload();
    initBCursor();
  });
} else {
  initOSDownload();
  initBCursor();
}

