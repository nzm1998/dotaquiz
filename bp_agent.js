// ==================== HEROES CACHE ====================
const HEROES_CACHE_KEY = 'heroes_knowledge_v5';
// v4: pre-filled avatarUrl in heroes_knowledge.json (all 127 heroes).
// v3: dropped the `name` field (matrix CSV is source of truth).
const HEROES_VERSION = '3.2.0';
const COUNTER_MATRIX_KEY = 'counter_matrix_v1';
const SYNERGY_MATRIX_KEY = 'synergy_matrix_v1';
const MATRIX_CACHE_TTL = 24 * 60 * 60 * 1000;

async function loadCachedOrFetch(url, cacheKey) {
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < MATRIX_CACHE_TTL) {
        console.log(`Using cached ${cacheKey}`);
        return data;
      }
    } catch (e) { /* ignore */ }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const data = await res.json ? await res.json() : await res.text();
  localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
  console.log(`Fetched fresh ${cacheKey}`);
  return data;
}

async function loadText(url, cacheKey) {
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < MATRIX_CACHE_TTL) {
        console.log(`Using cached ${cacheKey}`);
        return data;
      }
    } catch (e) { /* ignore */ }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  localStorage.setItem(cacheKey, JSON.stringify({ data: text, timestamp: Date.now() }));
  console.log(`Fetched fresh ${cacheKey}`);
  return text;
}

// Parse a simple CSV (no quoting/escaping) into { colNames, rowNames, data }.
// matrix[rowIdx][colIdx] corresponds to rowNames[rowIdx] vs colNames[colIdx].
function parseMatrixCSV(text) {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const split = (line) => line.split(',').map(s => s.trim());
  const headerFields = split(lines[0]);
  const colNames = headerFields.slice(1);
  const rowNames = [];
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = split(lines[i]);
    if (fields.length === 0 || (fields.length === 1 && fields[0] === '')) continue;
    rowNames.push(fields[0]);
    const values = fields.slice(1);
    const row = new Array(colNames.length).fill(0);
    for (let j = 0; j < colNames.length; j++) {
      const v = values[j];
      if (v === undefined || v === '') {
        row[j] = 0;
      } else {
        const n = parseFloat(v);
        row[j] = isNaN(n) ? 0 : n;
      }
    }
    data.push(row);
  }
  return { colNames, rowNames, data };
}

