// ── Study Buddy: curriculum accessors, mastery and XP math ──
// DOM-free on purpose: loaded by index.html AND by node (tools/test_prompts.js).
// Expects window.CURRICULUM (from data/*.js) and window.SUBJECT_ORDER (from js/subjects.js).
(function (root) {
  'use strict';

  const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];
  const SUBJECT_ORDER = root.SUBJECT_ORDER || ['math', 'history', 'science', 'ela', 'classics'];

  function C() { return root.CURRICULUM || {}; }
  function gradeKey(grade) { return String(grade === 0 ? 'K' : grade); }

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

  function getUserLevel(xp) {
    if (xp >= 5000) return { label: 'Legend',      icon: '👑', color: '#dc2626', next: null };
    if (xp >= 2500) return { label: 'Champion',    icon: '🏆', color: '#f59e0b', next: 5000 };
    if (xp >= 1000) return { label: 'Whiz',        icon: '🔥', color: '#f97316', next: 2500 };
    if (xp >= 400)  return { label: 'Rising Star', icon: '⭐', color: '#7c3aed', next: 1000 };
    if (xp >= 100)  return { label: 'Scholar',     icon: '📚', color: '#2563eb', next: 400  };
    return               { label: 'Seedling',    icon: '🌱', color: '#16a34a', next: 100  };
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
    calcUserXP, getUserLevel, subjectXPBreakdown, CLASSICS_GENERIC_SKILLS,
  };
})(typeof window !== 'undefined' ? window : module.exports);
