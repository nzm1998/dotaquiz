// ==================== QUIZ MODULE ====================
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const QUESTIONS_PER_ROUND = 5;

let allQuestions = [];
let questions = [];
let currentIndex = 0;
let correctCount = 0;
let currentDifficulty = 'beginner';
let answeredQuestions = {};

const DIFFICULTIES = {
  beginner: { name: '初学者', icon: '🌱', info: '每轮5题，优先抽取未答题' },
  veteran: { name: '老刀斯林', icon: '⚔️', info: '每轮5题，高难度题目比例更高' }
};

const TITLES = [
  { min: 90, rank: '👑', title: '老刀斯林', quote: '真正的刀塔传奇！你的刀塔知识已经达到了登峰造极的境界，连Valve都要请你去做平衡顾问！' },
  { min: 80, rank: '🔥', title: '真刀斯林', quote: '经验丰富的老玩家！对刀塔的理解远超常人，距离传奇只差一步之遥！' },
  { min: 60, rank: '🛡️', title: '刀斯林', quote: '不错的刀斯林！大多数题都答对了，看来你确实在刀塔里花了不少时间。' },
  { min: 40, rank: '🤔', title: '假刀斯林', quote: '云玩家实锤了！虽然看过一些比赛，但实战经验可能不太够哦。' },
  { min: 20, rank: '☁️', title: '云玩家', quote: '你真的打过刀塔吗？建议先开一把人机练练手再来挑战！' },
  { min: 0, rank: '💀', title: '云玩家本云', quote: '你怕不是只看过视频吧？连Dota2都没安装就来答题了？' }
];


function getTitle(percent) {
  for (const t of TITLES) {
    if (percent >= t.min) return t;
  }
  return TITLES[TITLES.length - 1];
}

