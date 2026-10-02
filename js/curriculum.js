// ── Study Buddy: curriculum accessors, mastery and XP math ──
// DOM-free on purpose: loaded by index.html AND by node (tools/test_prompts.js).
// Expects window.CURRICULUM (from data/*.js) and window.SUBJECT_ORDER (from js/subjects.js).
(function (root) {
  'use strict';

  const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];
  const SUBJECT_ORDER = root.SUBJECT_ORDER || ['math', 'history', 'science', 'ela', 'classics'];

  function C() { return root.CURRICULUM || {}; }
  function gradeKey(grade) { return String(grade === 0 ? 'K' : grade); }

  // ── Challenge tiers ──
  // The tier table lives in js/subjects.js (window.Prompts); this file just does the grade math.
  function tierDef(tierId) {
    const P = root.Prompts;
    return (P && P.tierById) ? P.tierById(tierId) : { id: 'pro', offset: 0, multiplier: 1 };
  }
  function gradeIndex(grade) {
    const i = GRADES.indexOf(gradeKey(grade));
    return i < 0 ? 4 : i;
  }
  // The curriculum grade a tier points at, clamped to the grades we have data for.
  function tierGrade(baseGrade, tierId) {
    const i = gradeIndex(baseGrade) + tierDef(tierId).offset;
    return GRADES[Math.max(0, Math.min(GRADES.length - 1, i))];
  }
  // False when the offset would clamp — e.g. All-Star and Hall of Fame are both
  // Grade 8 for a Grade 8 student, which would be a free points multiplier.
  function tierAvailable(baseGrade, tierId) {
    const i = gradeIndex(baseGrade) + tierDef(tierId).offset;
    return i >= 0 && i < GRADES.length;
  }
  function getTier(user, subject) {
    const t = ((user && user.challengeTiers) || {})[subject];
    return t || 'pro';
  }
  function tierMultiplier(tierId) { return tierDef(tierId).multiplier; }

  // Generic literary-analysis skills used for Core Classics when a grade has no book briefs.
  const CLASSICS_GENERIC_SKILLS = [
    'Summarize a chapter in a few sentences, in order, using the characters\' names.',
    'Describe the setting (time and place) and explain how it affects the story.',
    'Explain what a main character wants and what stands in the way.',
    'Explain why a character makes an important choice, using evidence from the text.',
    'Identify a theme of the book and give two examples that support it.',
    'Explain the meaning of a short quoted passage in your own words.',
    'Identify the narrator or point of view and how it shapes what we know.',
    'Use context clues to figure out the meaning of an unfamiliar word.',
    'Make a prediction about what will happen next and explain your reasoning.',
    'Compare two characters or two events and explain how they are alike and different.',
  ];

  function classicsGradeData(grade) {
    const g = gradeKey(grade);
    const skills = CLASSICS_GENERIC_SKILLS.map(s => ({ section: 'Reading Literature', skill: s }));
    const briefs = C().briefs || {};
    (getUnits('classics', g) || []).forEach(u => {
      const b = briefs[u.id];
      if (b && b.lessons && b.lessons.length) {
        b.lessons.forEach(l => skills.push({ section: u.title, skill: `${l.title}: ${l.focus}` }));
      }
    });
    return { strands: [], skills };
  }

  function getGradeData(subject, grade) {
    if (subject === 'classics') return classicsGradeData(grade);
    const subj = C()[subject];
    return subj ? (subj[gradeKey(grade)] || null) : null;
  }

  // Flat skill list with stable-ish indices: sectionIndex = order of first appearance of the section label.
  function getGradeSkills(subject, grade) {
    const data = getGradeData(subject, grade);
    if (!data || !data.skills) return [];
    const sectionIndex = new Map();
    const counters = [];
    const out = [];
    data.skills.forEach(s => {
      if (!sectionIndex.has(s.section)) { sectionIndex.set(s.section, sectionIndex.size); counters.push(0); }
      const si = sectionIndex.get(s.section);
      const ki = counters[si]++;
      out.push({ sectionIndex: si, skillIndex: ki, section: s.section, skill: s.skill });
    });
    return out;
  }

  function getSections(subject, grade) {
    const seen = new Map();
    getGradeSkills(subject, grade).forEach(s => {
      if (!seen.has(s.sectionIndex)) seen.set(s.sectionIndex, { section: s.section, total: 0 });
      seen.get(s.sectionIndex).total++;
    });
    return [...seen.values()];
  }

  function getUnits(subject, grade) {
    const units = (C().units || {})[subject] || {};
    const list = (units[gradeKey(grade)] || []).slice();
    if (subject === 'classics' && units.any) list.push(...units.any);
    return list;
  }

  function getUnit(id) {
    const units = C().units || {};
    for (const subject of Object.keys(units)) {
      for (const g of Object.keys(units[subject])) {
        const found = units[subject][g].find(u => u.id === id);
        if (found) return found;
      }
    }
    return null;
  }

  function getBrief(unitId) {
    return (C().briefs || {})[unitId] || null;
  }

  // ── User record migration (Math Buddy → Study Buddy) ──
  function isGradeKey(k) { return GRADES.includes(String(k)); }

  function migrateUser(user) {
    if (!user || typeof user !== 'object') return user;
    const ms = user.masteredSkills;
    if (ms && typeof ms === 'object' && Object.keys(ms).some(isGradeKey)) {
      const migrated = {};
      Object.keys(ms).forEach(k => {
        if (isGradeKey(k)) { migrated.math = migrated.math || {}; migrated.math[k] = ms[k]; }
        else migrated[k] = ms[k];
      });
      user.masteredSkills = migrated;
    }
    const hs = user.homeworkSessions;
    if (hs && typeof hs === 'object') {
      const migrated = {};
      Object.keys(hs).forEach(k => {
        const key = /^[0-9]+$/.test(k) || k === 'homework' ? `math:legacy-${k}` : k;
        migrated[key] = (migrated[key] || 0) + (hs[k] || 0);
      });
      user.homeworkSessions = migrated;
    }
    if (Array.isArray(user.retestSuggested) && user.retestSuggested.some(x => typeof x === 'number')) {
      user.retestSuggested = ['math'];
    }
    if (!user.challengeTiers || typeof user.challengeTiers !== 'object') user.challengeTiers = {};
    // Gear the student already wears stays theirs even if it is now an unlock.
    if (!user.points && user.avatarAccessory && !user.avatarGrandfathered) {
      user.avatarGrandfathered = user.avatarAccessory;
    }
    ensurePoints(user);
    ensureStreak(user);
    ensureTrophies(user);
    return user;
  }

  // ── Mastery ──
  function getMasteredKeys(user, subject, grade) {
    const ms = (user && user.masteredSkills) || {};
    const bySubject = ms[subject] || {};
    return new Set(bySubject[gradeKey(grade)] || []);
  }

  function getUnmasteredSkills(user, subject, grade, limit) {
    const mastered = getMasteredKeys(user, subject, grade);
    const all = getGradeSkills(subject, grade);
    const rest = all.filter(s => !mastered.has(`${s.sectionIndex}:${s.skillIndex}`));
    return limit ? rest.slice(0, limit) : rest;
  }

  // Pure: returns a new masteredSkills object with the keys added.
  function addMastered(masteredSkills, subject, grade, keys) {
    const ms = JSON.parse(JSON.stringify(masteredSkills || {}));
    ms[subject] = ms[subject] || {};
    const g = gradeKey(grade);
    const set = new Set(ms[subject][g] || []);
    (keys || []).forEach(k => set.add(k));
    ms[subject][g] = [...set];
    return ms;
  }

  function getSkillMasteryStats(user, subject, grade) {
    const mastered = getMasteredKeys(user, subject, grade);
    const skills = getGradeSkills(subject, grade);
    const sections = getSections(subject, grade).map((sec, si) => ({ section: sec.section, total: sec.total, done: 0, pct: 0 }));
    skills.forEach(s => { if (mastered.has(`${s.sectionIndex}:${s.skillIndex}`)) sections[s.sectionIndex].done++; });
    sections.forEach(s => { s.pct = s.total ? Math.round(s.done / s.total * 100) : 0; });
    const totalSkills = skills.length;
    const totalMastered = sections.reduce((n, s) => n + s.done, 0);
    return { subject, grade: gradeKey(grade), sections, totalSkills, totalMastered, pct: totalSkills ? Math.round(totalMastered / totalSkills * 100) : 0 };
  }

  function getOverallMastery(user, grade) {
    const per = SUBJECT_ORDER.map(s => getSkillMasteryStats(user, s, grade));
    const totalSkills = per.reduce((n, s) => n + s.totalSkills, 0);
    const totalMastered = per.reduce((n, s) => n + s.totalMastered, 0);
    return { subjects: per, totalSkills, totalMastered, pct: totalSkills ? Math.round(totalMastered / totalSkills * 100) : 0 };
  }

  // ── Mastery across grades ──
  // A student who plays up a level banks mastery under that grade, so several
  // grade buckets can be live at once for one subject.
  function getMasteredGrades(user, subject) {
    const by = ((user && user.masteredSkills) || {})[subject] || {};
    return GRADES.filter(g => (by[g] || []).length > 0);
  }
  function getActiveGrades(user, subject, currentGrade) {
    const set = new Set(getMasteredGrades(user, subject));
    if (currentGrade !== null && currentGrade !== undefined) set.add(gradeKey(currentGrade));
    return GRADES.filter(g => set.has(g));
  }
  function getSubjectMasteryAcross(user, subject, grades) {
    const per = (grades || []).map(g => getSkillMasteryStats(user, subject, g));
    return {
      subject,
      grades: per,
      totalSkills: per.reduce((n, s) => n + s.totalSkills, 0),
      totalMastered: per.reduce((n, s) => n + s.totalMastered, 0),
    };
  }
  function getLifetimeMastered(user) {
    const ms = (user && user.masteredSkills) || {};
    return Object.keys(ms).reduce((n, subj) => {
      const byG = ms[subj] || {};
      return n + Object.keys(byG).reduce((m, g) => m + (byG[g] || []).length, 0);
    }, 0);
  }

  // ── XP ──
  function calcUserXP(user) {
    if (!user) return 0;
    let xp = 0;
    const ms = user.masteredSkills || {};
    Object.keys(ms).forEach(subject => {
      const byGrade = ms[subject] || {};
      Object.keys(byGrade).forEach(g => {
        const keys = byGrade[g] || [];
        xp += keys.length * 10;
        const sections = getSections(subject, g);
        const set = new Set(keys);
        let all = 0;
        getGradeSkills(subject, g).forEach(s => { if (set.has(`${s.sectionIndex}:${s.skillIndex}`)) { sections[s.sectionIndex].done = (sections[s.sectionIndex].done || 0) + 1; all++; } });
        sections.forEach(sec => { if (sec.total > 0 && (sec.done || 0) >= sec.total) xp += 50; });
        const totalSkills = sections.reduce((n, s) => n + s.total, 0);
        if (totalSkills > 0 && all >= totalSkills) xp += 200;
      });
    });
    const totalSessions = Object.values(user.homeworkSessions || {}).reduce((a, b) => a + b, 0);
    xp += totalSessions * 5;
    // Legacy: XP from old test scores (users pre-skills system)
    if (xp === totalSessions * 5) {
      const history = (user.testHistory && user.testHistory.length > 0)
        ? user.testHistory
        : (user.reportCard ? [{ score: user.reportCard.overallScore || 0 }] : []);
      history.forEach((t, i) => {
        xp += Math.round(t.score || 0);
        if (i > 0 && t.score > history[i - 1].score) xp += 20;
      });
    }
    return xp;
  }

  // One ladder, used for both the level badge and the leaderboard progress bar.
  const LEVELS = [
    { min: 0,    label: 'Seedling',    icon: '🌱', color: '#16a34a' },
    { min: 100,  label: 'Scholar',     icon: '📚', color: '#2563eb' },
    { min: 400,  label: 'Rising Star', icon: '⭐', color: '#7c3aed' },
    { min: 1000, label: 'Whiz',        icon: '🔥', color: '#f97316' },
    { min: 2500, label: 'Champion',    icon: '🏆', color: '#f59e0b' },
    { min: 5000, label: 'Legend',      icon: '👑', color: '#dc2626' },
  ];
  const LEVEL_THRESHOLDS = LEVELS.map(l => l.min);

  function getUserLevel(xp) {
    let i = 0;
    for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].min) i = k;
    const l = LEVELS[i];
    return { label: l.label, icon: l.icon, color: l.color, next: i + 1 < LEVELS.length ? LEVELS[i + 1].min : null };
  }
  // The floor of the band xp sits in, for drawing progress within a level.
  function getLevelFloor(xp) {
    let floor = 0;
    LEVEL_THRESHOLDS.forEach(t => { if (xp >= t) floor = t; });
    return floor;
  }

  // ── Points log ──
  // XP used to be derived from mastery on every read, which left no room for bonus
  // points or for "how many points today". Points are now appended to a log with a
  // local date stamp, and `lifetime` is the authoritative running total.
  const POINTS_LOG_CAP = 500;

  function localDateString(d) {
    d = d || new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Day distance between two 'YYYY-MM-DD' strings, anchored at local noon so DST
  // shifts can't turn 24 hours into 23 and lose a day.
  function dayDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    const da = new Date(pa[0], pa[1] - 1, pa[2], 12);
    const db = new Date(pb[0], pb[1] - 1, pb[2], 12);
    return Math.round((db - da) / 86400000);
  }

  function ensurePoints(user) {
    if (!user.points || typeof user.points !== 'object') {
      // One-time baseline so nobody's existing score resets to zero.
      const base = calcUserXP(user);
      user.points = {
        v: 1,
        lifetime: base,
        log: base > 0 ? [{ t: Date.now(), d: localDateString(), k: 'legacy', p: base }] : [],
      };
    }
    if (typeof user.points.lifetime !== 'number') user.points.lifetime = 0;
    if (!Array.isArray(user.points.log)) user.points.log = [];
    return user.points;
  }

  function appendPoints(user, entry) {
    const pts = ensurePoints(user);
    pts.log.push(entry);
    pts.lifetime += entry.p || 0;
    // Safe to trim: lifetime is stored, so the log only has to cover recent days.
    if (pts.log.length > POINTS_LOG_CAP) pts.log.splice(0, pts.log.length - POINTS_LOG_CAP);
    return pts.lifetime;
  }

  function getLifetimePoints(user) {
    if (user && user.points && typeof user.points.lifetime === 'number') return user.points.lifetime;
    return calcUserXP(user);
  }

  function pointsSince(user, dateStr) {
    const log = (user && user.points && user.points.log) || [];
    return log.reduce((n, e) => (e.d && e.d >= dateStr ? n + (e.p || 0) : n), 0);
  }

  function pointsToday(user) { return pointsSince(user, localDateString()); }

  // Map of local date -> summed `n` for one log kind, for the day-scoped trophies.
  function countLogByDay(user, kind) {
    const log = (user && user.points && user.points.log) || [];
    const out = new Map();
    log.forEach(e => {
      if (e.k !== kind) return;
      out.set(e.d, (out.get(e.d) || 0) + (e.n || 1));
    });
    return out;
  }
  function maxPerDay(user, kind) {
    let max = 0;
    countLogByDay(user, kind).forEach(v => { if (v > max) max = v; });
    return max;
  }

  // ── Day streak ──
  const STREAK_MILESTONES = { 3: 15, 7: 40, 14: 80, 30: 200 };

  function ensureStreak(user) {
    if (!user.streak || typeof user.streak !== 'object') {
      user.streak = { current: 0, best: 0, lastDay: null, days: 0 };
    }
    return user.streak;
  }

  // Call once per day of real activity. Returns whether it moved and any milestone hit.
  function touchStreak(user, today) {
    today = today || localDateString();
    const st = ensureStreak(user);
    if (st.lastDay === today) return { changed: false, current: st.current, milestone: 0 };
    const gap = st.lastDay ? dayDiff(st.lastDay, today) : null;
    // A clock moved backwards shouldn't destroy a streak.
    if (gap !== null && gap < 0) return { changed: false, current: st.current, milestone: 0 };
    st.current = gap === 1 ? st.current + 1 : 1;
    st.lastDay = today;
    st.days += 1;
    if (st.current > st.best) st.best = st.current;
    const milestone = [30, 14, 7, 3].find(m => st.current === m) || 0;
    return { changed: true, current: st.current, milestone };
  }

  // ── Trophies ──
  // Every condition below is computable from data this app actually stores. Score
  // trends and time-on-task are deliberately absent: there is no score history
  // (testHistory is never written) and no per-question timing.
  function sessionCount(user) {
    const hs = (user && user.homeworkSessions) || {};
    return Object.keys(hs).reduce((n, k) => n + (hs[k] || 0), 0);
  }
  function subjectsWithMastery(user) {
    const ms = (user && user.masteredSkills) || {};
    return SUBJECT_ORDER.filter(s => getMasteredGrades(user, s).length > 0).length;
  }
  function subjectsWithSessions(user) {
    const hs = (user && user.homeworkSessions) || {};
    const set = new Set(Object.keys(hs).filter(k => (hs[k] || 0) > 0).map(k => k.split(':')[0]));
    return SUBJECT_ORDER.filter(s => set.has(s)).length;
  }
  function anyBucket(user, pred) {
    const ms = (user && user.masteredSkills) || {};
    return Object.keys(ms).some(subj => Object.keys(ms[subj] || {}).some(g => pred(subj, g, ms[subj][g] || [])));
  }

  const TROPHIES = [
    { id: 'first_whistle', name: 'First Whistle',   emoji: '🏁', pts: 25,
      how: 'Earn your first point', check: u => getLifetimePoints(u) >= 1 },
    { id: 'hat_trick',     name: 'Hat Trick',       emoji: '🎩', pts: 40,
      how: 'Master 3 skills in one day', check: u => maxPerDay(u, 'skill') >= 3 },
    { id: 'double_digits', name: 'Double Digits',   emoji: '🔟', pts: 50,
      how: 'Master 10 skills', check: u => getLifetimeMastered(u) >= 10 },
    { id: 'century',       name: 'Century Mark',    emoji: '💯', pts: 75,
      how: 'Master 100 skills', check: u => getLifetimeMastered(u) >= 100 },
    { id: 'clean_sweep',   name: 'Clean Sweep',     emoji: '🧹', pts: 100,
      how: 'Finish every skill in one section',
      check: u => anyBucket(u, (subj, g, keys) => {
        const set = new Set(keys);
        const secs = getSections(subj, g);
        if (!secs.length) return false;
        getGradeSkills(subj, g).forEach(s => {
          if (set.has(`${s.sectionIndex}:${s.skillIndex}`)) secs[s.sectionIndex].done = (secs[s.sectionIndex].done || 0) + 1;
        });
        return secs.some(sec => sec.total > 0 && (sec.done || 0) >= sec.total);
      }) },
    { id: 'title_run',     name: 'Title Run',       emoji: '🏆', pts: 150,
      how: 'Master a whole subject at one grade level',
      check: u => anyBucket(u, (subj, g, keys) => {
        const total = getGradeSkills(subj, g).length;
        return total > 0 && keys.length >= total;
      }) },
    { id: 'utility_player', name: 'Utility Player', emoji: '🧰', pts: 60,
      how: 'Master a skill in all five subjects', check: u => subjectsWithMastery(u) >= 5 },
    { id: 'all_rounder',   name: 'All-Rounder',     emoji: '🎽', pts: 70,
      how: 'Work on all five subjects', check: u => subjectsWithSessions(u) >= 5 },
    { id: 'gym_rat',       name: 'Gym Rat',         emoji: '🏋️', pts: 50,
      how: 'Finish 25 sessions', check: u => sessionCount(u) >= 25 },
    { id: 'study_hall',    name: 'Study Hall',      emoji: '📚', pts: 35,
      how: 'Finish 3 sessions in one day', check: u => maxPerDay(u, 'session') >= 3 },
    { id: 'iron_man',      name: 'Iron Man',        emoji: '🔁', pts: 40,
      how: 'Reach a 7-day streak', check: u => ((u && u.streak) || {}).best >= 7 },
    { id: 'preseason',     name: 'Preseason Grind', emoji: '🗓️', pts: 90,
      how: 'Reach a 30-day streak', check: u => ((u && u.streak) || {}).best >= 30 },
    { id: 'playing_up',    name: 'Playing Up',      emoji: '⬆️', pts: 50,
      how: 'Master a skill above your own grade',
      check: u => {
        if (!u || !u.grade) return false;
        const own = gradeIndex(u.grade);
        return anyBucket(u, (subj, g, keys) => keys.length > 0 && gradeIndex(g) > own);
      } },
    { id: 'hall_of_famer', name: 'Hall of Famer',   emoji: '🥇', pts: 120,
      how: 'Master 10 skills at Hall of Fame level',
      check: u => {
        const log = (u && u.points && u.points.log) || [];
        return log.reduce((n, e) => (e.k === 'skill' && e.tier === 'hof' ? n + (e.n || 1) : n), 0) >= 10;
      } },
    { id: 'perfect_game',  name: 'Perfect Game',    emoji: '🎯', pts: 80,
      how: 'Master every skill in one test',
      check: u => {
        const log = (u && u.points && u.points.log) || [];
        return log.some(e => e.k === 'test' && e.total >= 4 && e.n === e.total);
      } },
  ];

  function ensureTrophies(user) {
    if (!user.trophies || typeof user.trophies !== 'object') user.trophies = {};
    return user.trophies;
  }
  // Returns the trophies that just became true, without awarding points (the caller does that).
  function newlyEarnedTrophies(user) {
    const held = ensureTrophies(user);
    return TROPHIES.filter(t => {
      if (held[t.id]) return false;
      try { return !!t.check(user); } catch (e) { return false; }
    });
  }

  function subjectXPBreakdown(user) {
    const ms = (user && user.masteredSkills) || {};
    return SUBJECT_ORDER.map(s => {
      const byGrade = ms[s] || {};
      const n = Object.values(byGrade).reduce((a, keys) => a + (keys || []).length, 0);
      return { subject: s, mastered: n };
    }).filter(x => x.mastered > 0);
  }

  root.Curriculum = {
    GRADES, gradeKey, getGradeData, getGradeSkills, getSections, getUnits, getUnit, getBrief,
    migrateUser, getMasteredKeys, getUnmasteredSkills, addMastered, getSkillMasteryStats, getOverallMastery,
    calcUserXP, getUserLevel, getLevelFloor, LEVEL_THRESHOLDS, subjectXPBreakdown, CLASSICS_GENERIC_SKILLS,
    gradeIndex, tierGrade, tierAvailable, getTier, tierMultiplier,
    getMasteredGrades, getActiveGrades, getSubjectMasteryAcross, getLifetimeMastered,
    localDateString, dayDiff, appendPoints, getLifetimePoints, pointsSince, pointsToday,
    countLogByDay, maxPerDay, touchStreak, STREAK_MILESTONES, TROPHIES, newlyEarnedTrophies,
    sessionCount,
  };
})(typeof window !== 'undefined' ? window : module.exports);
