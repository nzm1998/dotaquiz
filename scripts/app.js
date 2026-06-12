// ==================== SHARED STATE & ROUTING ====================
// navigate is defined in index.html inline script — it handles screen switching
// and module initialization. app.js only provides the initial boot on page load.
let soundMuted = false;
let audioCtx = null;

// Audio Controls
const soundBtn = document.getElementById('soundBtn');

soundBtn.addEventListener('click', () => {
  soundMuted = !soundMuted;
  soundBtn.textContent = soundMuted ? '🔇' : '🔊';
  soundBtn.classList.toggle('muted', soundMuted);
});

// 汉堡菜单切换
const hamburgerBtn = document.getElementById('navHamburger');
const navLinks = document.querySelector('.nav-links');
if (hamburgerBtn && navLinks) {
  hamburgerBtn.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    hamburgerBtn.setAttribute('aria-expanded', isOpen);
  });
  // 点击导航链接后关闭菜单
  navLinks.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
    });
  });
  // 点击外部关闭菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav') && navLinks.classList.contains('open')) {
      navLinks.classList.remove('open');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

// Boot — if URL has a hash, navigate to it
window.addEventListener('load', function () {
  var hash = (window.location.hash || '').replace('#', '');
  if (hash && ['quiz', 'bp', 'replay'].indexOf(hash) >= 0 && typeof window.navigate === 'function') {
    window.navigate(hash);
  }
});

// Audio helpers
async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  return audioCtx;
}

async function playCorrectSound() {
  if (soundMuted) return;
  try {
    const ctx = await initAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

async function playWrongSound() {
  if (soundMuted) return;
  try {
    const ctx = await initAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// Export shared functions
window.navigate = navigate;
window.handleRoute = handleRoute;
window.playCorrectSound = playCorrectSound;
window.playWrongSound = playWrongSound;
