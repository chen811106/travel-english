/* =========================================================
 * storage.js — 學習進度與設定（存在 localStorage）
 *
 * 每個練習項目都有一個「key」：
 *   對話句子  restaurant.order:d3   （場景.情境:d第幾句）
 *   句型      restaurant.order:p0
 *   聽力題目  restaurant.order:q2
 *
 * 資料結構：
 * {
 *   settings: { slow, showZh, helpSeen },
 *   best:  { "restaurant.order:d3": 85 },      // 跟讀最高分
 *   done:  { "restaurant.order:q2": true,      // 做過 / 答對的項目
 *            "L:restaurant.order": true,       // L: 聽完整段對話
 *            "R:restaurant.order:q2": true },  // R: 實戰問答答對
 *   days:  { "2026-11-01": { shadowed:[], quiz:[], patterns:[], listened:[], roleplay:[] } }
 * }
 * ========================================================= */

const KEY = 'travelEnglish.v2';
export const DAILY_GOAL = 5; // 每日跟讀目標（句）

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

const state = Object.assign({ settings: {}, best: {}, done: {}, days: {} }, load());
state.settings = Object.assign({ slow: false, showZh: true, helpSeen: false }, state.settings);

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 私密模式或空間滿了：忽略 */
  }
}

// 本地時間的日期字串 YYYY-MM-DD
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const emptyDay = () => ({ shadowed: [], quiz: [], patterns: [], listened: [], roleplay: [] });

// 今天的紀錄（沒有就建立；只保留最近 60 天）
function today() {
  const k = dateKey();
  if (!state.days[k]) {
    state.days[k] = emptyDay();
    const keys = Object.keys(state.days).sort();
    while (keys.length > 60) delete state.days[keys.shift()];
  }
  return Object.assign(state.days[k], { ...emptyDay(), ...state.days[k] });
}

function addToday(type, key) {
  const list = today()[type];
  if (!list.includes(key)) list.push(key);
}

/* ---------- 設定 ---------- */
export const getSetting = (name) => state.settings[name];
export function setSetting(name, value) {
  state.settings[name] = value;
  save();
}

/* ---------- 記錄學習 ---------- */
export function markListened(unit) {
  state.done['L:' + unit] = true;
  addToday('listened', unit);
  save();
}
export function markShadowed(key, score) {
  state.best[key] = Math.max(state.best[key] || 0, score);
  addToday('shadowed', key);
  save();
}
export function markQuiz(key) {
  state.done[key] = true;
  addToday('quiz', key);
  save();
}
export function markPattern(key) {
  state.done[key] = true;
  addToday('patterns', key);
  save();
}
export function markRoleplay(key) {
  state.done['R:' + key] = true;
  addToday('roleplay', key);
  save();
}

/* ---------- 查詢 ---------- */
export const getBest = (key) => state.best[key];
export const isDone = (key) => !!state.done[key];

export function getToday() {
  const d = { ...emptyDay(), ...(state.days[dateKey()] || {}) };
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length]));
}

// 連續學習天數（今天還沒練的話，從昨天開始往回算）
export function getStreak() {
  const has = (k) => state.days[k] && Object.values(state.days[k]).some((v) => v.length);
  const cur = new Date();
  if (!has(dateKey(cur))) cur.setDate(cur.getDate() - 1);
  let n = 0;
  while (has(dateKey(cur))) {
    n++;
    cur.setDate(cur.getDate() - 1);
  }
  return n;
}

// 情境完成度 0–100：聽完對話、每句跟讀 70 分以上、每個句型、每題聽力
export function situationPercent(sit) {
  const total = 1 + sit.dialogue.length + sit.patterns.length + sit.questions.length;
  let done = isDone('L:' + sit.unit) ? 1 : 0;
  done += sit.dialogue.filter((d) => (state.best[d._key] || 0) >= 70).length;
  done += sit.patterns.filter((p) => isDone(p._key)).length;
  done += sit.questions.filter((q) => isDone(q._key)).length;
  return Math.round((done / total) * 100);
}

// 場景完成度＝各情境平均
export function scenePercent(scene) {
  const list = scene.situations.map(situationPercent);
  return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0;
}
