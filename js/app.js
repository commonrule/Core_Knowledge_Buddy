// ── Study Buddy — app logic ──
// Curriculum data:   data/*.js  (generated)  → window.CURRICULUM
// Subjects/prompts:  js/subjects.js           → window.SUBJECTS, window.Prompts
// Skills/XP helpers: js/curriculum.js         → window.Curriculum

// ── API Key management ──
const KEY_STORAGE = 'studybuddy_apikey';
const USERS_STORAGE = 'studybuddy_users';
const SESSION_STORAGE = 'studybuddy_session';

function getApiKey() {
  // Prefer key baked in at deploy time (via GitHub Actions secret)
  if (window.MATHBUDDY_KEY && window.MATHBUDDY_KEY.startsWith('sk-')) {
    return window.MATHBUDDY_KEY;
  }
  return localStorage.getItem(KEY_STORAGE) || '';
}

function saveApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

function clearApiKey() {
  localStorage.removeItem(KEY_STORAGE);
}

// ── User management ──
function getUsers() {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_STORAGE) || '{}');
    Object.values(users).forEach(u => Curriculum.migrateUser(u));
    return users;
  } catch { return {}; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_STORAGE, JSON.stringify(users));
}

function getCurrentUser() {
  try {
    return Curriculum.migrateUser(JSON.parse(sessionStorage.getItem(SESSION_STORAGE) || 'null'));
  } catch { return null; }
}

function setCurrentUser(user) {
  if (user) {
    sessionStorage.setItem(SESSION_STORAGE, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(SESSION_STORAGE);
  }
}

// ── Child management helpers ──
function getChildIds(parentUsername) {
  const prefix = parentUsername + ':';
  return Object.keys(getUsers()).filter(k => k.startsWith(prefix));
}

function getChild(parentUsername, childKey) {
  return getUsers()[childKey] || null;
}

function saveChild(parentUsername, childKey, data) {
  const users = getUsers();
  users[childKey] = data;
  saveUsers(users);
}

function deleteChild(childKey) {
  const users = getUsers();
  delete users[childKey];
  saveUsers(users);
}

function makeChildKey(parentUsername, name) {
  return parentUsername + ':' + name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);
}

// ── Password hashing ──
async function hashPassword(password) {
  const saltedPassword = 'mathbuddy:' + password;
  const msgBuffer = new TextEncoder().encode(saltedPassword);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(parentKey, pin) {
  const salted = 'mathbuddy_pin:' + parentKey + ':' + pin;
  const buf = new TextEncoder().encode(salted);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Supabase auth helper ──
function getSupabaseAuth() {
  return window._supabaseClient ? window._supabaseClient.auth : null;
}

// Returns all child records from localStorage, regardless of parent
function getAllChildren() {
  const users = getUsers();
  return Object.entries(users)
    .filter(([k, v]) => k.includes(':') && v && v.displayName)
    .map(([k, v]) => ({ key: k, parentKey: k.substring(0, k.indexOf(':')), ...v }));
}

// ── PIN pad state ──
let _pinDigits = [];
let _pendingChild = null; // { parentKey, childKey }

// ── Parent auth state (set after parent logs in this page session) ──
let _parentAuthed = false;

// ── State ──
let selectedSubject = null;   // 'math' | 'history' | 'science' | 'ela' | 'classics'
let selectedUnitId = null;    // id from data/units.js, or null for "something else"
let selectedLesson = null;
let currentSessionKey = null; // `${subject}:${unitId}` for XP/session tracking
let currentSystemPrompt = '';
let selectedGrade = 4;
let inputMethod = 'type';
let photoBase64 = null;
let photoMediaType = null;
let conversationHistory = [];
let testConversationHistory = [];
let isStreaming = false;
let isTestStreaming = false;
let testTimerInterval = null;
let testSecondsLeft = 0;
let currentMode = 'homework'; // 'homework' or 'test'

// ── DOM refs ──
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const chatScreen = document.getElementById('chat-screen');
const testScreen = document.getElementById('test-screen');
const reportScreen = document.getElementById('report-screen');
const profileScreen = document.getElementById('profile-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen');
const studentPickerScreen = document.getElementById('student-picker-screen');
const addStudentScreen = document.getElementById('add-student-screen');

const subjectPicker = document.getElementById('subject-picker');
const workForm = document.getElementById('work-form');
const unitSelect = document.getElementById('unit-select');
const lessonSection = document.getElementById('lesson-section');
const lessonInput = document.getElementById('lesson-input');
const topicHintInput = document.getElementById('topic-hint-input');
const lessonBtn = document.getElementById('lesson-btn');
const startBtn = document.getElementById('start-btn');
const backBtn = document.getElementById('back-btn');
const newProblemBtn = document.getElementById('new-problem-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const chatSubtitle = document.getElementById('chat-subtitle');
const photoCameraInput = document.getElementById('photo-camera-input');
const photoUploadInput = document.getElementById('photo-upload-input');
const photoPreview = document.getElementById('photo-preview');
const photoPlaceholder = document.getElementById('photo-placeholder');
const clearPhotoBtn = document.getElementById('clear-photo-btn');

// Test screen refs
const testBackBtn = document.getElementById('test-back-btn');
const finishTestBtn = document.getElementById('finish-test-btn');
const testMessages = document.getElementById('test-messages');
const testInput = document.getElementById('test-input');
const testSendBtn = document.getElementById('test-send-btn');
const testSubtitle = document.getElementById('test-subtitle');

// Student header refs
const studentHeader = document.getElementById('student-header');
const genericHeader = document.getElementById('generic-header');
const studentAvatar = document.getElementById('student-avatar');
const studentGreeting = document.getElementById('student-greeting');
const studentGradeBadge = document.getElementById('student-grade-badge');
const reportCardBtn = document.getElementById('report-card-btn');
const takeTestBtn = document.getElementById('take-test-btn');
const logoutBtn = document.getElementById('logout-btn');
const retestBanner = document.getElementById('retest-banner');
const retestBannerText = document.getElementById('retest-banner-text');
const retestNowBtn = document.getElementById('retest-now-btn');

// Setup grade buttons (K through 8)
const ALL_GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];

// ── All screens list ──
const forgotPasswordScreen = document.getElementById('forgot-password-screen');
const pinPadScreen = document.getElementById('pin-pad-screen');
const studentLoginScreen = document.getElementById('student-login-screen');

const ALL_SCREENS = [loginScreen, forgotPasswordScreen, pinPadScreen, studentLoginScreen, studentPickerScreen, addStudentScreen, setupScreen, chatScreen, testScreen, reportScreen, profileScreen, leaderboardScreen].filter(Boolean);

// ── Screen helper ──
function showScreen(screen) {
  if (!screen) return;
  ALL_SCREENS.forEach(s => {
    s.classList.remove('active');
    s.style.display = '';
  });
  screen.classList.add('active');
  if (screen === chatScreen || screen === testScreen) {
    screen.style.display = 'flex';
  }
}

// (startup runs at the very end of this file so every const above is initialized)


function handleSupabaseSession(session) {
  const sbUser = session.user;
  const parentKey = 'uid_' + sbUser.id;
  const users = getUsers();
  if (!users[parentKey]) {
    users[parentKey] = {
      displayName: sbUser.user_metadata?.full_name || sbUser.email.split('@')[0],
      isParent: true,
      email: sbUser.email,
      authMethod: 'supabase',
    };
    saveUsers(users);
  }
  const record = users[parentKey];
  const sessionUser = { username: parentKey, parentUsername: parentKey, displayName: record.displayName, isParent: true, email: sbUser.email, authMethod: 'supabase' };
  setCurrentUser(sessionUser);
  _parentAuthed = true;
  const children = getAllChildren();
  renderStudentPickerNetflix(children);
  showScreen(studentPickerScreen);
}

// Netflix-style picker — shows all children; parent management via 🔒 button
function renderStudentPickerNetflix(children) {
  document.getElementById('picker-greeting').textContent = 'Who\'s learning today? 👋';
  const addBtn = document.getElementById('add-student-btn');
  if (addBtn) addBtn.style.display = _parentAuthed ? '' : 'none';

  const container = document.getElementById('student-cards');
  if (children.length === 0) {
    container.innerHTML = _parentAuthed
      ? '<div class="student-card-empty"><div style="font-size:3em">👧</div><p>No students yet. Add your first child to get started!</p></div>'
      : '<div class="student-card-empty"><div style="font-size:3em">👨‍👩‍👧‍👦</div><p>Press <strong>🔒 Parent</strong> to set up your family!</p></div>';
    return;
  }

  container.innerHTML = children.map(child => {
    const stats = Curriculum.getOverallMastery(child, child.grade);
    const gradeLabel = String(child.grade) === 'K' ? 'Kindergarten' : 'Grade ' + child.grade;
    const avatarHtml = child.avatarAnimal
      ? '<img src="' + twemojiUrl(child.avatarAnimal) + '" width="48" height="48" alt="avatar" />'
      : '<span style="font-size:2.5em">👤</span>';
    const pinIcon = child.pinHash ? ' 🔐' : '';
    const editBtn = _parentAuthed
      ? '<button class="student-card-edit" onclick="event.stopPropagation();openEditStudent(\'' + child.parentKey + '\',\'' + child.key + '\')" title="Edit">✏️</button>'
      : '';
    return '<div class="student-card" onclick="selectChild(\'' + child.parentKey + '\',\'' + child.key + '\')">' +
      '<div class="student-card-avatar">' + avatarHtml + '</div>' +
      '<div class="student-card-info">' +
        '<div class="student-card-name">' + escapeHtml(child.displayName) + pinIcon + '</div>' +
        '<div class="student-card-grade">' + gradeLabel + '</div>' +
        '<div class="student-card-progress">' +
          '<div class="progress-bar-track" style="height:6px"><div class="progress-bar-fill" style="width:' + stats.pct + '%;background:var(--accent);height:6px;border-radius:3px"></div></div>' +
          '<span style="font-size:0.75em;color:#6b7280">' + stats.totalMastered + '/' + stats.totalSkills + ' skills</span>' +
        '</div>' +
      '</div>' +
      editBtn +
      '</div>';
  }).join('');
}

// ── Runtime configuration ──
// The API key is injected at deploy time (config.js). Students are never asked for one.
function notifyNotConfigured() {
  alert("Study Buddy isn't set up on this site yet. Please ask a parent to finish the setup. 🦉");
}

// ── Login screen ──
// Twemoji SVG animal faces — forward-facing cartoon animals
const ANIMAL_AVATARS = [
  { name: 'Goat',      cp: '1f410' },
  { name: 'Dragon',    cp: '1f432' },  // dragon face — forward-facing
  { name: 'Cat',       cp: '1f431' },
  { name: 'Dog',       cp: '1f436' },
  { name: 'Rabbit',    cp: '1f430' },
  { name: 'Fox',       cp: '1f98a' },
  { name: 'Bear',      cp: '1f43b' },
  { name: 'Panda',     cp: '1f43c' },
  { name: 'Koala',     cp: '1f428' },
  { name: 'Tiger',     cp: '1f42f' },
  { name: 'Lion',      cp: '1f981' },
  { name: 'Cow',       cp: '1f42e' },
  { name: 'Pig',       cp: '1f437' },
  { name: 'Frog',      cp: '1f438' },
  { name: 'Monkey',    cp: '1f435' },
  { name: 'Wolf',      cp: '1f43a' },
  { name: 'Hamster',   cp: '1f439' },
  { name: 'Mouse',     cp: '1f42d' },
  { name: 'Horse',     cp: '1f434' },
  { name: 'Unicorn',   cp: '1f984' },
  { name: 'Owl',       cp: '1f989' },
  { name: 'Penguin',   cp: '1f427' },
  { name: 'Chick',     cp: '1f425' },  // front-facing baby chick
  { name: 'Raccoon',   cp: '1f99d' },  // forward-facing face in Twemoji
  { name: 'Blowfish',  cp: '1f421' },  // round, faces camera
  { name: 'Beaver',    cp: '1f9ab' },  // forward-facing face
  { name: 'Hedgehog',  cp: '1f994' },  // forward-facing face
  { name: 'Otter',     cp: '1f9a6' },  // forward-facing cute face
  { name: 'Octopus',   cp: '1f419' },  // round, faces camera
  { name: 'Butterfly', cp: '1f98b' },
  { name: 'Seal',      cp: '1f9ad' },
];

const AVATAR_ACCESSORIES = [
  { id: '',          emoji: '',   label: 'None',       pos: null },
  { id: 'crown',     emoji: '👑', label: '👑 Crown',    pos: 'top' },
  { id: 'tophat',    emoji: '🎩', label: '🎩 Top Hat',  pos: 'top' },
  { id: 'gradcap',   emoji: '🎓', label: '🎓 Grad Cap', pos: 'top' },
  { id: 'cowboy',    emoji: '🤠', label: '🤠 Cowboy',   pos: 'top' },
  { id: 'sunglasses',emoji: '🕶️', label: '🕶️ Shades',  pos: 'mid' },
  { id: 'nerd',      emoji: '🤓', label: '🤓 Nerd',     pos: 'mid' },
  { id: 'star',      emoji: '⭐', label: '⭐ Star',      pos: 'corner' },
  { id: 'fire',      emoji: '🔥', label: '🔥 Fire',     pos: 'top' },
  { id: 'rainbow',   emoji: '🌈', label: '🌈 Rainbow',  pos: 'top' },
  { id: 'bow',       emoji: '🎀', label: '🎀 Bow',      pos: 'top' },
  { id: 'gem',       emoji: '💎', label: '💎 Gem',      pos: 'corner' },
];

function twemojiUrl(cp) {
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cp}.svg`;
}

function animalAvatarHtml(cp, accessoryId, size) {
  const acc = AVATAR_ACCESSORIES.find(a => a.id === accessoryId) || AVATAR_ACCESSORIES[0];
  const accSize = Math.round(size * 0.44);
  let accHtml = '';
  if (acc.emoji) {
    const styles = {
      top:    `position:absolute;top:-${Math.round(accSize*0.25)}px;left:50%;transform:translateX(-50%);font-size:${accSize}px;line-height:1;pointer-events:none;`,
      mid:    `position:absolute;top:52%;left:50%;transform:translate(-50%,-50%);font-size:${Math.round(accSize*0.85)}px;line-height:1;pointer-events:none;`,
      corner: `position:absolute;bottom:-${Math.round(accSize*0.15)}px;right:-${Math.round(accSize*0.15)}px;font-size:${Math.round(accSize*0.7)}px;line-height:1;pointer-events:none;`,
    };
    accHtml = `<span style="${styles[acc.pos]}">${acc.emoji}</span>`;
  }
  return `<div style="position:relative;width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;"><img src="${twemojiUrl(cp)}" width="${size}" height="${size}" style="border-radius:50%;display:block;" alt="avatar" loading="lazy">${accHtml}</div>`;
}

function avatarImgHtml(user, size) {
  if (!user) return animalAvatarHtml(ANIMAL_AVATARS[0].cp, '', size);
  // New animal avatar
  if (user.avatarAnimal) return animalAvatarHtml(user.avatarAnimal, user.avatarAccessory || '', size);
  // Legacy DiceBear seed
  if (user.avatarSeed) {
    const base = `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(user.avatarSeed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
    const url = user.avatarAccessory ? `${base}&glasses=${user.avatarAccessory}` : base;
    return `<img src="${url}" width="${size}" height="${size}" style="border-radius:50%;display:block" alt="avatar" loading="lazy">`;
  }
  // Legacy emoji
  if (user.avatar) return `<span style="font-size:${size}px;line-height:1">${user.avatar}</span>`;
  // Deterministic fallback from username
  const username = user.username || '';
  let sum = 0;
  for (let i = 0; i < username.length; i++) sum += username.charCodeAt(i);
  const animal = ANIMAL_AVATARS[sum % ANIMAL_AVATARS.length];
  return animalAvatarHtml(animal.cp, '', size);
}

let loginMode = 'login'; // 'login' or 'register'

function setLoginMode(mode) {
  loginMode = mode;
  const registerNameSection = document.getElementById('register-name-section');
  const registerConfirmSection = document.getElementById('register-confirm-section');
  const loginTitle = document.getElementById('login-title');
  const loginSubtitle = document.getElementById('login-subtitle');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const loginError = document.getElementById('login-error');
  const authSwitchText = document.getElementById('auth-switch-text');
  const authSwitchBtn = document.getElementById('auth-switch-btn');
  const emailLabel = document.getElementById('login-email-label');

  loginError.style.display = 'none';

  if (mode === 'login') {
    registerNameSection.style.display = 'none';
    registerConfirmSection.style.display = 'none';
    loginTitle.textContent = 'Welcome Back!';
    loginSubtitle.textContent = 'Log in to continue your learning journey! 🌟';
    loginSubmitBtn.textContent = 'Log In 🚀';
    if (emailLabel) emailLabel.textContent = 'Email';
    if (authSwitchText) authSwitchText.textContent = 'New here?';
    if (authSwitchBtn) authSwitchBtn.textContent = 'Create an account';
    document.getElementById('login-password').autocomplete = 'current-password';
  } else {
    registerNameSection.style.display = 'block';
    registerConfirmSection.style.display = 'block';
    loginTitle.textContent = 'New Account';
    loginSubtitle.textContent = 'Create your parent account to get started! 🌟';
    loginSubmitBtn.textContent = 'Create Account 🚀';
    if (emailLabel) emailLabel.textContent = 'Email';
    if (authSwitchText) authSwitchText.textContent = 'Already have an account?';
    if (authSwitchBtn) authSwitchBtn.textContent = 'Log in';
    document.getElementById('login-password').autocomplete = 'new-password';
  }
}

// Build avatar picker (lazy — called on first switch to register mode)
let avatarPickerBuilt = false;
function ensureAvatarPicker() {
  if (avatarPickerBuilt) return;
  avatarPickerBuilt = true;
  const picker = document.getElementById('avatar-picker');
  if (!picker) return;

  // ── Animal grid ──
  const gridLabel = document.createElement('p');
  gridLabel.className = 'avatar-section-label';
  gridLabel.textContent = 'Choose your animal';
  picker.appendChild(gridLabel);

  const grid = document.createElement('div');
  grid.className = 'avatar-grid';
  picker.appendChild(grid);

  ANIMAL_AVATARS.forEach(({ name, cp }, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = name;
    btn.className = 'avatar-option' + (idx === 0 ? ' selected' : '');
    const img = document.createElement('img');
    img.src = twemojiUrl(cp);
    img.width = 48;
    img.height = 48;
    img.alt = name;
    img.loading = 'lazy';
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      registerAvatarAnimal = cp;
      updatePreview();
    });
    grid.appendChild(btn);
  });

  // ── Accessory row ──
  const accLabel = document.createElement('p');
  accLabel.className = 'avatar-section-label';
  accLabel.textContent = 'Add an accessory';
  picker.appendChild(accLabel);

  const accRow = document.createElement('div');
  accRow.className = 'avatar-accessory-row';
  picker.appendChild(accRow);

  AVATAR_ACCESSORIES.forEach((acc, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acc-option' + (idx === 0 ? ' selected' : '');
    btn.textContent = acc.label;
    btn.addEventListener('click', () => {
      accRow.querySelectorAll('.acc-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      registerAvatarAccessory = acc.id;
      updatePreview();
    });
    accRow.appendChild(btn);
  });

  // ── Live preview ──
  const previewWrap = document.createElement('div');
  previewWrap.className = 'avatar-preview-wrap';
  picker.appendChild(previewWrap);

  const previewLabel = document.createElement('p');
  previewLabel.className = 'avatar-section-label';
  previewLabel.textContent = 'Your avatar';
  previewWrap.appendChild(previewLabel);

  const previewDiv = document.createElement('div');
  previewDiv.className = 'avatar-preview-circle';
  previewWrap.appendChild(previewDiv);

  function updatePreview() {
    previewDiv.innerHTML = animalAvatarHtml(registerAvatarAnimal, registerAvatarAccessory, 80);
  }
  updatePreview();
}