async function loadQuestions(retryCount = 0) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('questions.json', { cache: 'no-cache', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allQuestions = data.questions;
    if (allQuestions.length === 0) throw new Error('题库为空');
  } catch (e) {
    if (retryCount < 2) {
      console.warn(`[quiz] loadQuestions retry ${retryCount + 1}: ${e.message}`);
      await new Promise(r => setTimeout(r, 800));
      return loadQuestions(retryCount + 1);
    }
    console.error('[quiz] loadQuestions failed after retries:', e);
    const app = document.getElementById('quiz-screen');
    app.innerHTML = `<div style="padding:120px 24px;text-align:center;max-width:480px;margin:0 auto;">
      <p style="color:var(--error);font-size:18px;margin-bottom:8px;">题目加载失败</p>
      <p style="color:var(--mute);font-size:14px;margin-bottom:24px;">请检查网络后重试。(${e.message})</p>
      <button onclick="initQuiz()" style="padding:10px 24px;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-family:inherit;">重新加载</button>
    </div>`;
  }
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getAnsweredQuestions() {
  const data = sessionStorage.getItem('answered_questions');
  return data ? JSON.parse(data) : [];
}

function markQuestionAnswered(questionId) {
  const answered = getAnsweredQuestions();
  if (!answered.includes(questionId)) {
    answered.push(questionId);
    sessionStorage.setItem('answered_questions', JSON.stringify(answered));
  }
}

function getNextBatchQuestions(allQs, difficulty, count = QUESTIONS_PER_ROUND) {
  const answered = getAnsweredQuestions();

  // 根据难度过滤合适题目
  let pool;
  if (difficulty === 'beginner') {
    // 初学者：优先抽取"新入坑玩家"类别，不足时从"老刀斯林"补
    const easyQs = allQs.filter(q => q.category === '新入坑玩家');
    pool = easyQs.length > 0 ? easyQs : allQs;
  } else {
    // 老刀斯林：从"老刀斯林"类别抽取
    const hardQs = allQs.filter(q => q.category === '老刀斯林');
    pool = hardQs.length > 0 ? hardQs : allQs;
  }

  // 优先取未答过的
  const unanswered = pool.filter(q => !answered.includes(q.id));
  const answeredPool = pool.filter(q => answered.includes(q.id));
  const selectedPool = unanswered.length >= count ? unanswered : [...unanswered, ...answeredPool];
  const shuffled = shuffleArray(selectedPool);
  return shuffled.slice(0, count).map(q => ({ ...q, _answer: q.answer }));
}

async function initQuiz() {
  const app = document.getElementById('quiz-screen');
  app.innerHTML = `
    <div class="quiz-loading">
      <div class="quiz-loading-spinner"></div>
      <div class="quiz-loading-text">加载中...</div>
    </div>
  `;

  // 题目必须加载完才显示
  await loadQuestions();

  if (allQuestions.length > 0) {
    showDifficultySelection();
  }
}

function showDifficultySelection() {
  const app = document.getElementById('quiz-screen');
  app.innerHTML = `
    <div class="quiz-screen">
      <div class="quiz-landing">
        <div class="landing-badge animate-in">
          <span class="landing-badge-dot"></span>
          <span>答题挑战</span>
        </div>
        <h1 class="landing-title animate-in delay-1">
          选择你的 <span>难度</span>
        </h1>
        <p class="landing-subtitle animate-in delay-2">
          测试你的刀塔知识，看看你是真玩家还是云玩家
        </p>
        <div class="difficulty-cards animate-in delay-3">
          <div class="difficulty-card" onclick="selectDifficulty('beginner')">
            <div class="difficulty-icon">🌱</div>
            <h3 class="difficulty-name">初学者</h3>
            <p class="difficulty-desc">每轮5题，适合新手玩家热身</p>
            <div class="difficulty-cta">开始挑战 →</div>
          </div>
          <div class="difficulty-card veteran" onclick="selectDifficulty('veteran')">
            <div class="difficulty-icon">⚔️</div>
            <h3 class="difficulty-name">老刀斯林</h3>
            <p class="difficulty-desc">每轮5题，高难度题目比例更高</p>
            <div class="difficulty-cta">开始挑战 →</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function selectDifficulty(difficulty) {
  if (allQuestions.length === 0) {
    alert('题目加载中，请稍候...');
    return;
  }

  currentDifficulty = difficulty;
  questions = getNextBatchQuestions(allQuestions, difficulty, QUESTIONS_PER_ROUND);
  currentIndex = 0;
  correctCount = 0;
  answeredQuestions = {};
  renderQuestion();
}

function renderQuestion() {
  const app = document.getElementById('quiz-screen');
  const q = questions[currentIndex];
  const difficultyName = DIFFICULTIES[currentDifficulty].name;

  // 选项保持原顺序 abcd，不乱序
  const optionsHtml = q.options.map((text, i) => `
    <div class="option" data-index="${i}">
      <span class="option-indicator">${OPTION_LETTERS[i]}</span>
      <span class="option-text">${text}</span>
    </div>
  `).join('');

  const isAlreadyAnswered = !!answeredQuestions[q.id];
  const answerData = answeredQuestions[q.id];

  app.innerHTML = `
    <div class="quiz-screen">
      <div class="quiz-container">
        <div class="quiz-progress">
          <div class="quiz-progress-info">
            <span class="quiz-badge">${difficultyName}</span>
            <span class="quiz-progress-count"><strong>${currentIndex + 1}</strong> / ${questions.length}</span>
          </div>
          <button class="prev-btn ${currentIndex === 0 ? 'hidden' : ''}" id="prevBtn">← 上一题</button>
        </div>
        <div class="quiz-card">
          <div class="quiz-card-body">
            <div class="quiz-question-meta">
              <span class="quiz-type-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                题目 ${currentIndex + 1}
              </span>
            </div>
            <div class="quiz-question-text">${q.question}</div>
            <div class="options-list">${optionsHtml}</div>
            <div class="feedback" id="feedback">
              <div class="feedback-header">
                <span class="feedback-icon" id="feedbackIcon"></span>
                <span class="feedback-title" id="feedbackTitle"></span>
              </div>
              <div class="feedback-stats" id="feedbackStats"></div>
            </div>
            <button class="next-btn" id="nextBtn" disabled>
              ${currentIndex < questions.length - 1 ? '下一题' : '查看结果'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  attachOptionListeners();
  document.getElementById('nextBtn').addEventListener('click', nextQuestion);
  document.getElementById('prevBtn').addEventListener('click', prevQuestion);

  if (isAlreadyAnswered) {
    restoreAnsweredState(q, answerData);
  }
}

function restoreAnsweredState(q, answerData) {
  const options = document.querySelectorAll('.option');
  const correctIdx = q._answer;
  const { selectedIndex, isCorrect } = answerData;

  options.forEach((opt, i) => {
    opt.classList.add('disabled');
    if (i === correctIdx) opt.classList.add('correct');
    else if (i === selectedIndex && !isCorrect) opt.classList.add('wrong');
  });

  document.getElementById('nextBtn').disabled = false;

  const feedback = document.getElementById('feedback');
  feedback.className = `feedback show ${isCorrect ? 'correct' : 'wrong'}`;
  document.getElementById('feedbackIcon').textContent = isCorrect ? '✓' : '✗';
  document.getElementById('feedbackTitle').textContent = isCorrect ? '回答正确！' : '回答错误';

  document.getElementById('nextBtn').classList.add('show');
}

function attachOptionListeners() {
  document.querySelectorAll('.option').forEach(opt => {
    opt.addEventListener('click', () => handleAnswer(parseInt(opt.dataset.index)));
  });
}

async function handleAnswer(selectedIndex) {
  if (document.querySelector('.feedback.show')) return;

  const q = questions[currentIndex];
  const options = document.querySelectorAll('.option');
  const correctIdx = q._answer;
  const isCorrect = selectedIndex === correctIdx;

  if (isCorrect) {
    window.playCorrectSound && window.playCorrectSound();
  } else {
    window.playWrongSound && window.playWrongSound();
  }

  options.forEach((opt, i) => {
    opt.classList.add('disabled');
    if (i === correctIdx) opt.classList.add('correct');
    else if (i === selectedIndex && !isCorrect) opt.classList.add('wrong');
  });

  if (isCorrect) correctCount++;
  answeredQuestions[q.id] = { selectedIndex, isCorrect };
  showFeedback(isCorrect, q.id);
  document.getElementById('nextBtn').disabled = false;
}

async function showFeedback(isCorrect, questionId) {
  const feedback = document.getElementById('feedback');
  feedback.className = `feedback show ${isCorrect ? 'correct' : 'wrong'}`;
  document.getElementById('feedbackIcon').textContent = isCorrect ? '✓' : '✗';
  document.getElementById('feedbackTitle').textContent = isCorrect ? '回答正确！' : '回答错误';

  document.getElementById('nextBtn').classList.add('show');
}

function prevQuestion() {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
  }
}

function nextQuestion() {
  if (!answeredQuestions[questions[currentIndex]?.id]) return;
  markQuestionAnswered(questions[currentIndex].id);
  currentIndex++;
  if (currentIndex >= questions.length) {
    renderResult();
  } else {
    renderQuestion();
  }
}

function renderResult() {
  const app = document.getElementById('quiz-screen');
  const percent = Math.round((correctCount / questions.length) * 100);
  const titleData = getTitle(percent);

  app.innerHTML = `
    <div class="result-screen">
      <div class="result-container">
        <div class="result-card">
          <div class="result-badge">${titleData.rank}</div>
          <div class="result-rank">${titleData.title}</div>
          <div class="result-title">${percent}% 正确率</div>
          <div class="result-quote">"${titleData.quote}"</div>
          <div class="result-score-display">
            <div class="result-score">${correctCount}<span> / ${questions.length}</span></div>
            <div class="result-detail">答对 ${correctCount} 题 · 共 ${questions.length} 题</div>
          </div>
          <div class="result-actions">
            <button class="result-btn-primary" onclick="quizRestart()">再来一局</button>
            <button class="result-btn-secondary" onclick="quizBackToHome()">返回首页</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function quizBackToHome() {
  const app = document.getElementById('quiz-screen');
  // Restore the loading skeleton (not empty) so a later return to #quiz
  // shows the spinner immediately, instead of a black flash before initQuiz
  // re-runs.
  app.innerHTML = `
    <div class="quiz-loading">
      <div class="quiz-loading-spinner"></div>
      <div class="quiz-loading-text">加载中...</div>
    </div>
  `;
  window.navigate('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function quizRestart() {
  selectDifficulty(currentDifficulty);
}

// Expose init function globally
window.initQuiz = initQuiz;
window.selectDifficulty = selectDifficulty;
window.quizBackToHome = quizBackToHome;
window.quizRestart = quizRestart;
