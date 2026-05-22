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
  beginner: { name: '初学者', icon: '🌱', info: '每轮5题，优先抽取未答题', shuffleRatio: 0 },
  veteran: { name: '老刀斯林', icon: '⚔️', info: '每轮5题，高难度题目比例更高', shuffleRatio: 0.7 }
};

const TITLES = [
  { min: 90, rank: '👑', title: '老刀斯林', quote: '真正的刀塔传奇！你的刀塔知识已经达到了登峰造极的境界，连Valve都要请你去做平衡顾问！' },
  { min: 80, rank: '🔥', title: '真刀斯林', quote: '经验丰富的老玩家！对刀塔的理解远超常人，距离传奇只差一步之遥！' },
  { min: 60, rank: '🛡️', title: '刀斯林', quote: '不错的刀斯林！大多数题都答对了，看来你确实在刀塔里花了不少时间。' },
  { min: 40, rank: '🤔', title: '假刀斯林', quote: '云玩家实锤了！虽然看过一些比赛，但实战经验可能不太够哦。' },
  { min: 20, rank: '☁️', title: '云玩家', quote: '你真的打过刀塔吗？建议先开一把人机练练手再来挑战！' },
  { min: 0, rank: '💀', title: '云玩家本云', quote: '你怕不是只看过视频吧？连Dota2都没安装就来答题了？' }
];

let accuracyCache = {};
const ACCURACY_CACHE_DURATION = 24 * 60 * 60 * 1000;
let accuracyLoadFailed = false;
let commentsUnsubscribe = null;

function getTitle(percent) {
  for (const t of TITLES) {
    if (percent >= t.min) return t;
  }
  return TITLES[TITLES.length - 1];
}

async function loadAccuracyCache() {
  const now = Date.now();
  const lastLoad = sessionStorage.getItem('accuracy_last_load');

  if (lastLoad && (now - parseInt(lastLoad)) < ACCURACY_CACHE_DURATION && !accuracyLoadFailed) {
    const cached = sessionStorage.getItem('accuracy_cache');
    if (cached) {
      accuracyCache = JSON.parse(cached);
      return;
    }
  }

  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Firestore timeout')), 5000);
    });

    const snapshot = await Promise.race([statsCollection.get(), timeoutPromise]);

    accuracyCache = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      accuracyCache[doc.id] = { correct: data.correct || 0, total: data.total || 0, lastUpdated: now };
    });
    sessionStorage.setItem('accuracy_cache', JSON.stringify(accuracyCache));
    sessionStorage.setItem('accuracy_last_load', now.toString());
  } catch (e) {
    console.warn('Failed to load accuracy stats:', e.message);
    accuracyCache = {};
    accuracyLoadFailed = true;
  }
}

function getAccuracy(questionId) {
  const data = accuracyCache[questionId];
  if (!data || data.total === 0) return null;
  return Math.round((data.correct / data.total) * 100);
}