// ── Login screen bindings ──
const authSwitchBtn = document.getElementById('auth-switch-btn');
if (authSwitchBtn) authSwitchBtn.addEventListener('click', () => setLoginMode(loginMode === 'login' ? 'register' : 'login'));

const loginSubmitBtn = document.getElementById('login-submit-btn');
if (loginSubmitBtn) loginSubmitBtn.addEventListener('click', handleLoginSubmit);
document.getElementById('login-password') && document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLoginSubmit(); });
document.getElementById('login-confirm') && document.getElementById('login-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') handleLoginSubmit(); });

// Google / Apple SSO
const googleSigninBtn = document.getElementById('google-signin-btn');
if (googleSigninBtn) googleSigninBtn.addEventListener('click', () => handleOAuthSignIn('google'));
const appleSigninBtn = document.getElementById('apple-signin-btn');
if (appleSigninBtn) appleSigninBtn.addEventListener('click', () => handleOAuthSignIn('apple'));

// Forgot password
const forgotPwLink = document.getElementById('forgot-pw-link');
if (forgotPwLink) forgotPwLink.addEventListener('click', () => {
  document.getElementById('forgot-error').style.display = 'none';
  document.getElementById('forgot-success').style.display = 'none';
  document.getElementById('forgot-email').value = '';
  const forgotSubmitBtn = document.getElementById('forgot-submit-btn');
  if (forgotSubmitBtn) forgotSubmitBtn.disabled = false;
  showScreen(forgotPasswordScreen);
});
const forgotBackBtn = document.getElementById('forgot-back-btn');
if (forgotBackBtn) forgotBackBtn.addEventListener('click', () => showScreen(loginScreen));
const forgotSubmitBtn = document.getElementById('forgot-submit-btn');
if (forgotSubmitBtn) forgotSubmitBtn.addEventListener('click', handleForgotPassword);

// Student direct login (Netflix PIN flow)
const studentLoginBtn = document.getElementById('student-login-btn');
if (studentLoginBtn) studentLoginBtn.addEventListener('click', () => {
  renderStudentDirectLogin();
  showScreen(studentLoginScreen);
});
const studentLoginBackBtn = document.getElementById('student-login-back-btn');
if (studentLoginBackBtn) studentLoginBackBtn.addEventListener('click', () => showScreen(loginScreen));

// Parent management button on picker screen
const parentMgmtBtn = document.getElementById('parent-mgmt-btn');
if (parentMgmtBtn) parentMgmtBtn.addEventListener('click', () => {
  if (_parentAuthed) {
    // Already authed — just ensure management controls are visible
    const children = getAllChildren();
    renderStudentPickerNetflix(children);
  } else {
    showScreen(loginScreen);
  }
});

async function handleOAuthSignIn(provider) {
  const auth = getSupabaseAuth();
  if (!auth) { showLoginError('SSO is not configured yet. Use email/password instead.'); return; }
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) showLoginError(provider + ' sign-in failed: ' + error.message);
  // On success the browser redirects away; onAuthStateChange handles the return
}

async function handleForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const errorEl = document.getElementById('forgot-error');
  const successEl = document.getElementById('forgot-success');
  errorEl.style.display = 'none';
  if (!email) { errorEl.textContent = 'Please enter your email address.'; errorEl.style.display = 'block'; return; }

  const auth = getSupabaseAuth();
  if (!auth) { errorEl.textContent = 'Password reset requires email sign-in (SSO not configured).'; errorEl.style.display = 'block'; return; }

  const { error } = await auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  if (error) { errorEl.textContent = error.message; errorEl.style.display = 'block'; return; }
  successEl.style.display = 'block';
  document.getElementById('forgot-submit-btn').disabled = true;
}

async function handleLoginSubmit() {
  const loginError = document.getElementById('login-error');
  const emailRaw = (document.getElementById('login-email') || {}).value || '';
  const email = emailRaw.trim();
  const password = document.getElementById('login-password').value;

  loginError.style.display = 'none';

  if (!email || !password) { showLoginError('Please fill in all fields.'); return; }

  const auth = getSupabaseAuth();
  const isEmail = email.includes('@');

  if (loginMode === 'register') {
    const displayName = document.getElementById('register-displayname').value.trim();
    const confirm = document.getElementById('login-confirm').value;
    if (!displayName) { showLoginError('Please enter your name.'); return; }
    const minLen = (isEmail && auth) ? 6 : 4;
    if (password.length < minLen) { showLoginError(`Password must be at least ${minLen} characters.`); return; }
    if (password !== confirm) { showLoginError('Passwords do not match.'); return; }

    if (isEmail && auth) {
      // Supabase email registration
      const { error } = await auth.signUp({ email, password, options: { data: { full_name: displayName } } });
      if (error) { showLoginError(error.message); return; }
      // onAuthStateChange handles the rest after Supabase processes the signup
      showLoginError(''); 
      document.getElementById('login-error').textContent = '';
      // Show a friendly message
      const errEl = document.getElementById('login-error');
      errEl.style.color = '#16a34a';
      errEl.textContent = 'Account created! Check your email to confirm, then log in.';
      errEl.style.display = 'block';
    } else {
      // Legacy username registration
      const username = email.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const users = getUsers();
      if (users[username]) { showLoginError('That username is already taken.'); return; }
      const passwordHash = await hashPassword(password);
      users[username] = { displayName, passwordHash, isParent: true, authMethod: 'legacy' };
      saveUsers(users);
      const sessionUser = { username, displayName, isParent: true, parentUsername: username, authMethod: 'legacy' };
      setCurrentUser(sessionUser);
      _parentAuthed = true;
      const children = getAllChildren();
      renderStudentPickerNetflix(children);
      showScreen(studentPickerScreen);
    }
  } else {
    // Login
    if (isEmail && auth) {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) { showLoginError(error.message); return; }
      // onAuthStateChange handles the rest
    } else {
      // Legacy username login — try raw first (for pre-existing accounts), then sanitized (for accounts registered with email-like input when Supabase was unavailable)
      const users = getUsers();
      const raw = email.toLowerCase();
      const sanitized = raw.replace(/[^a-z0-9_]/g, '_');
      const username = users[raw] ? raw : sanitized;
      const user = users[username];
      if (!user) { showLoginError('Username not found. Did you mean to register?'); return; }
      const passwordHash = await hashPassword(password);
      if (passwordHash !== user.passwordHash) { showLoginError('Incorrect password. Try again!'); return; }
      const sessionUser = { username, displayName: user.displayName, isParent: true, parentUsername: username, authMethod: 'legacy' };
      setCurrentUser(sessionUser);
      _parentAuthed = true;
      // Re-render picker with management controls
      const children = getAllChildren();
      renderStudentPickerNetflix(children);
      showScreen(studentPickerScreen);
    }
  }
}

