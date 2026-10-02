#!/usr/bin/env node
// Builds sample prompts with the real curriculum data and asserts they contain what the tutor needs.
// Usage: node tools/test_prompts.js [--print]
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const window = { CURRICULUM: {} };
const ctx = vm.createContext({ window, module: { exports: window }, console });
for (const f of ['data/math.js', 'data/history.js', 'data/science.js', 'data/ela.js', 'data/units.js', 'data/briefs-6.js', 'js/subjects.js', 'js/curriculum.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const { Prompts, Curriculum, SUBJECTS } = window;
const print = process.argv.includes('--print');
let failures = 0;
function check(name, cond) { if (!cond) { failures++; console.log('  ✗', name); } else console.log('  ✓', name); }

const cases = [
  { subject: 'history', grade: '6', unitNumber: 2, mode: 'homework' },
  { subject: 'math', grade: '6', unitNumber: 3, lesson: 4, mode: 'lesson' },
  { subject: 'classics', grade: '6', unitNumber: 5, mode: 'homework' },
  { subject: 'ela', grade: 'K', topicHint: 'rhyming words', mode: 'homework' },
  { subject: 'science', grade: '6', unitNumber: 4, mode: 'lesson' },
];
for (const c of cases) {
  const units = Curriculum.getUnits(c.subject, c.grade);
  const unit = c.unitNumber ? units.find(u => u.number === c.unitNumber) : null;
  const brief = unit ? Curriculum.getBrief(unit.id) : null;
  const prompt = Prompts.buildSystemPrompt({ subject: c.subject, grade: c.grade, unit, lesson: c.lesson, brief, topicHint: c.topicHint, mode: c.mode, curriculum: window.CURRICULUM });
  console.log(`\n== ${c.subject} G${c.grade} ${unit ? 'Unit ' + unit.number + ': ' + unit.title : c.topicHint} (${c.mode}) — ${prompt.length} chars`);
  check('has subject style block', prompt.includes(SUBJECTS[c.subject].style.split('\n')[0]));
  if (unit) check('mentions unit title', prompt.includes(unit.title) || (brief && prompt.includes(brief.title)));
  if (c.topicHint) check('mentions topic hint', prompt.includes(c.topicHint));
  check('has behavior policy', prompt.includes('HANDLING BAD BEHAVIOR'));
  check(c.mode === 'lesson' ? 'lesson flow present' : 'opening rules present', prompt.includes(c.mode === 'lesson' ? 'HOW TO RUN THIS LESSON' : 'HOW TO START THE SESSION'));
  if (c.subject !== 'classics') check('has Sequence outline', prompt.includes('COVERS THIS YEAR'));
  if (brief) {
    check('has brief context', prompt.includes('teacher guide for this unit'));
    if (c.lesson && brief.lessons) { const l = brief.lessons.find(x => x.n === c.lesson); if (l) check('has lesson focus', prompt.includes(l.focus)); }
  } else if (unit && c.subject !== 'classics') {
    check('has matched Sequence topics', prompt.includes('Sequence topics that match'));
  }
  if (print) console.log(prompt);
}

// Skills test prompt + report prompt
const user = { masteredSkills: {}, grade: '6' };
for (const subject of ['math', 'history', 'science', 'ela', 'classics']) {
  const skills = Curriculum.getUnmasteredSkills(user, subject, '6', 6);
  const t = Prompts.buildTestSystemPrompt({ subject, grade: '6', skills });
  const r = Prompts.buildReportSystemPrompt({ subject, grade: '6', skills });
  console.log(`\n== skills test ${subject} G6: ${skills.length} skills, ${Curriculum.getGradeSkills(subject, '6').length} total`);
  check('6 skills selected', skills.length === 6);
  check('test prompt lists skills', t.includes('[' + skills[0].section + ']'));
  check('test prompt has JSON template', t.includes('===SKILLS_REPORT_START===') && t.includes(`"subject":"${subject}"`));
  check('report prompt has JSON template', r.includes('===SKILLS_REPORT_START==='));
}

// Mastery, migration and XP
const legacy = { masteredSkills: { '5': ['0:0', '0:1'], '4': ['1:0'] }, homeworkSessions: { '1': 2, 'homework': 1 }, retestSuggested: [1] };
Curriculum.migrateUser(legacy);
console.log('\n== migration');
check('grade keys moved under math', legacy.masteredSkills.math && legacy.masteredSkills.math['5'].length === 2 && !legacy.masteredSkills['5']);
check('sessions re-keyed', Object.keys(legacy.homeworkSessions).every(k => k.startsWith('math:')));
check('retest suggestion re-keyed', legacy.retestSuggested[0] === 'math');
const xp = Curriculum.calcUserXP(legacy);
check('XP counts mastered skills + sessions (3*10 + 3*5 = 45)', xp === 45);
const hk = Curriculum.getGradeSkills('history', '6').slice(0, 3).map(s => `${s.sectionIndex}:${s.skillIndex}`);
const ms = Curriculum.addMastered({}, 'history', '6', hk);
const stats = Curriculum.getSkillMasteryStats({ masteredSkills: ms }, 'history', '6');
check('mastery stats count 3 mastered', stats.totalMastered === 3 && stats.pct > 0);
check('overall mastery sums subjects', Curriculum.getOverallMastery({ masteredSkills: ms }, '6').totalMastered === 3);

// ── Challenge tiers ──
console.log('\n== challenge tiers');
check('tierGrade G6 rookie/pro/allstar/hof = 5/6/7/8',
  ['rookie','pro','allstar','hof'].map(t => Curriculum.tierGrade('6', t)).join(',') === '5,6,7,8');
check('tierGrade clamps at G8', Curriculum.tierGrade('8', 'hof') === '8' && Curriculum.tierGrade('8', 'allstar') === '8');
check('tierGrade clamps at K', Curriculum.tierGrade('K', 'rookie') === 'K');
check('tierAvailable false where it would clamp', Curriculum.tierAvailable('8', 'hof') === false && Curriculum.tierAvailable('K', 'rookie') === false);
check('tierAvailable true for G6 at every tier', ['rookie','pro','allstar','hof'].every(t => Curriculum.tierAvailable('6', t)));
check('multipliers are 1 / 1 / 1.3 / 1.6',
  ['rookie','pro','allstar','hof'].map(t => Curriculum.tierMultiplier(t)).join(',') === '1,1,1.3,1.6');
check('getTier defaults to pro', Curriculum.getTier({}, 'math') === 'pro' && Curriculum.getTier({ challengeTiers: { math: 'hof' } }, 'math') === 'hof');
check('migrateUser adds challengeTiers', !!Curriculum.migrateUser({}).challengeTiers);

// A Pro prompt must be byte-identical to one built without tier info at all,
// which is what keeps every pre-tier expectation in this file honest.
for (const mode of ['homework', 'lesson']) {
  const bare = Prompts.buildSystemPrompt({ subject: 'math', grade: '6', mode, curriculum: window.CURRICULUM });
  const pro = Prompts.buildSystemPrompt({ subject: 'math', grade: '6', baseGrade: '6', tier: 'pro', mode, curriculum: window.CURRICULUM });
  check(`${mode}: pro prompt identical to untiered`, bare === pro);
}
{
  const bare = Prompts.buildTestSystemPrompt({ subject: 'math', grade: '6', skills: [] });
  const pro = Prompts.buildTestSystemPrompt({ subject: 'math', grade: '6', baseGrade: '6', tier: 'pro', skills: [] });
  check('test: pro prompt identical to untiered', bare === pro);
}

for (const [tier, g] of [['rookie','5'], ['pro','6'], ['allstar','7'], ['hof','8']]) {
  const p = Prompts.buildSystemPrompt({
    subject: 'math', grade: Curriculum.tierGrade('6', tier), baseGrade: '6', tier,
    mode: 'lesson', curriculum: window.CURRICULUM,
  });
  const stretch = tier === 'allstar' || tier === 'hof';
  // Tone must stay anchored to the student's real grade at every tier.
  check(`${tier}: tone stays 6th grade`,
    p.includes('tutor for a 6th grade student (approximately 11-12 years old)'));
  check(`${tier}: content grade is ${g}`, p.includes(`Grade ${g} Math`) || p.includes(`GRADE ${g} MATH`));
  check(`${tier}: challenge block ${tier === 'pro' ? 'absent' : 'present'}`,
    p.includes('CHALLENGE LEVEL') === (tier !== 'pro'));
  check(`${tier}: later-grades ceiling ${stretch ? 'lifted' : 'kept'}`,
    p.includes('do not introduce ideas from later grades') === !stretch);
  if (stretch) check(`${tier}: content ceiling names Grade ${g}`, p.includes(`The CONTENT ceiling is Grade ${g}`));

  const t = Prompts.buildTestSystemPrompt({
    subject: 'math', grade: Curriculum.tierGrade('6', tier), baseGrade: '6', tier,
    skills: Curriculum.getGradeSkills('math', g).slice(0, 2),
  });
  check(`${tier}: test prompt reading level is 6th grade`, t.includes('6th grade'));
  if (stretch) check(`${tier}: test prompt refuses to soften`, t.includes('Do NOT soften the questions'));
}
check('every subject has stretch test guidance',
  ['math','history','science','ela','classics'].every(s => !!SUBJECTS[s].testGuidanceStretch));

// ── Mastery across grades ──
console.log('\n== mastery across grades');
{
  const u = { masteredSkills: { math: { '6': ['0:0','0:1'], '7': ['0:0'] } } };
  check('getMasteredGrades lists both buckets', Curriculum.getMasteredGrades(u, 'math').join(',') === '6,7');
  check('getActiveGrades adds the current grade', Curriculum.getActiveGrades(u, 'math', '8').join(',') === '6,7,8');
  check('getLifetimeMastered counts every bucket', Curriculum.getLifetimeMastered(u) === 3);
  const across = Curriculum.getSubjectMasteryAcross(u, 'math', ['6','7']);
  check('getSubjectMasteryAcross sums grades', across.totalMastered === 3 &&
    across.totalSkills === Curriculum.getGradeSkills('math','6').length + Curriculum.getGradeSkills('math','7').length);
}

// ── Level ladder ──
console.log('\n== levels');
check('level labels at each threshold',
  [0,100,400,1000,2500,5000].map(x => Curriculum.getUserLevel(x).label).join(',')
  === 'Seedling,Scholar,Rising Star,Whiz,Champion,Legend');
check('level floor sits at the band start', Curriculum.getLevelFloor(650) === 400 && Curriculum.getLevelFloor(50) === 0);
check('top level has no next', Curriculum.getUserLevel(9999).next === null);

// Units sanity
console.log('\n== units');
const g6 = Object.fromEntries(['math','history','science','ela','classics'].map(s => [s, Curriculum.getUnits(s, '6').filter(u => u.kind === 'unit').length]));
console.log('  Grade 6 units:', JSON.stringify(g6));
check('G6 counts (8 math, 8 history, 6 science, 7 ela, 2 classics)', g6.math === 8 && g6.history === 8 && g6.science === 6 && g6.ela === 7 && g6.classics === 2);
check('every G6 unit has a teacher guide path', ['math','history','science','ela','classics'].every(s => Curriculum.getUnits(s, '6').filter(u => u.kind === 'unit').every(u => u.tg)));
for (const s of ['math','history','science','ela']) for (const g of Curriculum.GRADES) check(`${s} G${g} has skills`, Curriculum.getGradeSkills(s, g).length > 0);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