async function recordAnswer(questionId, selectedOption, isCorrect) {
  answersCollection.add({
    questionId: questionId,
    selectedOption: selectedOption,
    isCorrect: isCorrect,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(e => console.error('Failed to record answer:', e));

  const statsRef = statsCollection.doc(questionId.toString());
  statsRef.set({
    correct: firebase.firestore.FieldValue.increment(isCorrect ? 1 : 0),
    total: firebase.firestore.FieldValue.increment(1)
  }, { merge: true }).catch(e => console.error('Failed to update stats:', e));
}

async function loadQuestions() {
  try {
    const res = await fetch('questions.json');
    if (!res.ok) throw new Error('加载题目失败');
    const data = await res.json();
    allQuestions = data.questions;
    if (allQuestions.length === 0) throw new Error('没有题目');
  } catch (e) {
    const app = document.getElementById('quiz-screen');
    app.innerHTML = `<div style="padding:120px 24px;text-align:center;"><p style="color:var(--error);font-size:18px;">${e.message}</p></div>`;
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
  const unanswered = allQs.filter(q => !answered.includes(q.id));
  const answeredPool = allQs.filter(q => answered.includes(q.id));
  let pool = unanswered.length >= count ? unanswered : [...unanswered, ...answeredPool];
  const shuffled = shuffleArray(pool);
  return shuffled.slice(0, count).map(q => ({ ...q, _answer: q.answer }));
}

async function initQuiz() {
  await loadQuestions();
  loadAccuracyCache();
}

function selectDifficulty(difficulty) {
  if (allQuestions.length === 0) {
    alert('题目加载中，请稍候...');
    return;
  }

  currentDifficulty = difficulty;
  questions = getNextBatchQuestions([...allQuestions], difficulty, QUESTIONS_PER_ROUND);
  currentIndex = 0;
  correctCount = 0;
  answeredQuestions = {};
  hideLanding();
  renderQuestion();
}

function hideLanding() {
  document.querySelector('.nav').style.display = 'none';
  document.querySelector('.audio-controls').style.display = 'none';
}

function showLanding() {
  document.querySelector('.nav').style.display = 'flex';
  document.querySelector('.audio-controls').style.display = 'flex';
}

function renderQuestion() {
  const app = document.getElementById('quiz-screen');
  const q = questions[currentIndex];
  const difficultyName = DIFFICULTIES[currentDifficulty].name;

  const optionsHtml = q.options.map((opt, i) => `
    <div class="option" data-index="${i}">
      <span class="option-indicator">${OPTION_LETTERS[i]}</span>
      <span class="option-text">${opt}</span>
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
            <button class="next-btn" id="nextBtn">
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

  const feedback = document.getElementById('feedback');
  feedback.className = `feedback show ${isCorrect ? 'correct' : 'wrong'}`;
  document.getElementById('feedbackIcon').textContent = isCorrect ? '✓' : '✗';
  document.getElementById('feedbackTitle').textContent = isCorrect ? '回答正确！' : '回答错误';

  const accuracy = getAccuracy(q.id);
  if (accuracy !== null) {
    document.getElementById('feedbackStats').innerHTML = `本题正确率：<strong>${accuracy}%</strong>`;
  }

  document.getElementById('nextBtn').classList.add('show');
  renderCommentSection(q.id);
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

  window.playCorrectSound && window.playCorrectSound();
  if (!isCorrect) window.playWrongSound && window.playWrongSound();

  options.forEach((opt, i) => {
    opt.classList.add('disabled');
    if (i === correctIdx) opt.classList.add('correct');
    else if (i === selectedIndex && !isCorrect) opt.classList.add('wrong');
  });

  if (isCorrect) correctCount++;
  answeredQuestions[q.id] = { selectedIndex, isCorrect };
  recordAnswer(q.id, selectedIndex, isCorrect);
  showFeedback(isCorrect, q.id);
}

async function showFeedback(isCorrect, questionId) {
  const feedback = document.getElementById('feedback');
  feedback.className = `feedback show ${isCorrect ? 'correct' : 'wrong'}`;
  document.getElementById('feedbackIcon').textContent = isCorrect ? '✓' : '✗';
  document.getElementById('feedbackTitle').textContent = isCorrect ? '回答正确！' : '回答错误';

  const accuracy = getAccuracy(questionId);
  if (accuracy !== null) {
    document.getElementById('feedbackStats').innerHTML = `本题正确率：<strong>${accuracy}%</strong>`;
  }

  document.getElementById('nextBtn').classList.add('show');
  renderCommentSection(questionId);
}

async function renderCommentSection(questionId) {
  if (commentsUnsubscribe) {
    commentsUnsubscribe();
    commentsUnsubscribe = null;
  }

  const feedbackEl = document.getElementById('feedback');
  const commentSection = document.createElement('div');
  commentSection.className = 'comment-section';
  commentSection.innerHTML = `
    <div class="comment-header">💬 讨论区 <span style="color:var(--mute);font-weight:400">(实时)</span></div>
    <div class="comment-form">
      <input type="text" class="comment-input" id="commentInput" placeholder="写下你的看法..." maxlength="200">
      <button class="comment-submit" id="commentSubmit">发送</button>
    </div>
    <div class="comments-list" id="commentsList">
      <div class="comment-empty">加载中...</div>
    </div>
  `;
  feedbackEl.appendChild(commentSection);

  document.getElementById('commentSubmit').addEventListener('click', () => submitComment(questionId));
  document.getElementById('commentInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitComment(questionId);
  });

  const commentsRef = commentsCollection.doc(questionId.toString()).collection('items');
  commentsUnsubscribe = commentsRef
    .orderBy('timestamp', 'desc')
    .limit(20)
    .onSnapshot((snapshot) => {
      const listEl = document.getElementById('commentsList');
      if (!listEl) return;

      if (snapshot.empty) {
        listEl.innerHTML = '<div class="comment-empty">暂无评论，来说点什么吧</div>';
        return;
      }

      listEl.innerHTML = '';
      snapshot.forEach(doc => {
        const comment = doc.data();
        const time = comment.timestamp ? new Date(comment.timestamp.toDate()).toLocaleString('zh-CN') : '刚刚';
        listEl.innerHTML += `
          <div class="comment-item">
            <div class="comment-meta">
              <span class="comment-author">${escapeHtml(comment.author || '匿名')}</span>
              <span class="comment-time">${time}</span>
            </div>
            <div class="comment-text">${escapeHtml(comment.text)}</div>
          </div>
        `;
      });
    }, (error) => {
      console.error('Comments listener error:', error);
      const listEl = document.getElementById('commentsList');
      if (listEl) listEl.innerHTML = '<div class="comment-empty">评论加载失败</div>';
    });
}

function submitComment(questionId) {
  const input = document.getElementById('commentInput');
  const submitBtn = document.getElementById('commentSubmit');
  const text = input.value.trim();
  if (!text) return;

  submitBtn.disabled = true;
  const commentsRef = commentsCollection.doc(questionId.toString()).collection('items');
  commentsRef.add({
    text: text,
    author: generateAnonName(),
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => { input.value = ''; })
    .catch((e) => { console.error('Failed to submit comment:', e); alert('发送失败，请重试'); })
    .finally(() => { submitBtn.disabled = false; });
}

function generateAnonName() {
  const adjectives = ['快乐的', '神秘的', '勇敢的', '智慧的', '友善的', '帅气的'];
  const nouns = ['刀斯林', '玩家', '老铁', '道友', '水友', '粉丝'];
  return adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function prevQuestion() {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
  }
}

function nextQuestion() {
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

  if (commentsUnsubscribe) {
    commentsUnsubscribe();
    commentsUnsubscribe = null;
  }

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
  if (commentsUnsubscribe) {
    commentsUnsubscribe();
    commentsUnsubscribe = null;
  }

  const app = document.getElementById('quiz-screen');
  app.innerHTML = '';
  showLanding();
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