function showLoginError(msg) {
  const loginError = document.getElementById('login-error');
  loginError.style.color = '';
  loginError.textContent = msg;
  loginError.style.display = msg ? 'block' : 'none';
}

function renderStudentDirectLogin() {
  const children = getAllChildren().filter(c => c.pinHash);
  const container = document.getElementById('student-login-cards');
  if (!container) return;
  if (children.length === 0) {
    container.innerHTML = '<div class="student-login-empty">No students have PINs set yet.<br>Ask a parent to add you a PIN in the student editor.</div>';
    return;
  }
  container.innerHTML = children.map(child => {
    const avatarHtml = child.avatarAnimal
      ? '<img src="' + twemojiUrl(child.avatarAnimal) + '" width="44" height="44" alt="avatar" />'
      : '<span style="font-size:2em">👤</span>';
    const gradeLabel = String(child.grade) === 'K' ? 'Kindergarten' : 'Grade ' + child.grade;
    return '<div class="student-login-card" onclick="startPinFlow(\'' + child.parentKey + '\',\'' + child.key + '\')">' +
      '<div class="student-card-avatar">' + avatarHtml + '</div>' +
      '<div class="student-card-info"><div class="student-card-name">' + escapeHtml(child.displayName) + '</div>' +
      '<div class="student-card-grade">' + gradeLabel + '</div></div>' +
      '<span style="font-size:1.2em">🔐</span></div>';
  }).join('');
}

// ── Student Picker ──
function renderStudentPicker(parentUsername) {
  const users = getUsers();
  const parent = users[parentUsername];
  document.getElementById('picker-greeting').textContent = `Hi, ${parent ? parent.displayName : 'there'}! 👋`;

  const container = document.getElementById('student-cards');
  const childKeys = getChildIds(parentUsername);

  if (childKeys.length === 0) {
    container.innerHTML = `
      <div class="student-card-empty">
        <div style="font-size:3em">👧</div>
        <p>No students yet. Add your first child to get started!</p>
      </div>`;
    return;
  }

  container.innerHTML = childKeys.map(key => {
    const child = users[key];
    if (!child) return '';
    const stats = Curriculum.getOverallMastery(child, child.grade);
    const gradeLabel = String(child.grade) === 'K' ? 'Kindergarten' : `Grade ${child.grade}`;
    const avatarHtml = child.avatarAnimal
      ? `<img src="${twemojiUrl(child.avatarAnimal)}" width="48" height="48" alt="avatar" />`
      : `<span style="font-size:2.5em">👤</span>`;
    return `
      <div class="student-card" onclick="selectChild('${parentUsername}', '${key}')">
        <div class="student-card-avatar">${avatarHtml}</div>
        <div class="student-card-info">
          <div class="student-card-name">${escapeHtml(child.displayName)}</div>
          <div class="student-card-grade">${gradeLabel}</div>
          <div class="student-card-progress">
            <div class="progress-bar-track" style="height:6px">
              <div class="progress-bar-fill" style="width:${stats.pct}%;background:var(--accent);height:6px;border-radius:3px"></div>
            </div>
            <span style="font-size:0.75em;color:#6b7280">${stats.totalMastered}/${stats.totalSkills} skills</span>
          </div>
        </div>
        <button class="student-card-edit" onclick="event.stopPropagation();openEditStudent('${parentUsername}','${key}')" title="Edit">✏️</button>
      </div>`;
  }).join('');
}

function selectChild(parentKey, childKey) {
  const users = getUsers();
  const child = users[childKey];
  if (!child) return;
  if (child.pinHash) {
    startPinFlow(parentKey, childKey);
  } else {
    activateChild(parentKey, childKey);
  }
}

function startPinFlow(parentKey, childKey) {
  const users = getUsers();
  const child = users[childKey];
  if (!child) return;
  _pendingChild = { parentKey, childKey };
  _pinDigits = [];
  updatePinDots();
  document.getElementById('pin-pad-title').textContent = child.displayName + "'s PIN";
  document.getElementById('pin-pad-avatar').innerHTML = child.avatarAnimal
    ? '<img src="' + twemojiUrl(child.avatarAnimal) + '" width="56" height="56" alt="avatar">'
    : '🐱';
  document.getElementById('pin-error').style.display = 'none';
  showScreen(pinPadScreen);
}

function activateChild(parentKey, childKey) {
  const users = getUsers();
  const child = users[childKey];
  if (!child) return;
  const sessionUser = { username: childKey, parentUsername: parentKey, ...child };
  setCurrentUser(sessionUser);
  setupStudentHeader(sessionUser);
  showScreen(setupScreen);
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('pin-dot-' + i);
    if (dot) dot.classList.toggle('filled', i < _pinDigits.length);
  }
}

function pinDigitPressed(d) {
  if (_pinDigits.length >= 4) return;
  _pinDigits.push(d);
  updatePinDots();
  if (_pinDigits.length === 4) setTimeout(verifyStudentPin, 140);
}

async function verifyStudentPin() {
  if (!_pendingChild) return;
  const { parentKey, childKey } = _pendingChild;
  const child = getUsers()[childKey];
  if (!child) return;
  const hash = await hashPin(parentKey, _pinDigits.join(''));
  if (hash === child.pinHash) {
    _pendingChild = null;
    _pinDigits = [];
    activateChild(parentKey, childKey);
  } else {
    _pinDigits = [];
    updatePinDots();
    const errEl = document.getElementById('pin-error');
    errEl.textContent = 'Wrong PIN — try again';
    errEl.style.display = 'block';
    const dotsEl = document.getElementById('pin-dots');
    if (dotsEl) {
      dotsEl.classList.add('pin-shake');
      setTimeout(() => dotsEl.classList.remove('pin-shake'), 400);
    }
  }
}

// Bind pin pad buttons
(function bindPinPad() {
  document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => pinDigitPressed(btn.dataset.digit));
  });
  const bsBtn = document.getElementById('pin-backspace-btn');
  if (bsBtn) bsBtn.addEventListener('click', () => {
    _pinDigits.pop();
    updatePinDots();
    const errEl = document.getElementById('pin-error');
    if (errEl) errEl.style.display = 'none';
  });
  const cancelBtn = document.getElementById('pin-cancel-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    _pendingChild = null;
    _pinDigits = [];
    const children = getAllChildren();
    renderStudentPickerNetflix(children);
    showScreen(studentPickerScreen);
  });
})();

// ── Student header ──

function setupStudentHeader(user) {
  const gradeSelectSection = document.getElementById('grade-select-section');
  if (!user) {
    studentHeader.style.display = 'none';
    genericHeader.style.display = 'block';
    if (gradeSelectSection) gradeSelectSection.style.display = 'block';
    return;
  }

  studentHeader.style.display = 'block';
  genericHeader.style.display = 'none';
  if (gradeSelectSection) gradeSelectSection.style.display = 'none';

  studentAvatar.innerHTML = avatarImgHtml(user, 56);
  studentGreeting.textContent = `Hi, ${user.displayName}! 🎉`;
  const grade = user.grade || 4;
  const gradeLabel = String(grade) === 'K' ? 'Kindergarten' : `Grade ${grade}`;
  studentGradeBadge.textContent = `${user.displayName}'s ${gradeLabel}`;

  // Set grade from profile
  selectedGrade = grade;
  updateGradeUI(grade);

  // Subject tiles + remembered subject
  renderSubjectTiles(user);
  selectSubject(user.lastSubject || null, { persist: false });

  // Retest banner
  updateRetestBanner(user);
}

// ── Subject picker ──
function renderSubjectTiles(user) {
  if (!subjectPicker) return;
  const grade = (user && user.grade) || selectedGrade || 4;
  subjectPicker.innerHTML = SUBJECT_ORDER.map(id => {
    const sub = SUBJECTS[id];
    const stats = user ? Curriculum.getSkillMasteryStats(user, id, grade) : { pct: 0, totalMastered: 0, totalSkills: 0 };
    return `<button type="button" class="subject-tile" data-subject="${id}" style="--tile-accent:${sub.accent};--tile-light:${sub.light};--tile-dark:${sub.dark}">
      <span class="subject-tile-emoji">${sub.emoji}</span>
      <span class="subject-tile-name">${sub.name}</span>
      <span class="subject-tile-bar"><span class="subject-tile-fill" style="width:${stats.pct}%"></span></span>
      <span class="subject-tile-stat">${stats.totalMastered}/${stats.totalSkills} skills</span>
    </button>`;
  }).join('');
  subjectPicker.querySelectorAll('.subject-tile').forEach(btn => {
    btn.addEventListener('click', () => selectSubject(btn.dataset.subject));
  });
}

function applySubjectTheme(subjectId) {
  if (subjectId && SUBJECTS[subjectId]) document.body.dataset.subject = subjectId;
  else delete document.body.dataset.subject;
}

function selectSubject(subjectId, opts) {
  opts = opts || {};
  if (subjectId && !SUBJECTS[subjectId]) subjectId = null;
  selectedSubject = subjectId;
  applySubjectTheme(subjectId);
  if (subjectPicker) {
    subjectPicker.querySelectorAll('.subject-tile').forEach(b => b.classList.toggle('active', b.dataset.subject === subjectId));
  }
  if (workForm) workForm.style.display = subjectId ? 'block' : 'none';
  if (!subjectId) return;
  const sub = SUBJECTS[subjectId];
  const problemText = document.getElementById('problem-text');
  if (problemText) problemText.placeholder = sub.placeholder;
  if (topicHintInput) topicHintInput.placeholder = sub.hintPlaceholder;
  const formTitle = document.getElementById('work-form-title');
  if (formTitle) formTitle.textContent = `${sub.emoji} ${sub.name}`;
  populateUnits();
  if (opts.persist !== false) {
    const user = getCurrentUser();
    if (user) {
      user.lastSubject = subjectId;
      setCurrentUser(user);
      const users = getUsers();
      if (users[user.username]) { users[user.username].lastSubject = subjectId; saveUsers(users); }
    }
  }
}

// Prefer the teacher-guide title from a brief over the folder-derived title.
function unitDisplayTitle(unit) {
  if (!unit) return '';
  const brief = Curriculum.getBrief(unit.id);
  return (brief && brief.title) || unit.title;
}

function populateUnits() {
  if (!unitSelect || !selectedSubject) return;
  const grade = selectedGrade || 4;
  const units = Curriculum.getUnits(selectedSubject, grade);
  const previous = selectedUnitId;
  let html = '<option value="">-- Pick a unit (optional) --</option>';
  const main = units.filter(u => u.kind === 'unit');
  const extras = units.filter(u => u.kind !== 'unit');
  main.forEach(u => { html += `<option value="${u.id}">Unit ${u.number}: ${escapeHtml(unitDisplayTitle(u))}${Curriculum.getBrief(u.id) ? ' 📖' : ''}</option>`; });
  if (extras.length) {
    html += `<optgroup label="${selectedSubject === 'classics' ? 'Library (any grade)' : 'More'}">`;
    extras.forEach(u => { html += `<option value="${u.id}">${escapeHtml(unitDisplayTitle(u))}${Curriculum.getBrief(u.id) ? ' 📖' : ''}</option>`; });
    html += '</optgroup>';
  }
  html += '<option value="other">Something else…</option>';
  unitSelect.innerHTML = html;
  unitSelect.value = units.some(u => u.id === previous) ? previous : '';
  onUnitChange();
}

