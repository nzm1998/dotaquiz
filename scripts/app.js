// ==================== SHARED STATE & ROUTING ====================
let soundMuted = false;
let bgmMuted = false;
let bgmInitialized = false;
let audioCtx = null;

// Audio Controls
const bgmBtn = document.getElementById('bgmBtn');
const soundBtn = document.getElementById('soundBtn');

const bgm = new Audio();
bgm.src = 'assets/dota2_reborn.mp3';
bgm.loop = true;
bgm.volume = 0.25;

bgmBtn.addEventListener('click', () => {
  if (!bgmInitialized) {
    bgm.play().catch(() => {});
    bgmInitialized = true;
  }
  bgmMuted = !bgmMuted;
  bgm.muted = bgmMuted;
  bgmBtn.textContent = bgmMuted ? '🔇' : '🔊';
  bgmBtn.classList.toggle('muted', bgmMuted);
});

soundBtn.addEventListener('click', () => {
  soundMuted = !soundMuted;
  soundBtn.textContent = soundMuted ? '🔇' : '🔊';
  soundBtn.classList.toggle('muted', soundMuted);
});

document.addEventListener('click', () => {
  if (!bgmInitialized) {
    bgm.play().catch(() => {});
    bgmInitialized = true;
  }
}, { once: true });

// Routing
function navigate(route) {
  window.location.hash = route;
}

function handleRoute() {
  const hash = window.location.hash.replace('#', '') || 'home';
  const homeScreen = document.getElementById('home-screen');
  const quizScreen = document.getElementById('quiz-screen');
  const bpScreen = document.getElementById('bp-screen');
  const navQuiz = document.getElementById('nav-quiz');
  const navBp = document.getElementById('nav-bp');

  homeScreen.style.display = 'none';
  quizScreen.style.display = 'none';
  bpScreen.style.display = 'none';
  navQuiz.classList.remove('active');
  navBp.classList.remove('active');

  if (hash === 'quiz') {
    quizScreen.style.display = 'block';
    navQuiz.classList.add('active');
    if (quizScreen.innerHTML === '') {
      window.initQuiz && window.initQuiz();
    }
  } else if (hash === 'bp') {
    bpScreen.style.display = 'block';
    navBp.classList.add('active');
    window.initBP && window.initBP();
  } else {
    homeScreen.style.display = 'block';
  }
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);

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

// Firebase (shared)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const answersCollection = db.collection('answers');
const statsCollection = db.collection('question_stats');
const commentsCollection = db.collection('comments');

// Export shared functions
window.navigate = navigate;
window.handleRoute = handleRoute;
window.playCorrectSound = playCorrectSound;
window.playWrongSound = playWrongSound;