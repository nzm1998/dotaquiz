// ==================== HEROES CACHE ====================
const HEROES_CACHE_KEY = 'heroes_knowledge_v1';
const HEROES_VERSION = '1.0.0';

async function loadCachedOrFetch(url) {
  // Try localStorage first
  const cached = localStorage.getItem(HEROES_CACHE_KEY);
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      const now = Date.now();
      // Cache valid for 24 hours
      if (now - timestamp < 24 * 60 * 60 * 1000) {
        console.log('Using cached heroes data');
        return data;
      }
    } catch (e) {
      console.warn('Cache read failed:', e);
    }
  }

  // Fetch fresh
  const res = await fetch(url);
  const data = await res.json();

  // Store in localStorage
  localStorage.setItem(HEROES_CACHE_KEY, JSON.stringify({
    data,
    timestamp: Date.now()
  }));
  console.log('Fetched fresh heroes data');

  return data;
}

// ==================== DOTA2 BP AGENT - CORE LOGIC ====================
const BP = {
  heroesData: null,

  // Score weights (base values before multipliers)
  // 统一量纲: win_rate 用 (win_rate*100-50)，范围约 -10~+10
  // counters/synergies 范围约 -20~+20
  WEIGHTS: {
    winRateDeviation: 1.0,    // 胜率偏离权重
    counter: 0.5,             // 克制权重
    synergy: 0.5,              // 配合权重
  },

  // Position-aware lane matchup emphasis multipliers
  // Format: { recommendedPosition: { enemyPosition: multiplier } }
  // These express which enemy positions matter MORE for each recommended position
  COUNTER_MULTIPLIERS: {
    1: { 3: 1.5, 4: 1.5 },   // 1号位: 重点防敌方3、4号位
    2: { 2: 2.0 },             // 中单: 中单对中单克制最重要
    3: { 5: 1.8 },             // 3号位: 敌方5号位走一路，克制要突出
    4: { 3: 1.5 },             // 4号位: 敌方3号位走一路
    5: { 1: 1.5 },             // 5号位: 敌方1号位走一路
  },

  // Lane synergy emphasis multipliers
  // Format: { recommendedPosition: { teammatePosition: multiplier } }
  SYNERGY_MULTIPLIERS: {
    1: { 5: 1.8 },   // 1号位与5号位走一路
    5: { 1: 1.8 },   // 5号位与1号位走一路
    3: { 4: 1.8 },   // 3号位与4号位走一路
    4: { 3: 1.8 },   // 4号位与3号位走一路
    2: { 4: 1.5, 5: 1.5 }, // 2号位与4、5号位配合加权
  },

  // Load heroes knowledge base with caching
  async loadHeroes() {
    try {
      const jsonData = await loadCachedOrFetch('heroes_knowledge.json');
      this.heroesData = jsonData.heroes;
      console.log(`Loaded ${Object.keys(this.heroesData).length} heroes`);
      return true;
    } catch (e) {
      console.error('Failed to load heroes:', e);
      return false;
    }
  },

  // Get all heroes as array
  getAllHeroes() {
    if (!this.heroesData) return [];
    return Object.entries(this.heroesData).map(([id, data]) => ({
      id,
      ...data
    }));
  },

  // Get hero by ID
  getHeroById(heroId) {
    return this.heroesData ? this.heroesData[heroId] : null;
  },

  // Check if hero can play a position
  canPlayPosition(heroId, position) {
    const hero = this.getHeroById(heroId);
    if (!hero || !hero.roles) return false;
    return hero.roles.includes(position);
  },

  // Get heroes for a specific position
  getHeroesForPosition(position) {
    return this.getAllHeroes().filter(hero => this.canPlayPosition(hero.id, position));
  },

  // Get relationship score between two heroes (for synergies)
  getSynergyScore(heroIdA, heroIdB) {
    const heroA = this.getHeroById(heroIdA);
    const heroB = this.getHeroById(heroIdB);
    if (!heroA || !heroB) return 0;

    // Sum both directions for synergy
    let score = 0;
    if (heroA.synergies && heroA.synergies[heroIdB]) {
      score += heroA.synergies[heroIdB];
    }
    if (heroB.synergies && heroB.synergies[heroIdA]) {
      score += heroB.synergies[heroIdA];
    }
    return score;
  },

  // Get counter score (how much heroId counters enemyId)
  getCounterScore(heroId, enemyId) {
    const hero = this.getHeroById(heroId);
    if (!hero || !hero.counters) return 0;
    return hero.counters[enemyId] || 0;
  },

  // Calculate candidate's scores breakdown (position-aware, with lane emphasis)
  getCandidateScores(candidateId, myLineup, enemyLineup, recommendedPosition = null) {
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');

    const candidate = this.getHeroById(candidateId);
    // 胜率偏离：48%→-2, 53%→+3
    const winRateDeviation = ((candidate?.win_rate || 0.5) * 100 - 50);

    const counters = [];
    const synergies = [];
    let totalCounterScore = 0;
    let totalSynergyScore = 0;

    // Counter scores against ALL enemy heroes with lane-specific emphasis
    for (const enemyHero of enemyTeam) {
      if (enemyHero && enemyHero !== '') {
        let score = this.getCounterScore(candidateId, enemyHero);

        // Apply position-aware lane multiplier if we know our recommended position
        if (recommendedPosition && score !== 0) {
          // Find which enemy position this hero is
          const enemyPosIndex = enemyLineup.indexOf(enemyHero);
          const enemyPos = enemyPosIndex >= 0 ? enemyPosIndex + 1 : null;

          if (enemyPos && this.COUNTER_MULTIPLIERS[recommendedPosition]?.[enemyPos]) {
            const multiplier = this.COUNTER_MULTIPLIERS[recommendedPosition][enemyPos];
            score *= multiplier;
          }
        }

        const enemyName = this.getHeroById(enemyHero)?.name || enemyHero;
        counters.push({ heroId: enemyHero, heroName: enemyName, score: score });
        totalCounterScore += score;
      }
    }

    // Synergy with ALL existing teammates with lane-specific emphasis
    for (const myHero of myTeam) {
      if (myHero && myHero !== '') {
        let score = this.getSynergyScore(candidateId, myHero);

        // Apply lane-specific synergy multiplier if we know our recommended position
        if (recommendedPosition && score !== 0) {
          // Find which position this teammate is
          const teammatePosIndex = myLineup.indexOf(myHero);
          const teammatePos = teammatePosIndex >= 0 ? teammatePosIndex + 1 : null;

          if (teammatePos && this.SYNERGY_MULTIPLIERS[recommendedPosition]?.[teammatePos]) {
            const multiplier = this.SYNERGY_MULTIPLIERS[recommendedPosition][teammatePos];
            score *= multiplier;
          }
        }

        const myHeroName = this.getHeroById(myHero)?.name || myHero;
        synergies.push({ heroId: myHero, heroName: myHeroName, score: score });
        totalSynergyScore += score;
      }
    }

    // 综合评分：应用权重
    const rawTotal = this.WEIGHTS.winRateDeviation * winRateDeviation
                   + this.WEIGHTS.counter * totalCounterScore
                   + this.WEIGHTS.synergy * totalSynergyScore;

    return {
      winRateDeviation,
      totalCounterScore: Math.round(totalCounterScore * 100) / 100,
      totalSynergyScore: Math.round(totalSynergyScore * 100) / 100,
      totalStrength: Math.round(rawTotal * 100) / 100
    };
  },

  // Calculate total lineup strength for our team against enemy team
  // 统一量纲评分：(win_rate*100-50) + counter + synergy，权重 W1=1.0, W2=0.5, W3=0.5
  calculateLineupStrength(myLineup, enemyLineup) {
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');

    if (enemyTeam.length === 0) return 0;

    // 1. 英雄平均强度（胜率偏离50%的值）
    const totalWinRateDeviation = myTeam.reduce((sum, id) => {
      const hero = this.getHeroById(id);
      return sum + ((hero?.win_rate || 0.5) * 100 - 50);
    }, 0);
    const avgWinRateDeviation = totalWinRateDeviation / myTeam.length;

    // 2. 我方对敌方克制总分
    let totalCounterScore = 0;
    for (const myHero of myTeam) {
      for (const enemyHero of enemyTeam) {
        totalCounterScore += this.getCounterScore(myHero, enemyHero);
      }
    }

    // 3. 我方内部配合总分（两两之间）
    let totalSynergyScore = 0;
    for (let i = 0; i < myTeam.length; i++) {
      for (let j = i + 1; j < myTeam.length; j++) {
        totalSynergyScore += this.getSynergyScore(myTeam[i], myTeam[j]);
      }
    }

    // 最终评分（归一化到 0-100 方便理解）
    const rawScore = this.WEIGHTS.winRateDeviation * avgWinRateDeviation
                   + this.WEIGHTS.counter * totalCounterScore
                   + this.WEIGHTS.synergy * totalSynergyScore;
    return Math.round(rawScore * 100) / 100;
  },

  // Get recommendations for missing positions
  getRecommendations(myLineup, enemyLineup, myPosition = null) {
    const recommendations = {};
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');

    // Exclude both my team and enemy team heroes from recommendations
    const excludedHeroIds = new Set([...myTeam, ...enemyTeam]);

    // Find missing positions
    for (let pos = 1; pos <= 5; pos++) {
      if (myLineup[pos - 1] && myLineup[pos - 1] !== '') {
        continue; // Position already filled
      }

      // If user specified position, only recommend that position
      if (myPosition && pos !== myPosition) {
        continue;
      }

      // Get eligible heroes for this position (exclude already selected heroes)
      const eligibleHeroes = this.getHeroesForPosition(pos)
        .filter(hero => !excludedHeroIds.has(hero.id));

      // Score each candidate with position awareness for lane emphasis
      const scoredHeroes = eligibleHeroes.map(hero => {
        const scores = this.getCandidateScores(hero.id, myLineup, enemyLineup, pos);
        return {
          heroId: hero.id,
          name: hero.name,
          position: pos,
          strength: scores.totalStrength,
          winRateDeviation: scores.winRateDeviation,
          counters: scores.counters,
          synergies: scores.synergies
        };
      });

      // Sort by strength descending
      scoredHeroes.sort((a, b) => b.strength - a.strength);

      // Take top 5
      recommendations[pos] = scoredHeroes.slice(0, 5);
    }

    return recommendations;
  },

  // Get total lineup strength for display
  getTotalLineupStrength(myLineup, enemyLineup) {
    return this.calculateLineupStrength(myLineup, enemyLineup);
  },

  // ========== NEW: Extended BP Analysis ==========

  // Get NOT recommended heroes for my team (low scores due to being countered/enemy has counters)
  getNotRecommended(myLineup, enemyLineup, myPosition = null) {
    const notRecommended = {};
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');
    const excludedHeroIds = new Set([...myTeam, ...enemyTeam]);

    for (let pos = 1; pos <= 5; pos++) {
      if (myLineup[pos - 1] && myLineup[pos - 1] !== '') continue;
      if (myPosition && pos !== myPosition) continue;

      const eligibleHeroes = this.getHeroesForPosition(pos)
        .filter(hero => !excludedHeroIds.has(hero.id));

      const scoredHeroes = eligibleHeroes.map(hero => {
        const scores = this.getCandidateScores(hero.id, myLineup, enemyLineup, pos);
        return {
          heroId: hero.id,
          name: hero.name,
          position: pos,
          strength: scores.totalStrength,
          winRateDeviation: scores.winRateDeviation,
          counters: scores.counters,
          synergies: scores.synergies
        };
      });

      // Sort by strength ASCENDING (worst first) and take bottom 5
      scoredHeroes.sort((a, b) => a.strength - b.strength);
      notRecommended[pos] = scoredHeroes.slice(0, 5);
    }

    return notRecommended;
  },

  // Get enemy recommendations (what enemy might pick to counter us)
  getEnemyRecommendations(myLineup, enemyLineup, myPosition = null) {
    const enemyRecommendations = {};
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');
    const excludedHeroIds = new Set([...myTeam, ...enemyTeam]);

    // For enemy recommendations, we score based on how well they counter OUR team
    // Same as our recommendation logic, but from enemy's perspective

    for (let pos = 1; pos <= 5; pos++) {
      if (enemyLineup[pos - 1] && enemyLineup[pos - 1] !== '') continue; // Skip if enemy already has this pos
      if (myPosition && pos !== myPosition) continue;

      const eligibleHeroes = this.getHeroesForPosition(pos)
        .filter(hero => !excludedHeroIds.has(hero.id));

      const scoredHeroes = eligibleHeroes.map(hero => {
        const scores = this.getCandidateScoresForEnemy(hero.id, myLineup, enemyLineup, pos);
        return {
          heroId: hero.id,
          name: hero.name,
          position: pos,
          strength: scores.totalStrength,
          winRateDeviation: scores.winRateDeviation,
          counters: scores.counters,
          synergies: scores.synergies
        };
      });

      // Sort by strength DESCENDING and take top 5
      scoredHeroes.sort((a, b) => b.strength - a.strength);
      enemyRecommendations[pos] = scoredHeroes.slice(0, 5);
    }

    return enemyRecommendations;
  },

  // Get enemy NOT recommended (what enemy should avoid - we counter them)
  getEnemyNotRecommended(myLineup, enemyLineup, myPosition = null) {
    const enemyNotRecommended = {};
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');
    const excludedHeroIds = new Set([...myTeam, ...enemyTeam]);

    for (let pos = 1; pos <= 5; pos++) {
      if (enemyLineup[pos - 1] && enemyLineup[pos - 1] !== '') continue;
      if (myPosition && pos !== myPosition) continue;

      const eligibleHeroes = this.getHeroesForPosition(pos)
        .filter(hero => !excludedHeroIds.has(hero.id));

      const scoredHeroes = eligibleHeroes.map(hero => {
        const scores = this.getCandidateScoresForEnemy(hero.id, myLineup, enemyLineup, pos);
        return {
          heroId: hero.id,
          name: hero.name,
          position: pos,
          strength: scores.totalStrength,
          winRateDeviation: scores.winRateDeviation,
          counters: scores.counters,
          synergies: scores.synergies
        };
      });

      // Sort by strength ASCENDING (worst for enemy = best for us) and take bottom 5
      scoredHeroes.sort((a, b) => a.strength - b.strength);
      enemyNotRecommended[pos] = scoredHeroes.slice(0, 5);
    }

    return enemyNotRecommended;
  },

  // Enemy perspective: for each enemy position, which heroes counter my team best
  // The "recommendedPosition" here is the enemy's position slot we're filling
  getCandidateScoresForEnemy(candidateId, myLineup, enemyLineup, recommendedPosition = null) {
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');

    const candidate = this.getHeroById(candidateId);
    const winRateDeviation = ((candidate?.win_rate || 0.5) * 100 - 50);

    const counters = [];
    const synergies = [];
    let totalCounterScore = 0;
    let totalSynergyScore = 0;

    // From enemy's perspective: how my heroes counter the candidate
    // If I counter them, that's NEGATIVE for enemy (enemy should avoid)
    for (const myHero of myTeam) {
      if (myHero && myHero !== '') {
        let score = this.getCounterScore(myHero, candidateId);

        // Apply lane emphasis multiplier
        if (recommendedPosition && score !== 0) {
          const myPosIndex = myLineup.indexOf(myHero);
          const myPos = myPosIndex >= 0 ? myPosIndex + 1 : null;

          if (myPos && this.COUNTER_MULTIPLIERS[recommendedPosition]?.[myPos]) {
            const multiplier = this.COUNTER_MULTIPLIERS[recommendedPosition][myPos];
            score *= multiplier;
          }
        }

        const myHeroName = this.getHeroById(myHero)?.name || myHero;
        counters.push({ heroId: myHero, heroName: myHeroName, score: -score });
        totalCounterScore -= score;
      }
    }

    // Synergy with enemy teammates
    for (const enemyHero of enemyTeam) {
      if (enemyHero && enemyHero !== '') {
        let score = this.getSynergyScore(candidateId, enemyHero);

        // Apply lane emphasis for enemy synergies too
        if (recommendedPosition && score !== 0) {
          const enemyPosIndex = enemyLineup.indexOf(enemyHero);
          const enemyPos = enemyPosIndex >= 0 ? enemyPosIndex + 1 : null;

          if (enemyPos && this.SYNERGY_MULTIPLIERS[recommendedPosition]?.[enemyPos]) {
            const multiplier = this.SYNERGY_MULTIPLIERS[recommendedPosition][enemyPos];
            score *= multiplier;
          }
        }

        const enemyHeroName = this.getHeroById(enemyHero)?.name || enemyHero;
        synergies.push({ heroId: enemyHero, heroName: enemyHeroName, score: score });
        totalSynergyScore += score;
      }
    }

    // 综合评分：应用权重
    const rawTotal = this.WEIGHTS.winRateDeviation * winRateDeviation
                   + this.WEIGHTS.counter * totalCounterScore
                   + this.WEIGHTS.synergy * totalSynergyScore;

    return {
      winRateDeviation,
      totalCounterScore: Math.round(totalCounterScore * 100) / 100,
      totalSynergyScore: Math.round(totalSynergyScore * 100) / 100,
      totalStrength: Math.round(rawTotal * 100) / 100
    };
  }
};

// Export
window.BP = BP;