function onUnitChange() {
  if (!unitSelect) return;
  const v = unitSelect.value;
  selectedUnitId = v && v !== 'other' ? v : null;
  const brief = selectedUnitId ? Curriculum.getBrief(selectedUnitId) : null;
  const hasLessons = !!(brief && brief.lessons && brief.lessons.length);
  if (lessonSection) lessonSection.style.display = hasLessons ? 'block' : 'none';
  if (hasLessons && lessonInput) {
    lessonInput.max = brief.lessons.length;
    const hint = document.getElementById('lesson-range-hint');
    if (hint) hint.textContent = `(1–${brief.lessons.length})`;
    if (parseInt(lessonInput.value) > brief.lessons.length) lessonInput.value = '';
  } else if (lessonInput) {
    lessonInput.value = '';
  }
  const hintSection = document.getElementById('topic-hint-section');
  if (hintSection) hintSection.style.display = 'block';
}

if (unitSelect) unitSelect.addEventListener('change', onUnitChange);

function updateRetestBanner(user) {
  if (!user || !user.retestSuggested || user.retestSuggested.length === 0) {
    retestBanner.style.display = 'none';
    return;
  }
  const subjectId = user.retestSuggested[0];
  const sub = SUBJECTS[subjectId];
  if (!sub) { retestBanner.style.display = 'none'; return; }
  retestBannerText.textContent = `You've been practicing ${sub.name}! Ready to test what you know? 🎯`;
  retestBanner.style.display = 'flex';
}

reportCardBtn.addEventListener('click', () => {
  showReportScreen();
});

takeTestBtn.addEventListener('click', () => {
  startTestMode();
});

const leaderboardBtn = document.getElementById('leaderboard-btn');
if (leaderboardBtn) leaderboardBtn.addEventListener('click', () => showLeaderboard());

retestNowBtn.addEventListener('click', () => {
  const user = getCurrentUser();
  if (user && user.retestSuggested && user.retestSuggested[0]) selectSubject(user.retestSuggested[0]);
  startTestMode();
});

async function doLogout() {
  setCurrentUser(null);
  _parentAuthed = false;
  studentHeader.style.display = 'none';
  genericHeader.style.display = 'block';
  const gradeSelectSection = document.getElementById('grade-select-section');
  if (gradeSelectSection) gradeSelectSection.style.display = 'block';
  const auth = getSupabaseAuth();
  if (auth) { try { await auth.signOut(); } catch(e) {} }
  showScreen(loginScreen);
}

logoutBtn.addEventListener('click', doLogout);

// ── Student picker bindings ──
function bindStudentPicker() {
  // Add student button — only visible when parent is authed
  const addStudentBtnEl = document.getElementById('add-student-btn');
  if (addStudentBtnEl) addStudentBtnEl.addEventListener('click', () => {
    // Use current parent session, or find first parent key from children
    const sess = getCurrentUser();
    let parentKey = sess && sess.isParent ? (sess.parentUsername || sess.username) : null;
    if (!parentKey) {
      // derive from first child
      const children = getAllChildren();
      parentKey = children.length > 0 ? children[0].parentKey : null;
    }
    if (parentKey) openAddStudent(parentKey);
  });
}
bindStudentPicker();

// ── Switch Student button ──
const switchStudentBtn = document.getElementById('switch-student-btn');
if (switchStudentBtn) {
  switchStudentBtn.addEventListener('click', () => {
    const children = getAllChildren();
    renderStudentPickerNetflix(children);
    showScreen(studentPickerScreen);
  });
}

// Supabase auth state listener (handles OAuth redirect returns and session restore)
(function setupSupabaseListener() {
  const auth = getSupabaseAuth();
  if (!auth) return;
  auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      handleSupabaseSession(session);
    } else if (event === 'SIGNED_OUT') {
      setCurrentUser(null);
      _parentAuthed = false;
    }
  });
})();

// ── Add/Edit Student Screen ──
let addStudentAvatarAnimal = ANIMAL_AVATARS[0].cp;
let addStudentGrade = 'K';
let editingChildKey = null;
let addStudentParentUsername = null;
let addStudentAvatarPickerBuilt = false;

function openAddStudent(parentUsername) {
  addStudentParentUsername = parentUsername;
  editingChildKey = null;
  addStudentGrade = 'K';
  addStudentAvatarAnimal = ANIMAL_AVATARS[0].cp;
  document.getElementById('add-student-title').textContent = 'Add Student';
  document.getElementById('student-name-input').value = '';
  document.getElementById('add-student-error').style.display = 'none';
  document.getElementById('delete-student-section').style.display = 'none';
  document.querySelectorAll('#add-student-grade-row .grade-select-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.grade === 'K');
  });
  updateAddStudentAvatarDisplay();
  ensureAddStudentAvatarPicker();
  renderPinStatus(null);
  hidePinInlineEntry();
  showScreen(addStudentScreen);
}

function openEditStudent(parentUsername, childKey) {
  const child = getUsers()[childKey];
  if (!child) return;
  addStudentParentUsername = parentUsername;
  editingChildKey = childKey;
  addStudentGrade = child.grade || 'K';
  addStudentAvatarAnimal = child.avatarAnimal || ANIMAL_AVATARS[0].cp;
  document.getElementById('add-student-title').textContent = 'Edit Student';
  document.getElementById('student-name-input').value = child.displayName || '';
  document.getElementById('add-student-error').style.display = 'none';
  document.getElementById('delete-student-section').style.display = 'block';
  document.querySelectorAll('#add-student-grade-row .grade-select-btn').forEach(b => {
    b.classList.toggle('active', String(b.dataset.grade) === String(addStudentGrade));
  });
  updateAddStudentAvatarDisplay();
  ensureAddStudentAvatarPicker();
  renderPinStatus(child.pinHash || null);
  hidePinInlineEntry();
  showScreen(addStudentScreen);
}

function renderPinStatus(pinHash) {
  const statusEl = document.getElementById('student-pin-status');
  if (!statusEl) return;
  if (pinHash) {
    statusEl.innerHTML =
      '<span class="pin-set-badge">🔐 PIN set</span>' +
      '<button class="pin-action-btn" id="set-pin-btn">Change PIN</button>' +
      '<button class="pin-action-btn danger" id="remove-pin-btn">Remove PIN</button>';
    document.getElementById('remove-pin-btn').addEventListener('click', async () => {
      if (!editingChildKey) return;
      const users = getUsers();
      if (users[editingChildKey]) { delete users[editingChildKey].pinHash; saveUsers(users); }
      renderPinStatus(null);
      hidePinInlineEntry();
    });
  } else {
    statusEl.innerHTML =
      '<span style="color:var(--gray-400);font-size:13px">No PIN set</span>' +
      '<button class="pin-action-btn" id="set-pin-btn">Set PIN</button>';
  }
  document.getElementById('set-pin-btn').addEventListener('click', () => {
    showPinInlineEntry();
  });
}

function showPinInlineEntry() {
  const el = document.getElementById('pin-entry-inline');
  if (el) {
    el.style.display = 'block';
    ['pin-d0','pin-d1','pin-d2','pin-d3','pin-c0','pin-c1','pin-c2','pin-c3'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) { inp.value = ''; }
    });
    document.getElementById('pin-entry-error') && (document.getElementById('pin-entry-error').style.display = 'none');
    document.getElementById('pin-d0') && document.getElementById('pin-d0').focus();
  }
}

function hidePinInlineEntry() {
  const el = document.getElementById('pin-entry-inline');
  if (el) el.style.display = 'none';
}

// Bind inline PIN save/cancel
(function bindInlinePin() {
  // Auto-advance digit inputs
  ['pin-d0','pin-d1','pin-d2','pin-d3','pin-c0','pin-c1','pin-c2','pin-c3'].forEach((id, i) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/[^0-9]/g, '').slice(-1);
      const ids = ['pin-d0','pin-d1','pin-d2','pin-d3','pin-c0','pin-c1','pin-c2','pin-c3'];
      if (inp.value && i < ids.length - 1) document.getElementById(ids[i+1]) && document.getElementById(ids[i+1]).focus();
    });
  });

  const savePinBtn = document.getElementById('pin-save-btn');
  if (savePinBtn) savePinBtn.addEventListener('click', async () => {
    const pin1 = ['pin-d0','pin-d1','pin-d2','pin-d3'].map(id => (document.getElementById(id)||{}).value||'').join('');
    const pin2 = ['pin-c0','pin-c1','pin-c2','pin-c3'].map(id => (document.getElementById(id)||{}).value||'').join('');
    const errEl = document.getElementById('pin-entry-error');
    if (pin1.length !== 4) { errEl.textContent = 'Please enter all 4 digits.'; errEl.style.display = 'block'; return; }
    if (pin1 !== pin2) { errEl.textContent = 'PINs do not match. Try again.'; errEl.style.display = 'block'; return; }
    // Save PIN hash to the child record (or stage for new students)
    if (editingChildKey) {
      const users = getUsers();
      const child = users[editingChildKey];
      if (child) {
        child.pinHash = await hashPin(addStudentParentUsername, pin1);
        saveUsers(users);
        renderPinStatus(child.pinHash);
        hidePinInlineEntry();
      }
    } else {
      // For new students, store pin temporarily to save with the record
      _pendingNewStudentPin = pin1;
      renderPinStatus('pending');
      hidePinInlineEntry();
    }
  });

  const cancelInlineBtn = document.getElementById('pin-cancel-inline-btn');
  if (cancelInlineBtn) cancelInlineBtn.addEventListener('click', hidePinInlineEntry);
})();
let _pendingNewStudentPin = null;

function updateAddStudentAvatarDisplay() {
  const display = document.getElementById('add-student-avatar-display');
  if (display) display.innerHTML = `<img src="${twemojiUrl(addStudentAvatarAnimal)}" width="72" height="72" alt="avatar" />`;
}

function ensureAddStudentAvatarPicker() {
  if (!addStudentAvatarPickerBuilt) {
    addStudentAvatarPickerBuilt = true;
    const picker = document.getElementById('add-student-avatar-picker');
    if (!picker) return;
    picker.className = 'avatar-grid';
    ANIMAL_AVATARS.forEach(({ name, cp }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-option';
      btn.title = name;
      const img = document.createElement('img');
      img.src = twemojiUrl(cp);
      img.width = 48; img.height = 48; img.alt = name; img.loading = 'lazy';
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        picker.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        addStudentAvatarAnimal = cp;
        updateAddStudentAvatarDisplay();
      });
      picker.appendChild(btn);
    });
  }
  const picker = document.getElementById('add-student-avatar-picker');
  if (picker) {
    picker.querySelectorAll('.avatar-option').forEach((btn, i) => {
      btn.classList.toggle('selected', ANIMAL_AVATARS[i].cp === addStudentAvatarAnimal);
    });
  }
}

function bindAddStudentScreen() {
  document.querySelectorAll('#add-student-grade-row .grade-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#add-student-grade-row .grade-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      addStudentGrade = btn.dataset.grade === 'K' ? 'K' : parseInt(btn.dataset.grade);
    });
  });

  document.getElementById('save-student-btn').addEventListener('click', () => {
    const name = document.getElementById('student-name-input').value.trim();
    const errorEl = document.getElementById('add-student-error');
    if (!name) { errorEl.textContent = 'Please enter a name.'; errorEl.style.display = 'block'; return; }

    if (editingChildKey) {
      const users = getUsers();
      const child = users[editingChildKey];
      if (child) {
        child.displayName = name;
        child.grade = addStudentGrade;
        child.avatarAnimal = addStudentAvatarAnimal;
        users[editingChildKey] = child;
        saveUsers(users);
      }
    } else {
      const childKey = makeChildKey(addStudentParentUsername, name);
      const newChild = {
        displayName: name,
        grade: addStudentGrade,
        avatarAnimal: addStudentAvatarAnimal,
        avatarAccessory: '',
        masteredSkills: {},
        reportCard: null,
        homeworkSessions: {},
        retestSuggested: [],
        testHistory: [],
      };
      if (_pendingNewStudentPin) {
        // hashPin is async; save after hashing
        hashPin(addStudentParentUsername, _pendingNewStudentPin).then(pinHash => {
          newChild.pinHash = pinHash;
          saveChild(addStudentParentUsername, childKey, newChild);
        });
        _pendingNewStudentPin = null;
      } else {
        saveChild(addStudentParentUsername, childKey, newChild);
      }
    }

    const children = getAllChildren();
    renderStudentPickerNetflix(children);
    showScreen(studentPickerScreen);
  });

  document.getElementById('cancel-student-btn').addEventListener('click', () => {
    const children = getAllChildren();
    renderStudentPickerNetflix(children);
    showScreen(studentPickerScreen);
  });

  document.getElementById('delete-student-btn').addEventListener('click', () => {
    if (!editingChildKey) return;
    if (confirm('Remove this student? Their progress will be deleted.')) {
      deleteChild(editingChildKey);
      const children = getAllChildren();
      renderStudentPickerNetflix(children);
      showScreen(studentPickerScreen);
    }
  });
}
bindAddStudentScreen();