// ==================== DOTA2 BP AGENT - CORE LOGIC ====================
const BP = {
  heroesData: null,
  counterMatrix: null,
  synergyMatrix: null,
  idToMatrixIdx: null,
  positionModifiers: null,
  getHeroName(heroId) {
    if (!heroId || !this.counterMatrix) return heroId || '';
    const idx = this.idToMatrixIdx[heroId];
    if (idx === undefined) return heroId;
    return this.counterMatrix.rowNames[idx] || heroId;
  },

  get COUNTER_MIRROR_MID() { return this.positionModifiers?.counter?.mid_vs_mid ?? 1; },
  get COUNTER_LANE_15_VS_34() { return this.positionModifiers?.counter?.lane_15_vs_34 ?? 1; },
  get COUNTER_CORE_PROTECTION() { return this.positionModifiers?.counter?.core_protection ?? 1; },
  get SYNERGY_LANE_15() { return this.positionModifiers?.synergy?.lane_15 ?? 1; },
  get SYNERGY_LANE_34() { return this.positionModifiers?.synergy?.lane_34 ?? 1; },
  get SYNERGY_MID_SUPPORT() { return this.positionModifiers?.synergy?.mid_support ?? 1; },

  async loadHeroes() {
    const jsonData = await loadCachedOrFetch('heroes_knowledge.json', HEROES_CACHE_KEY);
    this.heroesData = jsonData.heroes; // array, order = matrix row order
    this.positionModifiers = jsonData.position_modifiers || {
      counter: { mid_vs_mid: 1.4, lane_15_vs_34: 1.2, core_protection: 1.2 },
      synergy: { lane_15: 1.2, lane_34: 1.2, mid_support: 1.2 },
    };

    const [counterText, synergyText] = await Promise.all([
      loadText('counter_matrix.csv', COUNTER_MATRIX_KEY),
      loadText('synergy_matrix.csv', SYNERGY_MATRIX_KEY),
    ]);
    this.counterMatrix = parseMatrixCSV(counterText);
    this.synergyMatrix = parseMatrixCSV(synergyText);

    // Heroes array is in the same order as the matrix rows, so the array index
    // is the matrix index. No name-based lookup needed.
    this.idToMatrixIdx = {};
    for (let i = 0; i < this.heroesData.length; i++) {
      this.idToMatrixIdx[this.heroesData[i].id] = i;
    }
    if (this.heroesData.length !== this.counterMatrix.rowNames.length) {
      console.warn(`Heroes array length (${this.heroesData.length}) does not match matrix row count (${this.counterMatrix.rowNames.length}); alignment may be off.`);
    }

    console.log(`Loaded ${this.heroesData.length} heroes, ${this.counterMatrix.rowNames.length}x${this.counterMatrix.colNames.length} counter, ${this.synergyMatrix.rowNames.length}x${this.synergyMatrix.colNames.length} synergy`);
    // Pre-filled avatarUrl in heroes_knowledge.json is the source of truth
    // (all 127 heroes). OpenDota is kept only as a fallback in case a future
    // hero ships without one — the common case is fully covered by the
    // static file and survives localStorage / network failures.
    let prefilled = 0;
    for (const h of this.heroesData) if (h.avatarUrl) prefilled++;
    console.log(`Heroes with pre-filled avatarUrl: ${prefilled}/${this.heroesData.length}`);
    try {
      const stats = await loadCachedOrFetch('https://api.opendota.com/api/heroStats', HEROES_CACHE_KEY + '_stats');
      const statsByName = {};
      for (const s of stats) statsByName[s.name] = s;
      let filledFromOpendota = 0;
      for (const h of this.heroesData) {
        if (h.avatarUrl) continue;
        const s = statsByName[h.id];
        if (s && s.icon) {
          h.avatarUrl = `https://api.opendota.com${s.icon}`;
          filledFromOpendota++;
        }
      }
      if (filledFromOpendota > 0) console.log(`OpenDota fallback filled ${filledFromOpendota} missing avatars`);
    } catch (e) {
      console.warn('OpenDota heroStats unavailable; relying on pre-filled avatarUrl only', e);
    }
    // Anything still null keeps the colored-tile fallback in the UI.
    return true;
  },

  // ==================== HERO QUERIES ====================
  getAllHeroes() {
    return this.heroesData || [];
  },

  getHeroById(heroId) {
    if (!this.heroesData) return null;
    return this.heroesData.find(h => h.id === heroId) || null;
  },

  getHeroAvatarUrl(heroId) {
    const h = this.getHeroById(heroId);
    return h ? (h.avatarUrl || null) : null;
  },

  canPlayPosition(heroId, position) {
    const hero = this.getHeroById(heroId);
    if (!hero || !hero.roles) return false;
    return hero.roles.includes(position);
  },

  getHeroesForPosition(position) {
    return this.getAllHeroes().filter(hero => this.canPlayPosition(hero.id, position));
  },

  // ==================== MATRIX LOOKUPS ====================
  // Counter matrix semantics:
  //   counterMatrix[row][col] > 0  -> row counters col
  //   counterMatrix[row][col] < 0  -> col counters row
  getCounterScore(heroAId, heroBId) {
    const aIdx = this.idToMatrixIdx[heroAId];
    const bIdx = this.idToMatrixIdx[heroBId];
    if (aIdx === undefined || bIdx === undefined) return 0;
    return this.counterMatrix.data[aIdx][bIdx];
  },

  getSynergyScore(heroAId, heroBId) {
    const aIdx = this.idToMatrixIdx[heroAId];
    const bIdx = this.idToMatrixIdx[heroBId];
    if (aIdx === undefined || bIdx === undefined) return 0;
    const ab = this.synergyMatrix.data[aIdx][bIdx];
    const ba = this.synergyMatrix.data[bIdx][aIdx];
    return (ab + ba) / 2;
  },

  // ==================== POSITION-AWARE MULTIPLIERS ====================
  // Returns { forward, reverse } multipliers for a (myPos, enemyPos) pair.
  // Forward = "candidate counters enemy" multiplier
  // Reverse = "enemy counters candidate" multiplier (core protection stacks here)
  getCounterMultipliers(myPos, enemyPos) {
    if (!myPos || !enemyPos) return { forward: 1, reverse: 1 };
    let laneMid = 1;
    // (a) Mid vs mid mirror matchup
    if (myPos === 2 && enemyPos === 2) laneMid *= this.COUNTER_MIRROR_MID;
    // (b) 1/5 vs 3/4 lane matchup (both directions)
    const myIsCarryOrHardSup = (myPos === 1 || myPos === 5);
    const myIsOffOrSoftSup = (myPos === 3 || myPos === 4);
    const enemyIsCarryOrHardSup = (enemyPos === 1 || enemyPos === 5);
    const enemyIsOffOrSoftSup = (enemyPos === 3 || enemyPos === 4);
    if (myIsCarryOrHardSup && enemyIsOffOrSoftSup) laneMid *= this.COUNTER_LANE_15_VS_34;
    if (myIsOffOrSoftSup && enemyIsCarryOrHardSup) laneMid *= this.COUNTER_LANE_15_VS_34;
    // (c) Core protection: amplify the reverse direction when our position is 1 or 2
    const core = (myPos === 1 || myPos === 2) ? this.COUNTER_CORE_PROTECTION : 1;
    return { forward: laneMid, reverse: laneMid * core };
  },

  getSynergyMultiplier(myPos, teammatePos) {
    if (!myPos || !teammatePos) return 1;
    let mult = 1;
    const pair = [myPos, teammatePos].sort().join('-');
    if (pair === '1-5') mult *= this.SYNERGY_LANE_15;
    if (pair === '3-4') mult *= this.SYNERGY_LANE_34;
    if ((myPos === 2 && (teammatePos === 4 || teammatePos === 5)) ||
        (teammatePos === 2 && (myPos === 4 || myPos === 5))) {
      mult *= this.SYNERGY_MID_SUPPORT;
    }
    return mult;
  },

  // ==================== CANDIDATE SCORING ====================
  // Net counter = forward * forwardMult - reverse * reverseMult
  getCandidateScores(candidateId, myLineup, enemyLineup, recommendedPosition = null) {
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');

    const candidate = this.getHeroById(candidateId);
    const winRateScore = (candidate?.win || 0) * 5;

    const counters = [];
    const synergies = [];
    let totalStrength = winRateScore;

    for (const enemyHero of enemyTeam) {
      const forward = this.getCounterScore(candidateId, enemyHero);
      const reverse = this.getCounterScore(enemyHero, candidateId);

      let forwardAdj = forward;
      let reverseAdj = reverse;
      if (recommendedPosition) {
        const enemyPosIdx = enemyLineup.indexOf(enemyHero);
        const enemyPos = enemyPosIdx >= 0 ? enemyPosIdx + 1 : null;
        const { forward: fMult, reverse: rMult } = this.getCounterMultipliers(recommendedPosition, enemyPos);
        forwardAdj = forward * fMult;
        reverseAdj = reverse * rMult;
      }

      const netCounter = forwardAdj - reverseAdj;
      totalStrength += netCounter;

      const enemyName = this.getHeroName(enemyHero);
      counters.push({
        heroId: enemyHero,
        heroName: enemyName,
        forward: forwardAdj,
        reverse: reverseAdj,
        net: netCounter
      });
    }

    for (const myHero of myTeam) {
      let score = this.getSynergyScore(candidateId, myHero);
      if (recommendedPosition && score !== 0) {
        const teammatePosIdx = myLineup.indexOf(myHero);
        const teammatePos = teammatePosIdx >= 0 ? teammatePosIdx + 1 : null;
        const mult = this.getSynergyMultiplier(recommendedPosition, teammatePos);
        score *= mult;
      }
      const myHeroName = this.getHeroName(myHero);
      synergies.push({ heroId: myHero, heroName: myHeroName, score });
      totalStrength += score;
    }

    return {
      counters,
      synergies,
      winRateScore,
      totalStrength: Math.round(totalStrength * 100) / 100
    };
  },

  getCandidateScoresForEnemy(candidateId, myLineup, enemyLineup, recommendedPosition = null) {
    const myTeam = myLineup.filter(id => id && id !== '');
    const enemyTeam = enemyLineup.filter(id => id && id !== '');

    const candidate = this.getHeroById(candidateId);
    const winRateScore = (candidate?.win || 0) * 5;

    const counters = [];
    const synergies = [];
    let totalStrength = winRateScore;

    for (const myHero of myTeam) {
      const forward = this.getCounterScore(candidateId, myHero);
      const reverse = this.getCounterScore(myHero, candidateId);

      let forwardAdj = forward;
      let reverseAdj = reverse;
      if (recommendedPosition) {
        const myPosIdx = myLineup.indexOf(myHero);
        const myPos = myPosIdx >= 0 ? myPosIdx + 1 : null;
        const { forward: fMult, reverse: rMult } = this.getCounterMultipliers(recommendedPosition, myPos);
        forwardAdj = forward * fMult;
        reverseAdj = reverse * rMult;
      }

      const net = forwardAdj - reverseAdj;
      totalStrength += net;

      const myHeroName = this.getHeroName(myHero);
      counters.push({
        heroId: myHero,
        heroName: myHeroName,
        forward: forwardAdj,
        reverse: reverseAdj,
        net
      });
    }

    for (const enemyHero of enemyTeam) {
      let score = this.getSynergyScore(candidateId, enemyHero);
      if (recommendedPosition && score !== 0) {
        const enemyPosIdx = enemyLineup.indexOf(enemyHero);
        const enemyPos = enemyPosIdx >= 0 ? enemyPosIdx + 1 : null;
        const mult = this.getSynergyMultiplier(recommendedPosition, enemyPos);
        score *= mult;
      }
      const enemyHeroName = this.getHeroName(enemyHero);
      synergies.push({ heroId: enemyHero, heroName: enemyHeroName, score });
      totalStrength += score;
    }

    return {
      counters,
      synergies,
      winRateScore,
      totalStrength: Math.round(totalStrength * 100) / 100
    };
  },

  // ==================== LINEUP STRENGTH ====================
  // Returns a breakdown so the UI can show each component separately.
  //   winRateScore  = sum of (hero.win * 5)
  //   synergyScore  = sum of synergies between teammates
  //   counterScore  = sum of (forward - reverse) against the opposing team
  //   total         = winRateScore + synergyScore + counterScore
  getLineupScoreBreakdown(lineup, opposingLineup) {
    const team = lineup.filter(id => id && id !== '');
    const opp = opposingLineup.filter(id => id && id !== '');

    let winRateScore = 0;
    for (const heroId of team) {
      const hero = this.getHeroById(heroId);
      if (hero?.win) winRateScore += hero.win * 5;
    }

    let synergyScore = 0;
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        synergyScore += this.getSynergyScore(team[i], team[j]);
      }
    }

    let counterScore = 0;
    for (const myHero of team) {
      for (const enemyHero of opp) {
        const forward = this.getCounterScore(myHero, enemyHero);
        const reverse = this.getCounterScore(enemyHero, myHero);
        counterScore += forward - reverse;
      }
    }

    const round = (n) => Math.round(n * 100) / 100;
    return {
      winRateScore: round(winRateScore),
      synergyScore: round(synergyScore),
      counterScore: round(counterScore),
      total: round(winRateScore + synergyScore + counterScore),
      heroCount: team.length,
      opponentCount: opp.length
    };
  },

  // Backwards-compatible: returns just the total
  calculateLineupStrength(lineup, opposingLineup) {
    return this.getLineupScoreBreakdown(lineup, opposingLineup).total;
  },

  getTotalLineupStrength(lineup, opposingLineup) {
    return this.getLineupScoreBreakdown(lineup, opposingLineup).total;
  },

  // ==================== BP ADVICE ====================
  // For a given position we're about to fill, return the best hero to pick
  // (assuming we only fill THIS slot — other empty slots stay empty).
  // The "score difference" is: myLineupWithCandidate - enemyLineup.
  // We also include myLineup strength without the candidate for context.
  getBPAdvice(myLineup, enemyLineup, position, mode = 'position') {
    if (!position || position < 1 || position > 5) {
      return { error: '请提供 1-5 的位置' };
    }
      if (myLineup[position - 1]) {
        const occupied = myLineup[position - 1];
        return { error: `该位置已选择英雄：${this.getHeroName(occupied) || ''}` };
      }
    const enemyTeam = enemyLineup.filter(id => id && id !== '');
    if (enemyTeam.length === 0) {
      return { error: '请先选择至少一个敌方英雄' };
    }

    const myTeam = myLineup.filter(id => id && id !== '');
    const excluded = new Set([...myTeam, ...enemyTeam]);

    const pool = mode === 'random'
      ? this.getAllHeroes().filter(h => !excluded.has(h.id))
      : this.getHeroesForPosition(position).filter(h => !excluded.has(h.id));

    const myBaseline = this.getLineupScoreBreakdown(myLineup, enemyLineup);
    const enemyBaseline = this.getLineupScoreBreakdown(enemyLineup, myLineup);

    const candidates = [];
    for (const hero of pool) {
      const trialLineup = myLineup.slice();
      trialLineup[position - 1] = hero.id;
      const myWithHero = this.getLineupScoreBreakdown(trialLineup, enemyLineup);
      const enemyVsTrial = this.getLineupScoreBreakdown(enemyLineup, trialLineup);
      const delta = (myWithHero.total - enemyVsTrial.total) - (myBaseline.total - enemyBaseline.total);
      candidates.push({
        heroId: hero.id,
        name: this.getHeroName(hero.id),
        position,
        myTotal: myWithHero.total,
        enemyTotal: enemyVsTrial.total,
        gap: myWithHero.total - enemyVsTrial.total,
        delta,
        myBreakdown: myWithHero,
        enemyBreakdown: enemyVsTrial
      });
    }

    if (candidates.length === 0) {
      return { error: '没有可选的英雄' };
    }

    candidates.sort((a, b) => b.gap - a.gap);
    return {
      position,
      baseline: {
        my: myBaseline,
        enemy: enemyBaseline,
        currentGap: myBaseline.total - enemyBaseline.total
      },
      top: candidates.slice(0, 8),
      all: candidates
    };
  },

  // ==================== RECOMMENDATIONS ====================
  // mode = 'position' (default, filter pool by position eligibility)
  //      | 'random'   (pool is all 127 heroes, no position filter, but still
  //                    ranked by counter/synergy score)
  _getEligibleHeroes(position, excludedHeroIds, mode) {
    const pool = mode === 'random' ? this.getAllHeroes() : this.getHeroesForPosition(position);
    return pool.filter(h => !excludedHeroIds.has(h.id));
  },

  _formatHero(hero, position, scores) {
    return {
      heroId: hero.id,
      name: this.getHeroName(hero.id),
      position,
      strength: scores.totalStrength,
      winRateScore: scores.winRateScore,
      counters: scores.counters,
      synergies: scores.synergies
    };
  },

  getRecommendations(myLineup, enemyLineup, myPosition = null, mode = 'position') {
    const recommendations = {};
    const excludedHeroIds = new Set([
      ...myLineup.filter(id => id && id !== ''),
      ...enemyLineup.filter(id => id && id !== ''),
    ]);

    for (let pos = 1; pos <= 5; pos++) {
      if (myLineup[pos - 1] && myLineup[pos - 1] !== '') continue;
      if (myPosition && pos !== myPosition) continue;
      const eligible = this._getEligibleHeroes(pos, excludedHeroIds, mode);
      const scored = eligible.map(hero => {
        const scores = this.getCandidateScores(hero.id, myLineup, enemyLineup, pos);
        return this._formatHero(hero, pos, scores);
      });
      scored.sort((a, b) => b.strength - a.strength);
      recommendations[pos] = scored.slice(0, 8);
    }
    return recommendations;
  },

  getNotRecommended(myLineup, enemyLineup, myPosition = null, mode = 'position') {
    const notRecommended = {};
    const excludedHeroIds = new Set([
      ...myLineup.filter(id => id && id !== ''),
      ...enemyLineup.filter(id => id && id !== ''),
    ]);

    for (let pos = 1; pos <= 5; pos++) {
      if (myLineup[pos - 1] && myLineup[pos - 1] !== '') continue;
      if (myPosition && pos !== myPosition) continue;
      const eligible = this._getEligibleHeroes(pos, excludedHeroIds, mode);
      const scored = eligible.map(hero => {
        const scores = this.getCandidateScores(hero.id, myLineup, enemyLineup, pos);
        return this._formatHero(hero, pos, scores);
      });
      scored.sort((a, b) => a.strength - b.strength);
      notRecommended[pos] = scored.slice(0, 8);
    }
    return notRecommended;
  },

  getEnemyRecommendations(myLineup, enemyLineup, myPosition = null, mode = 'position') {
    const enemyRecommendations = {};
    const excludedHeroIds = new Set([
      ...myLineup.filter(id => id && id !== ''),
      ...enemyLineup.filter(id => id && id !== ''),
    ]);

    for (let pos = 1; pos <= 5; pos++) {
      if (enemyLineup[pos - 1] && enemyLineup[pos - 1] !== '') continue;
      if (myPosition && pos !== myPosition) continue;
      const eligible = this._getEligibleHeroes(pos, excludedHeroIds, mode);
      const scored = eligible.map(hero => {
        const scores = this.getCandidateScoresForEnemy(hero.id, myLineup, enemyLineup, pos);
        return this._formatHero(hero, pos, scores);
      });
      scored.sort((a, b) => b.strength - a.strength);
      enemyRecommendations[pos] = scored.slice(0, 8);
    }
    return enemyRecommendations;
  },

  getEnemyNotRecommended(myLineup, enemyLineup, myPosition = null, mode = 'position') {
    const enemyNotRecommended = {};
    const excludedHeroIds = new Set([
      ...myLineup.filter(id => id && id !== ''),
      ...enemyLineup.filter(id => id && id !== ''),
    ]);

    for (let pos = 1; pos <= 5; pos++) {
      if (enemyLineup[pos - 1] && enemyLineup[pos - 1] !== '') continue;
      if (myPosition && pos !== myPosition) continue;
      const eligible = this._getEligibleHeroes(pos, excludedHeroIds, mode);
      const scored = eligible.map(hero => {
        const scores = this.getCandidateScoresForEnemy(hero.id, myLineup, enemyLineup, pos);
        return this._formatHero(hero, pos, scores);
      });
      scored.sort((a, b) => a.strength - b.strength);
      enemyNotRecommended[pos] = scored.slice(0, 8);
    }
    return enemyNotRecommended;
  }
};

window.BP = BP;