// ── Avatar click → Profile ──
studentAvatar.addEventListener('click', () => {
  const user = getCurrentUser();
  if (user) openProfileScreen(user);
});

// ── Profile screen ──
let profileAvatarAnimal = '';
let profileAvatarAccessory = '';
let profileAvatarPickerBuilt = false;

function openProfileScreen(user) {
  profileAvatarAnimal = user.avatarAnimal || ANIMAL_AVATARS[0].cp;
  profileAvatarAccessory = user.avatarAccessory || '';

  document.getElementById('profile-displayname').value = user.displayName || '';
  document.getElementById('profile-current-pw').value = '';
  document.getElementById('profile-new-pw').value = '';
  document.getElementById('profile-confirm-pw').value = '';
  document.getElementById('profile-error').style.display = 'none';
  document.getElementById('profile-success').style.display = 'none';

  // Parent-only sections
  const parentSection = document.getElementById('parent-account-section');
  const pwSection = document.getElementById('profile-pw-section');
  if (user.isParent && parentSection) {
    parentSection.style.display = 'block';
    const emailEl = document.getElementById('parent-account-email');
    const badgeEl = document.getElementById('parent-account-badge');
    if (emailEl) emailEl.textContent = user.email || user.username || '';
    if (badgeEl) {
      badgeEl.textContent = user.authMethod === 'supabase' ? '🔵 Email/SSO' : '🔑 Username';
      badgeEl.className = 'account-badge ' + (user.authMethod === 'supabase' ? 'badge-supabase' : 'badge-legacy');
    }
    // Supabase users change password via reset email, not in-app
    if (pwSection) pwSection.style.display = user.authMethod === 'supabase' ? 'none' : 'block';
  } else {
    if (parentSection) parentSection.style.display = 'none';
    if (pwSection) pwSection.style.display = 'block';
  }

  const grade = user.grade || 4;
  ALL_GRADES.forEach(g => {
    const btn = document.getElementById(`profile-grade-${g}`);
    if (btn) btn.classList.toggle('active', String(grade) === String(g));
  });

  refreshProfileAvatarDisplay();
  document.getElementById('profile-avatar-picker-wrap').style.display = 'none';

  buildProfileAvatarPicker();
  showScreen(profileScreen);
}

// ── Backup / Restore ──
function downloadBackup() {
  const user = getCurrentUser();
  if (!user || !user.isParent) return;
  const parentKey = user.parentUsername || user.username;
  const users = getUsers();
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    parentKey,
    parent: users[parentKey] || {},
    children: {},
  };
  Object.keys(users).forEach(k => {
    if (k.startsWith(parentKey + ':')) backup.children[k] = users[k];
  });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'studybuddy-backup-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleRestoreFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const backup = JSON.parse(e.target.result);
      if (!backup.version || !backup.parentKey || !backup.children) throw new Error('Invalid backup file.');
      if (!confirm('Restore backup? Existing children with the same IDs will be overwritten.')) return;
      const users = getUsers();
      if (backup.parent) users[backup.parentKey] = backup.parent;
      Object.assign(users, backup.children);
      Object.values(users).forEach(u => Curriculum.migrateUser(u));
      saveUsers(users);
      const children = getAllChildren();
      renderStudentPickerNetflix(children);
      showScreen(studentPickerScreen);
    } catch (err) {
      alert('Could not restore backup: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// Bind backup/restore buttons
(function bindBackupButtons() {
  const dlBtn = document.getElementById('download-backup-btn');
  if (dlBtn) dlBtn.addEventListener('click', downloadBackup);
  const restoreBtn = document.getElementById('restore-backup-btn');
  const fileInput = document.getElementById('restore-file-input');
  if (restoreBtn && fileInput) {
    restoreBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { handleRestoreFile(e.target.files[0]); e.target.value = ''; });
  }
})();

function refreshProfileAvatarDisplay() {
  document.getElementById('profile-avatar-display').innerHTML = animalAvatarHtml(profileAvatarAnimal, profileAvatarAccessory, 80);
}

function buildProfileAvatarPicker() {
  if (profileAvatarPickerBuilt) return;
  profileAvatarPickerBuilt = true;
  const picker = document.getElementById('profile-avatar-picker');
  if (!picker) return;

  const gridLabel = document.createElement('p');
  gridLabel.className = 'avatar-section-label';
  gridLabel.textContent = 'Choose your animal';
  picker.appendChild(gridLabel);

  const grid = document.createElement('div');
  grid.className = 'avatar-grid';
  picker.appendChild(grid);

  ANIMAL_AVATARS.forEach(({ name, cp }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = name;
    btn.className = 'avatar-option';
    const img = document.createElement('img');
    img.src = twemojiUrl(cp);
    img.width = 48; img.height = 48; img.alt = name; img.loading = 'lazy';
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      profileAvatarAnimal = cp;
      refreshProfileAvatarDisplay();
    });
    grid.appendChild(btn);
  });

  const accLabel = document.createElement('p');
  accLabel.className = 'avatar-section-label';
  accLabel.textContent = 'Add an accessory';
  picker.appendChild(accLabel);

  const accRow = document.createElement('div');
  accRow.className = 'avatar-accessory-row';
  picker.appendChild(accRow);

  AVATAR_ACCESSORIES.forEach((acc, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acc-option' + (idx === 0 ? ' selected' : '');
    btn.textContent = acc.label;
    btn.addEventListener('click', () => {
      accRow.querySelectorAll('.acc-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      profileAvatarAccessory = acc.id;
      refreshProfileAvatarDisplay();
    });
    accRow.appendChild(btn);
  });
}

// Sync selected state when picker opens (animal/accessory may differ from defaults)
function syncProfilePickerSelection() {
  const grid = document.querySelector('#profile-avatar-picker .avatar-grid');
  if (grid) {
    grid.querySelectorAll('.avatar-option').forEach((btn, i) => {
      btn.classList.toggle('selected', ANIMAL_AVATARS[i].cp === profileAvatarAnimal);
    });
  }
  const accRow = document.querySelector('#profile-avatar-picker .avatar-accessory-row');
  if (accRow) {
    accRow.querySelectorAll('.acc-option').forEach((btn, i) => {
      btn.classList.toggle('selected', AVATAR_ACCESSORIES[i].id === profileAvatarAccessory);
    });
  }
}

function bindProfile() {
  const backBtn = document.getElementById('profile-back-btn');
  const changeAvatarBtn = document.getElementById('profile-change-avatar-btn');
  const saveBtn = document.getElementById('profile-save-btn');
  if (!backBtn) return; // profile screen not in DOM (old cached HTML)

  backBtn.addEventListener('click', () => showScreen(setupScreen));

  changeAvatarBtn.addEventListener('click', () => {
    const wrap = document.getElementById('profile-avatar-picker-wrap');
    const open = wrap.style.display === 'none';
    wrap.style.display = open ? 'block' : 'none';
    if (open) syncProfilePickerSelection();
  });

  ALL_GRADES.forEach(g => {
    const btn = document.getElementById(`profile-grade-${g}`);
    if (!btn) return;
    btn.addEventListener('click', function() {
      ALL_GRADES.forEach(og => {
        const ob = document.getElementById(`profile-grade-${og}`);
        if (ob) ob.classList.remove('active');
      });
      this.classList.add('active');
    });
  });

  saveBtn.addEventListener('click', async () => {
  const errorEl = document.getElementById('profile-error');
  const successEl = document.getElementById('profile-success');
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  const user = getCurrentUser();
  if (!user) return;

  const displayName = document.getElementById('profile-displayname').value.trim();
  if (!displayName) { errorEl.textContent = 'Display name cannot be empty.'; errorEl.style.display = 'block'; return; }

  const activeGradeBtn = document.querySelector('#profile-screen .grade-select-btn.active');
  const gradeRaw = activeGradeBtn ? activeGradeBtn.dataset.grade : '4';
  const grade = gradeRaw === 'K' ? 'K' : parseInt(gradeRaw);

  const currentPw = document.getElementById('profile-current-pw').value;
  const newPw = document.getElementById('profile-new-pw').value;
  const confirmPw = document.getElementById('profile-confirm-pw').value;

  const users = getUsers();
  const stored = users[user.username];
  if (!stored) return;

  // Password change (optional)
  if (newPw || currentPw) {
    if (!currentPw) { errorEl.textContent = 'Enter your current password to change it.'; errorEl.style.display = 'block'; return; }
    const currentHash = await hashPassword(currentPw);
    if (currentHash !== stored.passwordHash) { errorEl.textContent = 'Current password is incorrect.'; errorEl.style.display = 'block'; return; }
    if (newPw.length < 4) { errorEl.textContent = 'New password must be at least 4 characters.'; errorEl.style.display = 'block'; return; }
    if (newPw !== confirmPw) { errorEl.textContent = 'New passwords do not match.'; errorEl.style.display = 'block'; return; }
    stored.passwordHash = await hashPassword(newPw);
  }

  stored.displayName = displayName;
  stored.grade = grade;
  stored.avatarAnimal = profileAvatarAnimal;
  stored.avatarAccessory = profileAvatarAccessory;
  users[user.username] = stored;
  saveUsers(users);

  const updatedUser = { username: user.username, ...stored };
  setCurrentUser(updatedUser);
  setupStudentHeader(updatedUser);

  successEl.style.display = 'block';
  setTimeout(() => { successEl.style.display = 'none'; showScreen(setupScreen); }, 1200);
  });
}
bindProfile();

// ── Grade selection on setup screen ──
function updateGradeUI(grade) {
  const gradeStr = String(grade);
  ALL_GRADES.forEach(g => {
    const btn = document.getElementById(`setup-grade-${g}`);
    if (btn) btn.classList.toggle('active', String(g) === gradeStr);
  });
}

ALL_GRADES.forEach(g => {
  const btn = document.getElementById(`setup-grade-${g}`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const grade = g === 'K' ? 'K' : parseInt(g);
    selectedGrade = grade;
    updateGradeUI(grade);
    const user = getCurrentUser();
    if (user) {
      user.grade = grade;
      setCurrentUser(user);
      const users = getUsers();
      if (users[user.username]) {
        users[user.username].grade = grade;
        saveUsers(users);
      }
      const gradeLabel = g === 'K' ? 'Kindergarten' : `Grade ${g}`;
      studentGradeBadge.textContent = `${user.displayName}'s ${gradeLabel}`;
      renderSubjectTiles(user);
      if (selectedSubject) selectSubject(selectedSubject, { persist: false });
    }
    populateUnits();
  });
});

// ── Tab switching ──
document.querySelectorAll('.method-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.method-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.method-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    inputMethod = tab.dataset.method;
    document.getElementById(`method-${inputMethod}`).classList.add('active');
  });
});

// ── Photo upload ──
function handlePhotoFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl = ev.target.result;
    photoBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    photoMediaType = file.type || 'image/jpeg';
    photoPreview.src = dataUrl;
    photoPreview.style.display = 'block';
    photoPlaceholder.style.display = 'none';
    clearPhotoBtn.style.display = 'inline-block';
    e.target.value = '';
  };
  reader.readAsDataURL(file);
}
photoCameraInput.addEventListener('change', handlePhotoFile);
photoUploadInput.addEventListener('change', handlePhotoFile);
document.getElementById('camera-btn').addEventListener('click', () => photoCameraInput.click());
document.getElementById('upload-btn').addEventListener('click', () => photoUploadInput.click());

clearPhotoBtn.addEventListener('click', () => {
  photoBase64 = null;
  photoMediaType = null;
  photoCameraInput.value = '';
  photoUploadInput.value = '';
  photoPreview.style.display = 'none';
  photoPlaceholder.style.display = 'block';
  clearPhotoBtn.style.display = 'none';
});

// ── Start homework session ──
startBtn.addEventListener('click', startSession);

function currentUnit() {
  return selectedUnitId ? Curriculum.getUnit(selectedUnitId) : null;
}

function buildCurrentPrompt(mode) {
  const grade = selectedGrade || 4;
  const unit = currentUnit();
  const lesson = lessonInput && lessonInput.value ? parseInt(lessonInput.value) : null;
  return Prompts.buildSystemPrompt({
    subject: selectedSubject || 'math',
    grade,
    unit,
    lesson,
    brief: unit ? Curriculum.getBrief(unit.id) : null,
    topicHint: (topicHintInput && topicHintInput.value.trim()) || '',
    mode,
    curriculum: window.CURRICULUM,
  });
}

function sessionSubtitle() {
  const grade = selectedGrade || 4;
  const gl = Prompts.gradeLabel(grade);
  const sub = SUBJECTS[selectedSubject || 'math'];
  const unit = currentUnit();
  const hint = topicHintInput && topicHintInput.value.trim();
  const topic = unit ? unitDisplayTitle(unit) : (hint || '');
  return `${gl} ${sub.short}${topic ? ' · ' + topic : ''}`;
}

function beginChat(mode, initialUserMessage, imageData) {
  currentMode = 'homework';
  const sub = SUBJECTS[selectedSubject || 'math'];
  currentSystemPrompt = buildCurrentPrompt(mode);
  currentSessionKey = `${selectedSubject || 'math'}:${selectedUnitId || 'general'}`;
  showScreen(chatScreen);
  chatSubtitle.textContent = sessionSubtitle();
  const owl = document.getElementById('chat-owl');
  if (owl) owl.textContent = '🦉';
  const badge = document.getElementById('chat-subject-badge');
  if (badge) badge.textContent = sub.emoji;

  conversationHistory = [];
  chatMessages.innerHTML = '';
  const intro = mode === 'lesson'
    ? `Hi! I'm Study Buddy! 🦉 Let's learn some ${sub.name} together today!\n\nI'll explain it step by step, show you an example, and then you get to try. You've got this! 💪`
    : `Hi! I'm Study Buddy! 🦉 I'm so excited to work on ${sub.name} with you today!\n\nI'll never just give you the answer — we'll figure it out together, step by step. You've got this! 💪`;
  appendBuddyMessage(intro);

  if (imageData) {
    appendUserImageMessage(imageData.base64, imageData.mediaType);
    streamToAnthropic(buildImageMessages(imageData.base64, imageData.mediaType), true);
  } else {
    appendUserMessage(initialUserMessage);
    conversationHistory.push({ role: 'user', content: initialUserMessage });
    streamToAnthropic(conversationHistory, false);
  }
}

function startSession() {
  if (!getApiKey()) { notifyNotConfigured(); return; }
  if (!selectedSubject) { alert('Pick a subject first! 📚'); return; }

  const topicHint = (topicHintInput && topicHintInput.value.trim()) || '';
  let initialUserMessage = null;
  let imageData = null;

  if (inputMethod === 'type') {
    const text = document.getElementById('problem-text').value.trim();
    if (!text) { alert('Please type your question or problem first! ✏️'); return; }
    initialUserMessage = topicHint
      ? `Topic: ${topicHint}\n\nI need help with this: ${text}`
      : `I need help with this: ${text}`;
  } else if (inputMethod === 'photo') {
    if (!photoBase64) { alert('Please take or upload a photo of your problem first! 📷'); return; }
    imageData = { base64: photoBase64, mediaType: photoMediaType };
  }
  beginChat('homework', initialUserMessage, imageData);
}

function startLesson() {
  if (!getApiKey()) { notifyNotConfigured(); return; }
  if (!selectedSubject) { alert('Pick a subject first! 📚'); return; }
  const unit = currentUnit();
  const lesson = lessonInput && lessonInput.value ? parseInt(lessonInput.value) : null;
  const topicHint = (topicHintInput && topicHintInput.value.trim()) || '';
  if (!unit && !topicHint) { alert('Pick a unit or type what you want to learn about first! 📖'); return; }
  const what = unit ? `${unitDisplayTitle(unit)}${lesson ? `, Lesson ${lesson}` : ''}` : topicHint;
  beginChat('lesson', `Please teach me about ${what}. Start the lesson!`, null);
}

if (lessonBtn) lessonBtn.addEventListener('click', startLesson);

function buildImageMessages(base64, mediaType) {
  return [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: "I took a photo of my homework problem. Please read it and guide me through it step by step — but don't give me the answer! Ask me questions to help me figure it out." },
    ],
  }];
}

// ── Navigation: Back from chat screen ──
backBtn.addEventListener('click', () => {
  // Track homework session for retest suggestion
  if (currentSessionKey) {
    const user = getCurrentUser();
    if (user) trackHomeworkSession(user, currentSessionKey);
    currentSessionKey = null;
  }
  showScreen(setupScreen);
});

newProblemBtn.addEventListener('click', () => {
  // Track homework session for retest suggestion
  if (currentSessionKey) {
    const user = getCurrentUser();
    if (user) trackHomeworkSession(user, currentSessionKey);
    currentSessionKey = null;
  }
  showScreen(setupScreen);
  document.getElementById('problem-text').value = '';
  clearPhotoBtn.click();
});

// ── Track homework sessions for retest suggestion ──
function trackHomeworkSession(user, sessionKey) {
  if (!sessionKey) return;
  const users = getUsers();
  const storedUser = users[user.username];
  if (!storedUser) return;

  if (!storedUser.homeworkSessions) storedUser.homeworkSessions = {};
  storedUser.homeworkSessions[sessionKey] = (storedUser.homeworkSessions[sessionKey] || 0) + 1;

  // Suggest a skills test after 3+ sessions in a subject whose mastery is still under 80%
  const subject = sessionKey.split(':')[0];
  const subjectSessions = Object.entries(storedUser.homeworkSessions)
    .filter(([k]) => k.startsWith(subject + ':'))
    .reduce((n, [, v]) => n + v, 0);
  if (subjectSessions >= 3 && SUBJECTS[subject]) {
    const stats = Curriculum.getSkillMasteryStats(storedUser, subject, storedUser.grade || selectedGrade || 4);
    if (stats.pct < 80) {
      if (!storedUser.retestSuggested) storedUser.retestSuggested = [];
      if (!storedUser.retestSuggested.includes(subject)) storedUser.retestSuggested.push(subject);
    }
  }

  users[user.username] = storedUser;
  saveUsers(users);

  const updatedUser = { ...user, ...storedUser, username: user.username };
  setCurrentUser(updatedUser);
  updateRetestBanner(updatedUser);
  renderSubjectTiles(updatedUser);
}

// ── Send message (homework) ──
sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

function sendMessage() {
  if (isStreaming) return;
  const text = chatInput.value.trim();
  if (!text) return;
  appendUserMessage(text);
  conversationHistory.push({ role: 'user', content: text });
  chatInput.value = '';
  chatInput.style.height = 'auto';
  streamToAnthropic(conversationHistory, false);
}

// ── Direct Anthropic API streaming (homework) ──
async function streamToAnthropic(messages, isImageRequest) {
  const apiKey = getApiKey();
  if (!apiKey) {
    appendBuddyMessage("Oops! Study Buddy isn't set up on this site yet. Please ask a parent to finish the setup. 🦉");
    return;
  }

  isStreaming = true;
  sendBtn.disabled = true;
  const typingEl = appendTypingIndicator(chatMessages);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        stream: true,
        system: currentSystemPrompt,
        messages,
      }),
    });

    typingEl.remove();

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 401) {
        appendBuddyMessage("❌ Study Buddy couldn't connect. Please ask a parent to check the site setup.");
      } else {
        appendBuddyMessage(`Hmm, something went wrong (${response.status}: ${errBody.error?.message || 'unknown error'}). Please try again!`);
      }
      return;
    }

    const buddyBubble = appendBuddyMessage('', true, chatMessages);
    let fullText = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]' || !json) continue;
        try {
          const evt = JSON.parse(json);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            fullText += evt.delta.text;
            buddyBubble.innerHTML = formatMessage(fullText);
            scrollToBottom(chatMessages);
          }
        } catch {}
      }
    }

    // Save assistant turn to history
    if (isImageRequest) {
      conversationHistory.push(...messages);
    }
    if (fullText) {
      conversationHistory.push({ role: 'assistant', content: fullText });
    }

    checkForComprehensionTrigger(fullText);
  } catch (err) {
    typingEl?.remove();
    const detail = err?.message ? ` (${err.message})` : '';
    appendBuddyMessage(`Oops! I had trouble connecting${detail}. Check your internet and try again. 🔄`);
    console.error(err);
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

// ── Test mode ──
function startTestTimer() {
  const timerEl = document.getElementById('test-timer');
  const floatEl = document.getElementById('floating-timer');
  testSecondsLeft = 25 * 60;
  clearInterval(testTimerInterval);

  if (floatEl) { floatEl.style.display = 'block'; floatEl.classList.remove('timer-warning'); }

  function tick() {
    const m = Math.floor(testSecondsLeft / 60);
    const s = testSecondsLeft % 60;
    const display = `⏱ ${m}:${String(s).padStart(2, '0')}`;
    if (timerEl) timerEl.textContent = display;
    if (floatEl) floatEl.textContent = display;

    if (testSecondsLeft <= 120) {
      if (timerEl) timerEl.classList.add('timer-warning');
      if (floatEl) floatEl.classList.add('timer-warning');
    }
    if (testSecondsLeft <= 0) {
      stopTestTimer();
      if (timerEl) timerEl.textContent = '⏱ 0:00';
      appendTestBuddyMessage("⏰ Time's up! Let me wrap up your results...");
      finishTestBtn.click();
      return;
    }
    testSecondsLeft--;
  }

  tick();
  testTimerInterval = setInterval(tick, 1000);
}

function stopTestTimer() {
  clearInterval(testTimerInterval);
  testTimerInterval = null;
  const timerEl = document.getElementById('test-timer');
  const floatEl = document.getElementById('floating-timer');
  if (timerEl) timerEl.classList.remove('timer-warning');
  if (floatEl) { floatEl.style.display = 'none'; floatEl.classList.remove('timer-warning'); }
}

// Skills being tested in the current session
let currentTestSkills = [];
let currentTestSubject = 'math';

function startTestMode() {
  if (!getApiKey()) { notifyNotConfigured(); return; }
  const user = getCurrentUser();
  const grade = user ? (user.grade || 4) : selectedGrade || 4;
  const gradeLabel = String(grade) === 'K' ? 'Kindergarten' : `Grade ${grade}`;
  if (!selectedSubject) { alert('Pick a subject first! 📚'); return; }
  currentTestSubject = selectedSubject;
  const sub = SUBJECTS[currentTestSubject];

  // Get unmastered curriculum skills for this subject + grade
  const unmastered = user ? Curriculum.getUnmasteredSkills(user, currentTestSubject, grade, 6) : Curriculum.getGradeSkills(currentTestSubject, grade).slice(0, 6);
  currentTestSkills = unmastered;

  // If all skills mastered, celebrate instead of testing
  if (user && unmastered.length === 0 && Curriculum.getGradeSkills(currentTestSubject, grade).length > 0) {
    currentMode = 'test';
    testMessages.innerHTML = '';
    testSubtitle.textContent = `${gradeLabel} ${sub.short} — Complete! 🏆`;
    showScreen(testScreen);
    appendTestBuddyMessage(`🎉🏆 WOW! You've mastered ALL the ${gradeLabel} ${sub.name} skills! You're incredible!\n\nThere's nothing left to test for ${gradeLabel} ${sub.name}. Try another subject, or talk to your teacher about moving up! 🚀`);
    return;
  }
  if (unmastered.length === 0) {
    alert(`There are no ${sub.name} skills to test for ${gradeLabel} yet.`);
    return;
  }

  currentMode = 'test';
  testConversationHistory = [];
  testMessages.innerHTML = '';
  testSubtitle.textContent = `${gradeLabel} ${sub.short} Skills Test`;
  testPaused = false;
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (pauseTestBtn) { pauseTestBtn.textContent = '⏸'; pauseTestBtn.title = 'Pause test'; }

  showScreen(testScreen);
  startTestTimer();

  const skillCount = unmastered.length;
  const intro = skillCount > 0
    ? `Hi! I'm Study Buddy in Skills Mode! 🦉📝\n\nI'm going to test you on ${skillCount} ${sub.name} skill${skillCount > 1 ? 's' : ''} to see what you know. Answer your best — you can earn ⭐ Leadership Points for each skill you show me!\n\nLet's go! 🚀`
    : `Hi! I'm Study Buddy in Assessment Mode! 🦉📝\n\nI'm going to ask you some ${sub.name} questions to see how you're doing. Answer your best and earn ⭐ Leadership Points!\n\nLet's get started! 🚀`;

  appendTestBuddyMessage(intro);

  const startMsg = "Please start the assessment now.";
  testConversationHistory.push({ role: 'user', content: startMsg });
  streamTestToAnthropic(testConversationHistory);
}

testBackBtn.addEventListener('click', () => {
  stopTestTimer();
  showScreen(setupScreen);
});

// ── Pause / Resume ──
let testPaused = false;
const pauseTestBtn = document.getElementById('pause-test-btn');
const pauseOverlay = document.getElementById('test-pause-overlay');
const resumeTestBtn = document.getElementById('resume-test-btn');

function pauseTest() {
  if (isTestStreaming || testPaused) return;
  testPaused = true;
  clearInterval(testTimerInterval);
  testTimerInterval = null;
  const floatEl = document.getElementById('floating-timer');
  if (floatEl) floatEl.style.display = 'none';
  if (pauseOverlay) pauseOverlay.style.display = 'flex';
  if (pauseTestBtn) { pauseTestBtn.textContent = '▶'; pauseTestBtn.title = 'Resume test'; }
}

function resumeTest() {
  if (!testPaused) return;
  testPaused = false;
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (pauseTestBtn) { pauseTestBtn.textContent = '⏸'; pauseTestBtn.title = 'Pause test'; }
  // Restart ticking from wherever testSecondsLeft is
  const timerEl = document.getElementById('test-timer');
  const floatEl = document.getElementById('floating-timer');
  if (floatEl) floatEl.style.display = 'block';
  function tick() {
    const m = Math.floor(testSecondsLeft / 60);
    const s = testSecondsLeft % 60;
    const display = `⏱ ${m}:${String(s).padStart(2, '0')}`;
    if (timerEl) timerEl.textContent = display;
    if (floatEl) floatEl.textContent = display;
    if (testSecondsLeft <= 120) {
      if (timerEl) timerEl.classList.add('timer-warning');
      if (floatEl) floatEl.classList.add('timer-warning');
    }
    if (testSecondsLeft <= 0) {
      stopTestTimer();
      if (timerEl) timerEl.textContent = '⏱ 0:00';
      appendTestBuddyMessage("⏰ Time's up! Let me wrap up your results...");
      finishTestBtn.click();
      return;
    }
    testSecondsLeft--;
  }
  tick();
  testTimerInterval = setInterval(tick, 1000);
}

if (pauseTestBtn) pauseTestBtn.addEventListener('click', () => testPaused ? resumeTest() : pauseTest());
if (resumeTestBtn) resumeTestBtn.addEventListener('click', resumeTest);

finishTestBtn.addEventListener('click', async () => {
  if (isTestStreaming) return;
  stopTestTimer();
  await generateReportCardNow();
});

testSendBtn.addEventListener('click', sendTestMessage);

testInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTestMessage(); }
});

testInput.addEventListener('input', () => {
  testInput.style.height = 'auto';
  testInput.style.height = Math.min(testInput.scrollHeight, 120) + 'px';
});

function sendTestMessage() {
  if (isTestStreaming) return;
  const text = testInput.value.trim();
  if (!text) return;
  appendTestUserMessage(text);
  testConversationHistory.push({ role: 'user', content: text });
  testInput.value = '';
  testInput.style.height = 'auto';
  streamTestToAnthropic(testConversationHistory);
}

async function streamTestToAnthropic(messages) {
  const apiKey = getApiKey();
  if (!apiKey) {
    appendTestBuddyMessage("Oops! Study Buddy isn't set up on this site yet. Please ask a parent to finish the setup. 🦉");
    return;
  }

  const user = getCurrentUser();
  const grade = user ? (user.grade || 4) : selectedGrade || 4;

  isTestStreaming = true;
  testSendBtn.disabled = true;
  finishTestBtn.disabled = true;
  const typingEl = appendTypingIndicator(testMessages);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        stream: true,
        system: Prompts.buildTestSystemPrompt({ subject: currentTestSubject, grade, skills: currentTestSkills }),
        messages,
      }),
    });

    typingEl.remove();

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      appendTestBuddyMessage(`Hmm, something went wrong (${response.status}: ${errBody.error?.message || 'unknown error'}). Please try again!`);
      return;
    }

    const buddyBubble = appendTestBuddyMessage('', true);
    let fullText = '';
    let reportCardFound = false;
    let skillsReportFound = false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]' || !json) continue;
        try {
          const evt = JSON.parse(json);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            fullText += evt.delta.text;

            // Check for report markers while streaming
            if (!reportCardFound && fullText.includes('===REPORT_CARD_START===')) reportCardFound = true;
            if (!skillsReportFound && fullText.includes('===SKILLS_REPORT_START===')) skillsReportFound = true;

            // Display text without any report blocks
            const displayText = stripReportCardBlock(fullText)
              .replace(/===SKILLS_REPORT_START===[\s\S]*?===SKILLS_REPORT_END===/g, '').trim();
            buddyBubble.innerHTML = formatMessage(displayText);
            scrollToBottom(testMessages);
          }
        } catch {}
      }
    }

    // Save assistant turn
    if (fullText) {
      testConversationHistory.push({ role: 'assistant', content: fullText });
    }

    // Process skills report (new curriculum-based test)
    if (skillsReportFound && fullText.includes('===SKILLS_REPORT_END===')) {
      const report = extractSkillsReport(fullText);
      if (report) {
        const user = getCurrentUser();
        const masteredKeys = report.results
          .filter(r => r.mastered)
          .map(r => `${r.sectionIndex}:${r.skillIndex}`);
        if (user && masteredKeys.length > 0) {
          markSkillsMastered(user.username, report.subject || currentTestSubject, report.grade, masteredKeys);
        }
        const xp = report.xpEarned || (masteredKeys.length * 10);
        const masteredCount = masteredKeys.length;
        const total = report.results.length;
        setTimeout(() => {
          appendTestBuddyMessage(
            `🎯 Skills Report: You mastered ${masteredCount} of ${total} skills!\n` +
            `⭐ +${xp} Leadership Points earned!\n\n` +
            (masteredCount > 0 ? `Great work on: ${report.results.filter(r=>r.mastered).map(r=>r.section).filter((v,i,a)=>a.indexOf(v)===i).join(', ')} 🏆` : 'Keep practicing — you\'ll get there! 💪')
          );
          setTimeout(() => showReportScreen(), 2000);
        }, 500);
      }
    }

    // Process old-style report card if present
    if (reportCardFound && fullText.includes('===REPORT_CARD_END===')) {
      const reportCard = extractReportCard(fullText);
      if (reportCard) {
        saveReportCard(reportCard);
        setTimeout(() => showReportScreen(), 1500);
      }
    }

  } catch (err) {
    typingEl?.remove();
    const detail = err?.message ? ` (${err.message})` : '';
    appendTestBuddyMessage(`Oops! I had trouble connecting${detail}. Check your internet and try again. 🔄`);
    console.error(err);
  } finally {
    isTestStreaming = false;
    testSendBtn.disabled = false;
    finishTestBtn.disabled = false;
    testInput.focus();
  }
}

async function generateReportCardNow() {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const user = getCurrentUser();
  const grade = user ? (user.grade || 4) : selectedGrade || 4;

  isTestStreaming = true;
  testSendBtn.disabled = true;
  finishTestBtn.disabled = true;

  appendTestBuddyMessage("Generating your report card... 📊");

  // Skills-based path (new curriculum test)
  if (currentTestSkills.length > 0) {
    // Use a dedicated system prompt focused only on producing the report JSON.
    // Prime the conversation with an assistant turn so the model is in "reporting" mode.
    const reportSystemPrompt = Prompts.buildReportSystemPrompt({ subject: currentTestSubject, grade, skills: currentTestSkills });

    const messages = [
      ...testConversationHistory,
      { role: 'assistant', content: "Let me tally your results now..." },
      { role: 'user', content: 'Output the skills report JSON block now.' },
    ];

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          stream: false,
          system: reportSystemPrompt,
          messages,
        }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        appendTestBuddyMessage(`Could not generate report card (${response.status}). Please try again.`);
        return;
      }
      const data = await response.json();
      const fullText = data.content?.[0]?.text || '';
      console.log('[FinishTest skills report]', fullText);
      const report = extractSkillsReport(fullText);
      if (report) {
        const masteredKeys = report.results.filter(r => r.mastered).map(r => `${r.sectionIndex}:${r.skillIndex}`);
        if (masteredKeys.length > 0) markSkillsMastered(user.username, report.subject || currentTestSubject, report.grade, masteredKeys);
        const xp = masteredKeys.length * 10;
        appendTestBuddyMessage(`🎉 Done! You mastered **${masteredKeys.length}** of ${report.results.length} skills and earned **${xp} XP**!`);
        setTimeout(() => showReportScreen(), 800);
      } else {
        console.warn('[FinishTest] Could not parse skills report from:', fullText);
        appendTestBuddyMessage("Hmm, I had trouble reading your results. You can keep going or try finishing again!");
      }
    } catch (err) {
      appendTestBuddyMessage("Oops! Something went wrong. You can keep going or try finishing again!");
      console.error(err);
    } finally {
      isTestStreaming = false;
      testSendBtn.disabled = false;
      finishTestBtn.disabled = false;
    }
    return;
  }

  appendTestBuddyMessage("There were no skills in this test to report on.");
  isTestStreaming = false;
  testSendBtn.disabled = false;
  finishTestBtn.disabled = false;
}

// ── Mastery storage ──
function markSkillsMastered(username, subject, grade, keys) {
  if (!keys || !keys.length) return;
  const users = getUsers();
  if (!users[username]) return;
  users[username].masteredSkills = Curriculum.addMastered(users[username].masteredSkills, subject, grade, keys);
  saveUsers(users);
  const session = getCurrentUser();
  if (session && session.username === username) {
    session.masteredSkills = users[username].masteredSkills;
    setCurrentUser(session);
  }
}

function stripReportCardBlock(text) {
  const startMarker = '===REPORT_CARD_START===';
  const endMarker = '===REPORT_CARD_END===';
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return text;
  const endIdx = text.indexOf(endMarker);
  if (endIdx === -1) {
    // Marker started but not ended yet — strip from start marker to end
    return text.slice(0, startIdx).trim();
  }
  return (text.slice(0, startIdx) + text.slice(endIdx + endMarker.length)).trim();
}

function extractReportCard(text) {
  const startMarker = '===REPORT_CARD_START===';
  const endMarker = '===REPORT_CARD_END===';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) return null;
  const jsonStr = text.slice(startIdx + startMarker.length, endIdx).trim();
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse report card JSON:', e, jsonStr);
    return null;
  }
}

function extractSkillsReport(text) {
  const startMarker = '===SKILLS_REPORT_START===';
  const endMarker = '===SKILLS_REPORT_END===';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) return null;
  const jsonStr = text.slice(startIdx + startMarker.length, endIdx).trim();
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse skills report JSON:', e, jsonStr);
    return null;
  }
}

function saveReportCard(reportCard) {
  const user = getCurrentUser();
  if (!user) return;

  reportCard.date = new Date().toISOString();

  const users = getUsers();
  if (users[user.username]) {
    users[user.username].reportCard = reportCard;
    // Append to testHistory for leaderboard XP tracking
    if (!users[user.username].testHistory) users[user.username].testHistory = [];
    users[user.username].testHistory.push({
      date: reportCard.date,
      score: reportCard.overallScore || 0,
      grade: reportCard.grade,
    });
    // Clear retestSuggested for modules that now have score >= 80
    if (users[user.username].retestSuggested && reportCard.topics) {
      users[user.username].retestSuggested = users[user.username].retestSuggested.filter(modNum => {
        const topic = reportCard.topics.find(t => t.module === modNum);
        return !topic || topic.score < 80;
      });
    }
    saveUsers(users);
  }

  const updatedUser = { ...user, reportCard };
  setCurrentUser(updatedUser);
}

// ── Report card screen ──
function showReportScreen() {
  const user = getCurrentUser();
  renderReportCard(user);
  showScreen(reportScreen);
}

function renderReportCard(user) {
  const reportContent = document.getElementById('report-content');
  const grade = user.grade || selectedGrade || 4;
  const overall = Curriculum.getOverallMastery(user, grade);

  if (!user || (!user.reportCard && overall.totalMastered === 0)) {
    reportContent.innerHTML = `
      <div class="report-empty">
        <div class="report-empty-icon">📊</div>
        <h2>No Skills Tests Yet</h2>
        <p>Pick a subject and take your first Skills Test to see your report card!</p>
        <button class="start-btn" onclick="showScreen(setupScreen)">📚 Choose a Subject</button>
      </div>
    `;
    return;
  }

  const gradeLabel = Prompts.gradeLabel(grade);
  const xp = Curriculum.calcUserXP(user);
  const level = Curriculum.getUserLevel(xp);

  // One mastery block per subject: current subject first, then subjects with progress, then the rest
  const order = SUBJECT_ORDER.slice().sort((a, b) => {
    const sa = overall.subjects.find(x => x.subject === a), sb = overall.subjects.find(x => x.subject === b);
    if (a === selectedSubject) return -1; if (b === selectedSubject) return 1;
    return (sb.totalMastered > 0) - (sa.totalMastered > 0);
  });
  const subjectBlocks = order.map(id => {
    const sub = SUBJECTS[id];
    const st = overall.subjects.find(x => x.subject === id);
    if (!st || st.totalSkills === 0) return '';
    const color = sub.accent;
    const secHtml = st.totalMastered > 0 ? st.sections.map(sec => {
      const c = sec.pct >= 100 ? '#16a34a' : sec.pct >= 50 ? '#d97706' : '#6b7280';
      const check = sec.pct >= 100 ? ' ✅' : '';
      return `
        <div class="report-topic-card" style="margin-bottom:8px">
          <div class="report-topic-header">
            <div class="report-topic-name" style="font-size:0.9em">${escapeHtml(sec.section)}${check}</div>
            <div class="report-topic-score"><span class="score-pct" style="color:${c};font-size:0.9em">${sec.done}/${sec.total}</span></div>
          </div>
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:0%;background:${c}" data-width="${sec.pct}"></div></div>
        </div>`;
    }).join('') : `<p class="report-subject-empty">No ${sub.name} skills tested yet.</p>`;
    return `
      <div class="report-subject" style="--accent:${color};--accent-light:${sub.light};--accent-dark:${sub.dark}">
        <h3 class="report-subject-title">${sub.emoji} ${sub.name} — ${st.totalMastered} of ${st.totalSkills} skills (${st.pct}%)</h3>
        <div class="progress-bar-track" style="margin-bottom:12px"><div class="progress-bar-fill" style="width:0%;background:${color}" data-width="${st.pct}"></div></div>
        ${secHtml}
        <button class="retake-module-btn" onclick="selectSubject('${id}');startTestMode()">🎯 ${st.totalMastered > 0 ? 'Test more' : 'Take'} ${sub.short} skills</button>
      </div>`;
  }).join('');

  reportContent.innerHTML = `
    <div class="report-header">
      <h2>📊 ${escapeHtml(user.displayName)}'s Report Card</h2>
      <p class="report-date">${gradeLabel} • ${overall.totalMastered} of ${overall.totalSkills} skills mastered across all subjects</p>
    </div>

    <div class="overall-score-block" style="border-color:${level.color};text-align:center">
      <div style="font-size:2em">${level.icon}</div>
      <div class="overall-score-num" style="color:${level.color}">${xp} XP</div>
      <div class="overall-level" style="color:${level.color}">${level.label}</div>
      <div class="overall-label">Leadership Points</div>
    </div>

    ${subjectBlocks}

    <div class="report-actions">
      <button class="start-btn report-action-btn" onclick="showScreen(setupScreen)">📚 Back to Subjects</button>
    </div>
  `;

  requestAnimationFrame(() => {
    reportContent.querySelectorAll('.progress-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.width + '%';
    });
  });
}

function scoreToLevel(score) {
  if (score >= 80) return 'Proficient';
  if (score >= 60) return 'Developing';
  return 'Needs Support';
}

function scoreToColor(score) {
  if (score >= 80) return '#16a34a'; // green
  if (score >= 60) return '#d97706'; // yellow/amber
  return '#dc2626'; // red
}

// ── Test UI helpers ──
function appendTestUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `<div class="message-avatar">${avatarImgHtml(getCurrentUser(), 36)}</div><div class="message-bubble">${escapeHtml(text)}</div>`;
  testMessages.appendChild(el);
  scrollToBottom(testMessages);
}

function appendTestBuddyMessage(text, streaming = false) {
  const el = document.createElement('div');
  el.className = 'message buddy';
  el.innerHTML = `<div class="message-avatar">🦉</div><div class="message-bubble">${streaming ? '' : formatMessage(text)}</div>`;
  testMessages.appendChild(el);
  scrollToBottom(testMessages);
  return el.querySelector('.message-bubble');
}

// ── UI helpers ──
function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `<div class="message-avatar">${avatarImgHtml(getCurrentUser(), 36)}</div><div class="message-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(el);
  scrollToBottom(chatMessages);
}

function appendUserImageMessage(base64, mediaType) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `
    <div class="message-avatar">${avatarImgHtml(getCurrentUser(), 36)}</div>
    <div class="message-bubble">
      <img src="data:${mediaType};base64,${base64}" class="message-image" alt="Homework photo" />
      <div>Here's my homework problem!</div>
    </div>`;
  chatMessages.appendChild(el);
  scrollToBottom(chatMessages);
}

function appendBuddyMessage(text, streaming = false, container) {
  container = container || chatMessages;
  const el = document.createElement('div');
  el.className = 'message buddy';
  el.innerHTML = `<div class="message-avatar">🦉</div><div class="message-bubble">${streaming ? '' : formatMessage(text)}</div>`;
  container.appendChild(el);
  scrollToBottom(container);
  return el.querySelector('.message-bubble');
}

function appendTypingIndicator(container) {
  container = container || chatMessages;
  const el = document.createElement('div');
  el.className = 'message buddy';
  el.innerHTML = `<div class="message-avatar">🦉</div><div class="message-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  container.appendChild(el);
  scrollToBottom(container);
  return el;
}

function appendComprehensionBanner() {
  const el = document.createElement('div');
  el.className = 'comprehension-banner';
  el.textContent = "🌟 Comprehension Check Time! Let's make sure you really understand! 🌟";
  chatMessages.appendChild(el);
  scrollToBottom(chatMessages);
}

function checkForComprehensionTrigger(text) {
  const lower = text.toLowerCase();
  const triggers = ['comprehension check','check your understanding','let me check if you really understand',
    'try a similar problem','practice problem',"you've solved it","you got it","great work! now","awesome work!"];
  if (triggers.some(t => lower.includes(t))) appendComprehensionBanner();
}

function formatMessage(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function escapeHtml(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scrollToBottom(container) {
  container = container || chatMessages;
  container.scrollTop = container.scrollHeight;
}

// ── Leaderboard ──

const calcUserXP = Curriculum.calcUserXP;
const getUserLevel = Curriculum.getUserLevel;

function showLeaderboard() {
  if (!leaderboardScreen) return;
  const users = getUsers();
  const currentUser = getCurrentUser();
  const content = document.getElementById('leaderboard-content');

  const entries = Object.entries(users).filter(([, user]) => user && !user.isParent && user.displayName).map(([username, user]) => {
    const xp = calcUserXP(user);
    const level = getUserLevel(xp);
    const history = (user.testHistory && user.testHistory.length > 0)
      ? user.testHistory
      : (user.reportCard ? [{ score: user.reportCard.overallScore || 0, date: user.reportCard.date }] : []);
    const lastScore = history.length > 0 ? history[history.length - 1].score : null;
    let trend = '';
    if (history.length >= 2) {
      const diff = history[history.length - 1].score - history[history.length - 2].score;
      trend = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    }
    const totalSessions = Object.values(user.homeworkSessions || {}).reduce((a, b) => a + b, 0);
    return { username, user, xp, level, lastScore, trend, testsCount: history.length, totalSessions };
  });

  entries.sort((a, b) => b.xp - a.xp);

  const medals = ['🥇', '🥈', '🥉'];

  const rows = entries.map((e, i) => {
    const isMe = currentUser && e.username === currentUser.username;
    const medal = i < 3 ? medals[i] : `<span class="lb-rank-num">${i + 1}</span>`;
    const avatarHtml = avatarImgHtml(e.user, 44);
    const nextXp = e.level.next;
    const barMax = nextXp || e.xp || 1;
    const barPrev = nextXp ? { 5000:2500,2500:1000,1000:400,400:100,100:0 }[nextXp] || 0 : 0;
    const barFill = nextXp ? Math.round(((e.xp - barPrev) / (nextXp - barPrev)) * 100) : 100;
    const testStr = e.testsCount === 0 ? 'No tests yet' : `${e.testsCount} test${e.testsCount > 1 ? 's' : ''}`;
    const sessionStr = e.totalSessions > 0 ? ` · ${e.totalSessions} sessions` : '';
    const scoreStr = e.lastScore !== null ? ` · Last: ${Math.round(e.lastScore)}% ${e.trend}` : '';
    const breakdown = Curriculum.subjectXPBreakdown(e.user).map(b => `${SUBJECTS[b.subject].emoji} ${b.mastered}`).join('  ');
    return `
      <div class="lb-entry${isMe ? ' lb-entry-me' : ''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-avatar">${avatarHtml}</div>
        <div class="lb-info">
          <div class="lb-name">${escapeHtml(e.user.displayName || e.username)}${isMe ? ' <span class="lb-you">you</span>' : ''}</div>
          <div class="lb-level" style="color:${e.level.color}">${e.level.icon} ${e.level.label}</div>
          <div class="lb-bar-track"><div class="lb-bar-fill" style="width:0%;background:${e.level.color}" data-fill="${barFill}"></div></div>
          <div class="lb-stats">${testStr}${sessionStr}${scoreStr}</div>
          ${breakdown ? `<div class="lb-stats lb-breakdown" title="Skills mastered per subject">${breakdown}</div>` : ''}
        </div>
        <div class="lb-xp" style="color:${e.level.color}">${e.xp}<span class="lb-xp-label">XP</span></div>
      </div>`;
  }).join('');

  const legendHtml = `
    <div class="lb-legend">
      <p class="lb-legend-title">How XP is earned</p>
      <div class="lb-legend-row"><span>🎯 Skill mastered (any subject)</span><span>+10 XP</span></div>
      <div class="lb-legend-row"><span>✅ Whole section mastered</span><span>+50 XP bonus</span></div>
      <div class="lb-legend-row"><span>🏆 Whole grade in a subject</span><span>+200 XP bonus</span></div>
      <div class="lb-legend-row"><span>📚 Homework or lesson session</span><span>+5 XP each</span></div>
    </div>`;

  content.innerHTML = entries.length === 0
    ? '<p style="text-align:center;color:#888;padding:32px">No students yet! Register an account to appear here.</p>'
    : `<div class="lb-list">${rows}</div>${legendHtml}`;

  // Animate bars
  requestAnimationFrame(() => {
    content.querySelectorAll('.lb-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.fill + '%';
    });
  });

  showScreen(leaderboardScreen);
}

const leaderboardBackBtn = document.getElementById('leaderboard-back-btn');
if (leaderboardBackBtn) leaderboardBackBtn.addEventListener('click', () => showScreen(setupScreen));

// ── Voice input ──

function initVoiceInput(textareaId, btnId) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById(btnId);
  if (!SR || !btn) return;

  btn.style.display = 'flex';
  let listening = false;
  let recognition = null;

  function stopListening() {
    if (recognition) { try { recognition.stop(); } catch(e) {} recognition = null; }
    listening = false;
    btn.textContent = '🎤';
    btn.classList.remove('voice-listening');
    btn.title = 'Speak your answer';
  }

  function startListening() {
    if (listening) { stopListening(); return; }
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    const ta = document.getElementById(textareaId);
    if (ta) ta.value = '';

    recognition.onstart = () => {
      listening = true;
      btn.textContent = '🔴';
      btn.classList.add('voice-listening');
      btn.title = 'Listening… tap to stop';
    };

    recognition.onresult = (e) => {
      const ta = document.getElementById(textareaId);
      if (!ta) return;
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      ta.value = transcript;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    };

    recognition.onend = () => stopListening();

    recognition.onerror = (e) => {
      stopListening();
      if (e.error === 'not-allowed') {
        const ta = document.getElementById(textareaId);
        if (ta) ta.placeholder = 'Microphone access denied — please allow microphone in browser settings.';
      }
    };

    try { recognition.start(); } catch(e) { stopListening(); }
  }

  btn.addEventListener('click', startListening);
}

initVoiceInput('chat-input', 'voice-btn');
initVoiceInput('test-input', 'test-voice-btn');

// ── Startup (runs last: all consts and functions above are now initialized) ──
(function init() {
  // Hide SSO / password-reset controls when Supabase is not configured for this deployment
  if (!getSupabaseAuth()) {
    const sso = document.getElementById('sso-buttons');
    if (sso) sso.style.display = 'none';
    const forgot = document.getElementById('forgot-pw-link');
    if (forgot) forgot.style.display = 'none';
  }
  // Netflix-style: check for a student in session first
  const user = getCurrentUser();
  if (user && !user.isParent) {
    setupStudentHeader(user);
    showScreen(setupScreen);
    return;
  }

  // Check if there are any children stored on this device
  const children = getAllChildren();
  if (children.length > 0) {
    // Show the Netflix-style picker — no parent login needed
    renderStudentPickerNetflix(children);
    showScreen(studentPickerScreen);
    return;
  }

  // No children yet — check Supabase session first, fall back to legacy
  const auth = getSupabaseAuth();
  if (auth) {
    auth.getSession().then(({ data: { session } }) => {
      if (session) {
        handleSupabaseSession(session);
      } else {
        // Listen for OAuth redirects (returning from Google/Apple)
        auth.onAuthStateChange((event, sess) => {
          if (event === 'SIGNED_IN' && sess) handleSupabaseSession(sess);
        });
        showScreen(loginScreen);
      }
    });
  } else {
    // No Supabase — check legacy parent session or show login
    if (user && user.isParent) {
      _parentAuthed = true;
      renderStudentPickerNetflix([]);
      showScreen(studentPickerScreen);
    } else {
      showScreen(loginScreen);
    }
  }
})();
