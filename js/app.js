/* =========================================================
 * app.js — 畫面與流程
 *
 * 網址（hash）對應的畫面：
 *   #/                                首頁（選場景）
 *   #/scene/restaurant                選情境（入座、點餐…、綜合練習）
 *   #/scene/restaurant/order/listen   情境練習：listen / shadow / pattern / quiz / roleplay
 *   #/scene/restaurant/mix/shadow     綜合練習（所有情境混在一起）
 * ========================================================= */

import * as store from './storage.js';
import * as speech from './speech.js';
import { bestOf, scoreSentence, tokenize, feedback } from './score.js';

const app = document.getElementById('app');

// 所有分頁
const TAB_INFO = {
  listen:   { name: '聽',   icon: '🎧' },
  shadow:   { name: '跟讀', icon: '🎤' },
  pattern:  { name: '句型', icon: '🧩' },
  quiz:     { name: '聽懂', icon: '👂' },
  roleplay: { name: '實戰', icon: '💬' },
};
const SITUATION_TABS = ['listen', 'shadow', 'pattern', 'quiz', 'roleplay'];
const MIX_TABS = ['roleplay', 'quiz', 'shadow', 'pattern'];

const PASS_SCORE = 60; // 實戰問答：60 分以上算店員聽得懂

/* ---------------- 小工具 ---------------- */

// 防止資料中的文字被當成 HTML
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 句首字母大寫（句型 "{}, please." 填入 "a bag" 時用）
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// 一句話的所有說法：[主要說法, ...其他說法]
const variantsOf = (item) => [item.en, ...(item.alts || [])];

const isSlow = () => !!store.getSetting('slow');

// 播放一句（先停掉其他聲音）
function say(text, role) {
  speech.stopSpeaking();
  return speech.speak(text, { slow: isSlow(), role });
}

/* ---------------- 資料載入 ---------------- */

let scenesCache = null;
const sceneCache = {};
const mixCache = {};

async function getScenes() {
  if (!scenesCache) {
    const res = await fetch('data/scenes.json');
    scenesCache = (await res.json()).scenes;
  }
  return scenesCache;
}

// 載入場景資料，並幫每個項目加上 key、角色等資訊
async function getScene(id) {
  if (sceneCache[id]) return sceneCache[id];
  const info = (await getScenes()).find((s) => s.id === id && s.available);
  if (!info) throw new Error('找不到這個場景');
  const scene = await (await fetch(info.file)).json();
  scene.emoji = info.emoji;

  for (const sit of scene.situations) {
    sit.unit = `${scene.id}.${sit.id}`;
    sit.roles = { ...scene.roles, ...(sit.roles || {}) };
    const tag = (list, letter) =>
      list.forEach((item, i) => Object.assign(item, { _key: `${sit.unit}:${letter}${i}`, _roles: sit.roles, _sit: sit.title }));
    tag(sit.dialogue, 'd');
    tag(sit.patterns, 'p');
    tag(sit.questions, 'q');
  }
  sceneCache[id] = scene;
  return scene;
}

// 綜合練習：把所有情境的內容混在一起、隨機排序
function getMix(scene) {
  if (!mixCache[scene.id]) {
    const all = (k) => scene.situations.flatMap((s) => s[k]);
    mixCache[scene.id] = {
      id: 'mix',
      unit: `${scene.id}.mix`,
      title: '綜合練習',
      isMix: true,
      dialogue: shuffle(all('dialogue')).slice(0, 12),
      patterns: all('patterns'),
      questions: shuffle(all('questions')).slice(0, 10),
    };
  }
  return mixCache[scene.id];
}

/* ---------------- 路由 ---------------- */

async function router() {
  // 換頁時停止所有聲音與錄音
  speech.stopSpeaking();
  speech.abortListening();

  const [p0, sceneId, sitId, tab] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (p0 === 'settings') renderSettings();
    else if (p0 === 'scene' && sceneId && sitId) await renderSituation(sceneId, sitId, tab);
    else if (p0 === 'scene' && sceneId) await renderPicker(sceneId);
    else await renderHome();
  } catch (err) {
    console.error(err);
    app.innerHTML = `
      <div class="page"><div class="notice warn">
        <p>載入失敗：${esc(err.message)}</p>
        <p>如果你是直接雙擊打開 index.html，請改用本機伺服器開啟（見 README）。</p>
        <a class="btn primary" href="#/">回首頁</a>
      </div></div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', router);

/* =========================================================
 * 首頁
 * ========================================================= */

async function renderHome() {
  const scenes = await getScenes();
  const today = store.getToday();
  const streak = store.getStreak();
  const goal = store.DAILY_GOAL;
  const pct = Math.min(100, Math.round((today.shadowed / goal) * 100));

  const percents = {};
  for (const s of scenes.filter((s) => s.available)) {
    try {
      percents[s.id] = store.scenePercent(await getScene(s.id));
    } catch {
      percents[s.id] = 0;
    }
  }

  app.innerHTML = `
    <header class="hero">
      <h1>旅遊英文開口說</h1>
      <p>每天練一點，出國開口不卡關！</p>
    </header>

    <main class="page">
      <section class="card today">
        <div class="today-head">
          <h2>今日進度</h2>
          ${streak > 0 ? `<span class="streak">🔥 連續 ${streak} 天</span>` : ''}
        </div>
        <div class="goal">
          <div class="goal-text">今天跟讀了 <b>${today.shadowed}</b> 句 <span class="muted">／目標 ${goal} 句</span></div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
          ${today.shadowed >= goal ? '<p class="goal-done">🎉 今天的目標完成了！</p>' : ''}
        </div>
        <ul class="stats">
          <li><span class="stat-num">${today.listened}</span><span>聽完對話</span></li>
          <li><span class="stat-num">${today.patterns}</span><span>練習句型</span></li>
          <li><span class="stat-num">${today.quiz}</span><span>聽懂題目</span></li>
          <li><span class="stat-num">${today.roleplay}</span><span>實戰答對</span></li>
        </ul>
      </section>

      <h2 class="section-title">選擇場景</h2>
      <div class="scene-grid">
        ${scenes.map((s) => s.available ? `
          <a class="scene-card" href="#/scene/${esc(s.id)}">
            <span class="scene-emoji">${s.emoji}</span>
            <span class="scene-title">${esc(s.title)}</span>
            <span class="scene-desc">${esc(s.desc)}</span>
            <span class="mini-bar"><span style="width:${percents[s.id]}%"></span></span>
            <span class="scene-pct">完成 ${percents[s.id]}%</span>
          </a>` : `
          <div class="scene-card locked" aria-disabled="true">
            <span class="scene-emoji">${s.emoji}</span>
            <span class="scene-title">${esc(s.title)}</span>
            <span class="scene-desc">${esc(s.desc)}</span>
            <span class="soon">即將推出</span>
          </div>`).join('')}
      </div>
      <a class="btn ghost block" href="#/settings">🔊 聲音設定（選男聲／女聲）</a>
      ${supportNotice()}
    </main>`;
}

// 瀏覽器支援度提示
function supportNotice() {
  const msgs = [];
  if (!speech.ttsSupported) msgs.push('你的瀏覽器不支援語音播放，請改用手機的 Chrome 或 Safari。');
  if (!speech.sttSupported) msgs.push('你的瀏覽器不支援語音辨識，「跟讀」和「實戰」無法自動評分。建議使用 Android 的 Chrome 或 iPhone 的 Safari。');
  else if (!window.isSecureContext) msgs.push('目前不是安全連線（https），麥克風可能無法使用。');
  return msgs.length ? `<div class="notice warn">${msgs.map((m) => `<p>⚠️ ${m}</p>`).join('')}</div>` : '';
}

/* =========================================================
 * 選情境頁
 * ========================================================= */

async function renderPicker(sceneId) {
  const scene = await getScene(sceneId);
  delete mixCache[sceneId]; // 每次進來，綜合練習都重新洗牌

  app.innerHTML = `
    <header class="topbar">
      <a class="back" href="#/" aria-label="回首頁">‹</a>
      <h1>${scene.emoji} ${esc(scene.title)}</h1>
    </header>
    <main class="page">
      <p class="tip">選一個情境開始練習。每個情境都照順序練：聽 → 跟讀 → 句型 → 聽懂 → 實戰。</p>
      <div class="sit-list">
        ${scene.situations.map((s) => {
          const pct = store.situationPercent(s);
          return `
          <a class="sit-card" href="#/scene/${esc(scene.id)}/${esc(s.id)}/listen">
            <span class="sit-emoji">${s.emoji}</span>
            <span class="sit-body">
              <span class="sit-title">${esc(s.title)}</span>
              <span class="sit-desc">${esc(s.desc)}</span>
              <span class="mini-bar"><span style="width:${pct}%"></span></span>
            </span>
            <span class="sit-pct">${pct}%</span>
          </a>`;
        }).join('')}
        <a class="sit-card mix" href="#/scene/${esc(scene.id)}/mix/roleplay">
          <span class="sit-emoji">🎲</span>
          <span class="sit-body">
            <span class="sit-title">綜合練習</span>
            <span class="sit-desc">所有情境混在一起隨機出題，像真的出國一樣！</span>
          </span>
          <span class="sit-pct">›</span>
        </a>
      </div>
    </main>`;
}

/* =========================================================
 * 情境練習頁（共用外框：上方標題列＋語速切換，下方分頁列）
 * ========================================================= */

async function renderSituation(sceneId, sitId, tab) {
  const scene = await getScene(sceneId);
  const sit = sitId === 'mix' ? getMix(scene) : scene.situations.find((s) => s.id === sitId);
  if (!sit) throw new Error('找不到這個情境');
  const tabs = sit.isMix ? MIX_TABS : SITUATION_TABS;
  if (!tabs.includes(tab)) tab = tabs[0];

  app.innerHTML = `
    <header class="topbar">
      <a class="back" href="#/scene/${esc(scene.id)}" aria-label="回上一頁">‹</a>
      <h1><small>${esc(scene.title)}</small>${sit.isMix ? '🎲' : sit.emoji} ${esc(sit.title)}</h1>
      <div class="speed" role="group" aria-label="語速">
        <button data-slow="0" class="${isSlow() ? '' : 'on'}">正常</button>
        <button data-slow="1" class="${isSlow() ? 'on' : ''}">🐢慢速</button>
      </div>
    </header>
    <main class="page with-tabs" id="tab-content"></main>
    <nav class="tabbar" style="--tabs:${tabs.length}">
      ${tabs.map((t, i) => `
        <a href="#/scene/${esc(scene.id)}/${esc(sit.id)}/${t}" class="${t === tab ? 'active' : ''}">
          <span class="tab-icon">${TAB_INFO[t].icon}</span>
          <span class="tab-name">${i + 1}.${TAB_INFO[t].name}</span>
        </a>`).join('')}
    </nav>`;

  app.querySelectorAll('.speed button').forEach((b) =>
    b.addEventListener('click', () => {
      store.setSetting('slow', b.dataset.slow === '1');
      app.querySelectorAll('.speed button').forEach((x) => x.classList.toggle('on', x === b));
    })
  );

  const ctx = { scene, sit, tabs, tab };
  const views = { listen: viewListen, shadow: viewShadow, pattern: viewPattern, quiz: viewQuiz, roleplay: viewRoleplay };
  views[tab](document.getElementById('tab-content'), ctx);
}

// 頁面最下方的「下一步」按鈕
function nextStep({ scene, sit, tabs, tab }) {
  const next = tabs[tabs.indexOf(tab) + 1];
  if (!next) return `<a class="btn ghost block" href="#/scene/${esc(scene.id)}">✅ 完成！選其他情境</a>`;
  return `<a class="btn ghost block" href="#/scene/${esc(scene.id)}/${esc(sit.id)}/${next}">下一步：${TAB_INFO[next].name} →</a>`;
}

// 角色顯示（店員 / 你）
const roleOf = (item) => item._roles[item.role] || { name: '', emoji: '' };

// 綜合練習時，標出這題來自哪個情境
const sitBadge = (ctx, item) => (ctx.sit.isMix ? `<span class="sit-badge">${esc(item._sit)}</span>` : '');

/* ---------------- 錄音相關的共用畫面 ---------------- */

// 錄音使用說明（第一次自動展開）
function helpHtml() {
  return `
    <details class="help" ${store.getSetting('helpSeen') ? '' : 'open'}>
      <summary>❓ 錄音怎麼用？</summary>
      <ol>
        <li>按下 <b>🎤 錄音</b>。第一次會問能不能用麥克風，請按 <b>「允許」</b>。</li>
        <li>直接用英文說。<b>唸對的字會馬上變成綠色</b>。</li>
        <li><b>講完停一下就會自動結束</b>，不用再按停止。</li>
        <li>如果太久沒聽到聲音，會問你要不要 <b>再試一次</b>。</li>
        <li>手機靠近一點、在安靜的地方唸，分數會比較準。</li>
      </ol>
    </details>`;
}

function bindHelp(el) {
  el.querySelector('.help')?.addEventListener('toggle', (e) => {
    if (!e.target.open) store.setSetting('helpSeen', true);
  });
}

// 錄音中的提示
const listeningHtml = () => `
  <div class="listening">
    <span class="mic-dot"></span>
    <div>
      <p><b>請開始說…</b> 講完停一下就會自動結束</p>
      <p class="live" id="live"></p>
    </div>
  </div>`;

// 沒聽到聲音時，問要不要再試一次
const retryHtml = (msg) => `
  <div class="retry">
    <p>🤔 ${esc(msg)}要再試一次嗎？</p>
    <p class="muted">小提醒：按下按鈕後等半秒再開口，手機靠近嘴巴一點。</p>
    <button class="btn primary big block" data-retry>🎤 再試一次</button>
  </div>`;

const errorHtml = (msg) => `<div class="notice warn"><p>⚠️ ${esc(msg)}</p></div>`;

/* =========================================================
 * 分頁：聽
 * ========================================================= */

function viewListen(el, ctx) {
  const { sit } = ctx;
  const showZh = store.getSetting('showZh') !== false;

  el.innerHTML = `
    <p class="tip">先聽整段對話。點句子可以重聽，點「💬 也可以說」看看同一句話的其他說法。</p>
    <div class="row">
      <button class="btn primary big" id="play-all">▶ 播放整段</button>
      <label class="switch"><input type="checkbox" id="zh-toggle" ${showZh ? 'checked' : ''}> 顯示中文</label>
    </div>
    <ol class="dialogue ${showZh ? '' : 'hide-zh'}" id="dialogue">
      ${sit.dialogue.map((line, i) => {
        const r = roleOf(line);
        return `
        <li class="bubble ${line.role}" data-i="${i}">
          <span class="who">${r.emoji} ${esc(r.name)}</span>
          <button class="say">
            <span class="en">${esc(line.en)}</span>
            <span class="zh">${esc(line.zh)}</span>
            <span class="spk">🔊</span>
          </button>
          ${line.alts?.length ? `
            <button class="alt-toggle">💬 也可以說（${line.alts.length}）</button>
            <div class="alt-list" hidden>
              ${line.alts.map((a) => `<button class="alt-say" data-text="${esc(a)}">🔊 ${esc(a)}</button>`).join('')}
            </div>` : ''}
        </li>`;
      }).join('')}
    </ol>
    ${nextStep(ctx)}`;

  const list = el.querySelector('#dialogue');
  const btn = el.querySelector('#play-all');
  let playing = false;

  const highlight = (i) => {
    list.querySelectorAll('.bubble').forEach((b) => b.classList.toggle('playing', Number(b.dataset.i) === i));
    list.querySelector(`.bubble[data-i="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const setPlaying = (v) => {
    playing = v;
    btn.textContent = v ? '■ 停止' : '▶ 播放整段';
    btn.classList.toggle('stop', v);
    if (!v) highlight(-1);
  };

  btn.addEventListener('click', async () => {
    if (playing) {
      speech.stopSpeaking();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const completed = await speech.speakAll(sit.dialogue, { slow: isSlow(), onLine: highlight });
    if (completed) store.markListened(sit.unit);
    if (completed || playing) setPlaying(false);
  });

  list.addEventListener('click', async (e) => {
    const li = e.target.closest('.bubble');
    if (!li) return;
    const line = sit.dialogue[Number(li.dataset.i)];
    if (playing) setPlaying(false);

    if (e.target.closest('.alt-toggle')) {
      const box = li.querySelector('.alt-list');
      box.hidden = !box.hidden;
      return;
    }
    const alt = e.target.closest('.alt-say');
    if (alt) return say(alt.dataset.text, line.role);
    if (e.target.closest('.say')) {
      li.classList.add('playing');
      await say(line.en, line.role);
      li.classList.remove('playing');
    }
  });

  el.querySelector('#zh-toggle').addEventListener('change', (e) => {
    store.setSetting('showZh', e.target.checked);
    list.classList.toggle('hide-zh', !e.target.checked);
  });
}

/* =========================================================
 * 分頁：跟讀
 * ========================================================= */

const shadowIndex = {}; // 記住每個情境練到第幾句

function viewShadow(el, ctx) {
  const { sit } = ctx;
  const lines = sit.dialogue;
  let i = Math.min(shadowIndex[sit.unit] || 0, lines.length - 1);
  let v = 0;             // 目前練第幾種說法
  let status = 'idle';   // idle | listening | retry | error | result
  let result = null;
  let message = '';

  const variants = () => variantsOf(lines[i]);
  const target = () => variants()[v];

  function render() {
    shadowIndex[sit.unit] = i;
    const line = lines[i];
    const r = roleOf(line);
    const best = store.getBest(line._key);
    const words = status === 'result' ? result.words : tokenize(target()).map((w) => ({ display: w.display, ok: null }));

    el.innerHTML = `
      ${speech.sttSupported ? helpHtml() : supportNotice()}

      <div class="dots">
        ${lines.map((l, k) => `<button class="dot ${k === i ? 'cur' : ''} ${(store.getBest(l._key) || 0) >= 70 ? 'done' : ''}" data-k="${k}" aria-label="第 ${k + 1} 句"></button>`).join('')}
      </div>

      <section class="card shadow-card">
        <div class="shadow-head">
          <span class="count">第 ${i + 1} / ${lines.length} 句 ${sitBadge(ctx, line)}</span>
          <span class="who-tag ${line.role}">${r.emoji} ${esc(r.name)}</span>
        </div>
        <p class="sentence" id="sentence">
          ${words.map((w) => `<span class="w ${w.ok === null ? '' : w.ok ? 'ok' : 'bad'}">${esc(w.display)}</span>`).join(' ')}
        </p>
        <p class="sentence-zh">${esc(line.zh)}</p>

        ${variants().length > 1 ? `
          <div class="variants">
            <p class="variants-title">💬 同一句話，可以這樣說（點一下換著練）：</p>
            ${variants().map((t, k) => `<button class="variant ${k === v ? 'on' : ''}" data-v="${k}">${esc(t)}</button>`).join('')}
          </div>` : ''}

        ${best != null ? `<p class="best">這句最高分：${best} 分</p>` : ''}

        <div class="btn-col">
          <button class="btn secondary big" id="demo">🔊 聽示範</button>
          ${speech.sttSupported
            ? `<button class="btn primary big ${status === 'listening' ? 'rec' : ''}" id="rec">${
                status === 'listening' ? '⏹ 錄音中（按我提早結束）' : status === 'result' ? '🎤 再唸一次' : '🎤 錄音跟讀'}</button>`
            : `<button class="btn primary big" id="self">✔ 我已跟著唸完</button>`}
        </div>

        <div id="status">${statusHtml()}</div>
      </section>

      <div class="row nav">
        <button class="btn ghost" id="prev" ${i === 0 ? 'disabled' : ''}>← 上一句</button>
        <button class="btn ghost" id="next" ${i === lines.length - 1 ? 'disabled' : ''}>下一句 →</button>
      </div>
      ${i === lines.length - 1 ? nextStep(ctx) : ''}`;

    bind();
  }

  function statusHtml() {
    if (status === 'listening') return listeningHtml();
    if (status === 'retry') return retryHtml(message);
    if (status === 'error') return errorHtml(message);
    if (status !== 'result') return '';
    const fb = feedback(result.score);
    return `
      <div class="result ${fb.level}">
        <div class="score-circle"><b>${result.score}</b><small>分</small></div>
        <div>
          <p class="fb">${fb.text}</p>
          ${result.usedAlt ? '<p class="fb-alt">你用了另一種說法，也完全正確！</p>' : ''}
          <p class="heard">你說的是：「${esc(result.spoken)}」</p>
        </div>
      </div>`;
  }

  // 錄音：邊講邊把唸對的字變綠，講完自動評分
  async function record() {
    status = 'listening';
    render();
    const idx = i;
    try {
      const alts = await speech.listen({
        onInterim: (text) => {
          if (idx !== i) return;
          const live = scoreSentence(target(), text);
          el.querySelectorAll('#sentence .w').forEach((span, k) => span.classList.toggle('ok', !!live.words[k]?.ok));
          const liveEl = el.querySelector('#live');
          if (liveEl) liveEl.textContent = `聽到：${text}`;
        },
      });
      if (idx !== i) return;
      // 每種說法都比對，用分數最高的那個（說哪一種都算對）
      let best = null;
      variants().forEach((t, k) => {
        const r = bestOf(t, alts);
        if (!best || r.score > best.score) best = { ...r, v: k };
      });
      result = { ...best, usedAlt: best.v !== v };
      v = best.v;
      store.markShadowed(lines[i]._key, best.score);
      status = 'result';
    } catch (err) {
      if (idx !== i || err.code === 'aborted') return;
      status = ['timeout', 'no-speech'].includes(err.code) ? 'retry' : 'error';
      message = err.message;
    }
    render();
  }

  function go(k) {
    speech.abortListening();
    speech.stopSpeaking();
    i = k;
    v = 0;
    status = 'idle';
    render();
  }

  function bind() {
    bindHelp(el);
    el.querySelector('#demo').addEventListener('click', () => say(target(), lines[i].role));
    el.querySelector('#prev').addEventListener('click', () => go(i - 1));
    el.querySelector('#next').addEventListener('click', () => go(i + 1));
    el.querySelectorAll('.dot').forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.k))));
    el.querySelectorAll('.variant').forEach((b) =>
      b.addEventListener('click', () => {
        speech.abortListening();
        v = Number(b.dataset.v);
        status = 'idle';
        render();
        say(target(), lines[i].role);
      })
    );
    el.querySelector('#rec')?.addEventListener('click', () => (status === 'listening' ? speech.stopListening() : record()));
    el.querySelector('[data-retry]')?.addEventListener('click', record);
    // 不支援語音辨識時：自己按「唸完了」也算一次練習
    el.querySelector('#self')?.addEventListener('click', () => {
      store.markShadowed(lines[i]._key, 0);
      if (i < lines.length - 1) go(i + 1);
    });
  }

  render();
}

/* =========================================================
 * 分頁：句型卡
 * ========================================================= */

function viewPattern(el, ctx) {
  const { sit } = ctx;
  const BLANK = '＿＿＿';
  // 把句型中的 {} 換成指定內容（HTML 版，填入的字會上色）
  const fillHtml = (tpl, word, cls) => {
    const html = esc(tpl).replace('{}', `<span class="${cls}">${esc(word)}</span>`);
    return tpl.startsWith('{}') && cls === 'filled' ? html.replace(`>${esc(word)}<`, `>${esc(cap(word))}<`) : html;
  };
  const fillText = (tpl, word) => cap(tpl.replace('{}', word));

  el.innerHTML = `
    <p class="tip">點下面的單字，組成完整的句子，然後跟著唸出來！每個句型也有其他說法。</p>
    ${sit.patterns.map((p, pi) => `
      <section class="card pattern" data-p="${pi}">
        ${sitBadge(ctx, p)}
        <h3 class="pattern-tpl">${fillHtml(p.template, BLANK, 'blank')}</h3>
        <p class="pattern-zh">${fillHtml(p.zh, BLANK, 'blank')}</p>
        ${p.alts?.length ? `<p class="pattern-alts">💬 也可以說：${p.alts.map((a) => fillHtml(a, BLANK, 'blank')).join('／')}</p>` : ''}
        <p class="pattern-tip">💡 ${esc(p.tip)}</p>
        <div class="chips">
          ${p.options.map((o, oi) => `<button class="chip" data-o="${oi}"><span>${esc(o.en)}</span><small>${esc(o.zh)}</small></button>`).join('')}
        </div>
        <div class="built" hidden></div>
      </section>`).join('')}
    ${nextStep(ctx)}`;

  el.querySelectorAll('.pattern').forEach((card) => {
    const p = sit.patterns[Number(card.dataset.p)];
    const built = card.querySelector('.built');

    card.querySelectorAll('.chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const o = p.options[Number(chip.dataset.o)];
        card.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
        const sentences = [p.template, ...(p.alts || [])].map((t) => fillText(t, o.en));
        built.hidden = false;
        built.innerHTML = `
          <button class="say-built" data-text="${esc(sentences[0])}">
            <span class="en">${fillHtml(p.template, o.en, 'filled')}</span>
            <span class="zh">${fillHtml(p.zh, o.zh, 'filled')}</span>
            <span class="spk">🔊 再聽一次</span>
          </button>
          ${sentences.length > 1 ? `
            <p class="also">💬 也可以說：</p>
            ${sentences.slice(1).map((t) => `<button class="alt-say" data-text="${esc(t)}">🔊 ${esc(t)}</button>`).join('')}` : ''}`;
        built.querySelectorAll('[data-text]').forEach((b) => b.addEventListener('click', () => say(b.dataset.text, 'customer')));
        say(sentences[0], 'customer');
        store.markPattern(p._key);
      })
    );
  });
}

/* =========================================================
 * 分頁：聽懂對方（選中文意思）
 * ========================================================= */

function viewQuiz(el, ctx) {
  const qs = ctx.sit.questions;
  let i = 0;
  let firstTryCorrect = 0;

  function render(autoplay = false) {
    if (i >= qs.length) return renderDone();
    const q = qs[i];
    const variants = variantsOf(q);
    let v = 0;
    let wrong = false;
    const choices = shuffle(q.choices.map((text, k) => ({ text, correct: k === q.answer })));
    const role = roleOf({ ...q, role: 'staff' });

    el.innerHTML = `
      <p class="tip">聽聽看${esc(role.name)}說什麼，選出正確的中文意思。</p>
      <section class="card quiz">
        <div class="shadow-head">
          <span class="count">第 ${i + 1} / ${qs.length} 題 ${sitBadge(ctx, q)}</span>
          <span class="who-tag staff">${role.emoji} ${esc(role.name)}說</span>
        </div>
        <button class="btn primary huge" id="play">🔊 播放</button>
        <div class="row center">
          <button class="link" id="reveal">👀 看英文</button>
          ${variants.length > 1 ? '<button class="link" id="other">🔁 換一種問法</button>' : ''}
        </div>
        <p class="quiz-en" id="quiz-en" hidden></p>

        <div class="choices">
          ${choices.map((c, k) => `<button class="choice" data-k="${k}">${esc(c.text)}</button>`).join('')}
        </div>
        <p class="quiz-msg" id="msg" aria-live="polite"></p>
        <div id="answer"></div>
      </section>`;

    const enEl = el.querySelector('#quiz-en');
    const play = () => say(variants[v], 'staff');
    enEl.textContent = variants[v];
    el.querySelector('#play').addEventListener('click', play);
    el.querySelector('#reveal').addEventListener('click', (e) => {
      enEl.hidden = false;
      e.target.remove();
    });
    el.querySelector('#other')?.addEventListener('click', () => {
      v = (v + 1) % variants.length;
      enEl.textContent = variants[v];
      play();
    });

    el.querySelectorAll('.choice').forEach((btn) =>
      btn.addEventListener('click', () => {
        const c = choices[Number(btn.dataset.k)];
        const msg = el.querySelector('#msg');
        if (!c.correct) {
          wrong = true;
          btn.classList.add('wrong');
          btn.disabled = true;
          msg.textContent = '不對喔，再聽一次！';
          msg.className = 'quiz-msg bad';
          play();
          return;
        }
        if (!wrong) firstTryCorrect++;
        store.markQuiz(q._key);
        btn.classList.add('right');
        el.querySelectorAll('.choice').forEach((b) => (b.disabled = true));
        enEl.hidden = false;
        el.querySelector('#reveal')?.remove();
        msg.textContent = '✅ 答對了！';
        msg.className = 'quiz-msg good';
        showAnswer(q, variants);
      })
    );

    if (autoplay) play();
  }

  function showAnswer(q, variants) {
    const box = el.querySelector('#answer');
    box.innerHTML = `
      ${variants.length > 1 ? `
        <div class="replies">
          <h4>👂 對方也可能這樣問：</h4>
          ${variants.map((t) => `<button class="alt-say" data-text="${esc(t)}" data-role="staff">🔊 ${esc(t)}</button>`).join('')}
        </div>` : ''}
      ${repliesHtml(q)}
      <button class="btn primary big block" id="next">${i < qs.length - 1 ? '下一題 →' : '看結果'}</button>`;
    bindSayButtons(box);
    box.querySelector('#next').addEventListener('click', () => { i++; render(true); window.scrollTo(0, 0); });
  }

  function renderDone() {
    el.innerHTML = `
      <section class="card done">
        <div class="done-emoji">🏆</div>
        <h2>全部完成！</h2>
        <p>一次就答對 <b>${firstTryCorrect}</b> / ${qs.length} 題</p>
        <button class="btn primary big block" id="again">再練一次</button>
      </section>
      ${nextStep(ctx)}`;
    el.querySelector('#again').addEventListener('click', () => { i = 0; firstTryCorrect = 0; render(); });
  }

  render();
}

// 「你可以這樣回答」區塊（聽懂、實戰共用）
function repliesHtml(q) {
  return `
    <div class="replies">
      <h4>🙋 你可以這樣回答：</h4>
      ${q.replies.map((r) => `
        <div class="reply-group">
          <button class="reply" data-text="${esc(r.en)}">
            <span class="en">${esc(r.en)}</span>
            <span class="zh">${esc(r.zh)}</span>
            <span class="spk">🔊</span>
          </button>
          ${r.alts?.length ? `<p class="also">也可以說：${r.alts.map((a) => `<button class="alt-say inline" data-text="${esc(a)}">🔊 ${esc(a)}</button>`).join('')}</p>` : ''}
        </div>`).join('')}
    </div>`;
}

function bindSayButtons(box) {
  box.querySelectorAll('[data-text]').forEach((b) =>
    b.addEventListener('click', () => say(b.dataset.text, b.dataset.role || 'customer'))
  );
}

/* =========================================================
 * 分頁：實戰問答（對方問，你用英文回答）
 * ========================================================= */

function viewRoleplay(el, ctx) {
  const qs = ctx.sit.questions;
  let i = 0;
  let passed = 0;

  function render(autoplay = false) {
    if (i >= qs.length) return renderDone();
    const q = qs[i];
    const variants = variantsOf(q);
    const asked = variants[Math.floor(Math.random() * variants.length)]; // 每次隨機用一種問法
    const role = roleOf({ ...q, role: 'staff' });
    // 所有可以接受的回答（含其他說法）
    const answers = q.replies.flatMap((r) => variantsOf(r).map((en) => ({ en, zh: r.zh })));
    let status = 'idle';
    let message = '';
    let result = null;

    function draw() {
      el.innerHTML = `
        ${i === 0 && speech.sttSupported ? helpHtml() : ''}
        <p class="tip">${esc(role.name)}會問你一句話，<b>用英文回答</b>！說得通就過關，不用一字不差。</p>
        <section class="card quiz">
          <div class="shadow-head">
            <span class="count">第 ${i + 1} / ${qs.length} 題 ${sitBadge(ctx, q)}</span>
            <span class="who-tag staff">${role.emoji} ${esc(role.name)}</span>
          </div>
          <button class="btn secondary huge" id="play">🔊 聽${esc(role.name)}說</button>
          <div class="row center"><button class="link" id="reveal">👀 看英文和中文</button></div>
          <div class="asked" id="asked" hidden>
            <p class="quiz-en">${esc(asked)}</p>
            <p class="muted">${esc(q.choices[q.answer])}</p>
          </div>

          ${speech.sttSupported
            ? `<button class="btn primary huge ${status === 'listening' ? 'rec' : ''}" id="rec">${
                status === 'listening' ? '⏹ 錄音中（按我提早結束）' : status === 'result' ? '🎤 再回答一次' : '🎤 換你回答'}</button>`
            : `${supportNotice()}<button class="btn primary big block" id="self">✔ 我說完了，看答案</button>`}

          <div id="status">${statusHtml()}</div>
          <div id="hint">${showReplies() ? repliesHtml(q) : ''}</div>
          ${showReplies() ? '' : '<button class="link" id="show-hint">💡 不知道怎麼說？給我提示</button>'}
          <button class="btn ghost block" id="next">${i < qs.length - 1 ? (result?.pass ? '下一題 →' : '跳過，下一題 →') : '看結果'}</button>
        </section>`;
      bindDraw();
    }

    // 按了提示、或回答過之後，顯示可以怎麼回答
    const showReplies = () => status === 'hint' || status === 'result';

    function statusHtml() {
      if (status === 'listening') return listeningHtml();
      if (status === 'retry') return retryHtml(message);
      if (status === 'error') return errorHtml(message);
      if (status !== 'result') return '';
      if (result.pass) {
        return `
          <div class="result great">
            <div class="score-circle"><b>${result.score}</b><small>分</small></div>
            <div>
              <p class="fb">✅ 很棒！${esc(role.name)}聽得懂你！</p>
              <p class="matched">${result.words.map((w) => `<span class="w ${w.ok ? 'ok' : 'bad'}">${esc(w.display)}</span>`).join(' ')}</p>
              <p class="heard">你說的是：「${esc(result.spoken)}」</p>
            </div>
          </div>`;
      }
      return `
        <div class="result ok">
          <div class="score-circle"><b>${result.score}</b><small>分</small></div>
          <div>
            <p class="fb">🤔 差一點！看看下面可以怎麼回答，再試一次。</p>
            <p class="heard">你說的是：「${esc(result.spoken)}」</p>
          </div>
        </div>`;
    }

    async function record() {
      status = 'listening';
      draw();
      const idx = i;
      try {
        const alts = await speech.listen({
          onInterim: (text) => {
            const live = el.querySelector('#live');
            if (live) live.textContent = `聽到：${text}`;
          },
        });
        if (idx !== i) return;
        // 跟每一種可接受的回答比對，取最高分
        let best = null;
        for (const a of answers) {
          const r = bestOf(a.en, alts);
          if (!best || r.score > best.score) best = r;
        }
        result = { ...best, pass: best.score >= PASS_SCORE };
        if (result.pass) {
          store.markRoleplay(q._key);
          passed++;
        }
        status = 'result';
      } catch (err) {
        if (idx !== i || err.code === 'aborted') return;
        status = ['timeout', 'no-speech'].includes(err.code) ? 'retry' : 'error';
        message = err.message;
      }
      draw();
    }

    function bindDraw() {
      bindHelp(el);
      const play = () => say(asked, 'staff');
      el.querySelector('#play').addEventListener('click', play);
      el.querySelector('#reveal').addEventListener('click', (e) => {
        el.querySelector('#asked').hidden = false;
        e.target.remove();
      });
      el.querySelector('#rec')?.addEventListener('click', () => (status === 'listening' ? speech.stopListening() : record()));
      el.querySelector('[data-retry]')?.addEventListener('click', record);
      el.querySelector('#show-hint')?.addEventListener('click', () => { status = 'hint'; draw(); });
      el.querySelector('#self')?.addEventListener('click', () => { status = 'hint'; draw(); });
      el.querySelector('#next').addEventListener('click', () => {
        speech.abortListening();
        i++;
        render(true);
        window.scrollTo(0, 0);
      });
      bindSayButtons(el.querySelector('#hint'));
      // 從上一題按「下一題」進來時，自動播放問題
      if (autoplay) { autoplay = false; play(); }
    }

    draw();
  }

  function renderDone() {
    el.innerHTML = `
      <section class="card done">
        <div class="done-emoji">🎉</div>
        <h2>實戰完成！</h2>
        <p>成功回答 <b>${passed}</b> / ${qs.length} 題</p>
        <button class="btn primary big block" id="again">再練一次</button>
      </section>
      ${nextStep(ctx)}`;
    el.querySelector('#again').addEventListener('click', () => { i = 0; passed = 0; render(); });
  }

  render();
}

/* =========================================================
 * 聲音設定：自己選「我」和「對方」用哪個語音
 * ========================================================= */

const SAMPLE = { customer: "Hi! Can I have a coke, please?", staff: 'Sure. Anything else?' };

function applyVoicePrefs() {
  speech.setVoicePrefs({ customer: store.getSetting('voiceMe') || '', staff: store.getSetting('voiceOther') || '' });
}

function renderSettings() {
  const voices = speech.listVoices();
  const tag = (g) => (g === 'male' ? '<span class="g male">👨 男聲</span>' : g === 'female' ? '<span class="g female">👩 女聲</span>' : '<span class="g">？</span>');
  // 依男聲、女聲、不確定排序
  const order = { male: 0, female: 1, '': 2 };
  const sorted = [...voices].sort((a, b) => order[a.gender] - order[b.gender] || a.name.localeCompare(b.name));
  const hasMale = voices.some((v) => v.gender === 'male');

  const section = (role, setting, title) => {
    const cur = store.getSetting(setting) || '';
    const auto = speech.pickVoice(role);
    const autoName = auto.voice ? auto.voice.name + (auto.pitch < 1 ? '（調低音高）' : '') : '裝置預設';
    return `
      <section class="card voice-sec" data-role="${role}" data-setting="${setting}">
        <h2>${title}</h2>
        <p class="muted">點「▶」試聽，選好按圓圈。</p>
        <div class="voice-list">
          <label class="voice-row">
            <input type="radio" name="${setting}" value="" ${cur ? '' : 'checked'}>
            <span class="voice-name">自動選擇<small>目前：${esc(autoName)}</small></span>
            <button class="play-voice" data-id="" aria-label="試聽">▶</button>
          </label>
          ${sorted.map((v) => `
            <label class="voice-row">
              <input type="radio" name="${setting}" value="${esc(v.id)}" ${cur === v.id ? 'checked' : ''}>
              <span class="voice-name">${esc(v.name)}<small>${esc(v.lang)} ${tag(v.gender)}</small></span>
              <button class="play-voice" data-id="${esc(v.id)}" aria-label="試聽">▶</button>
            </label>`).join('')}
        </div>
      </section>`;
  };

  app.innerHTML = `
    <header class="topbar">
      <a class="back" href="#/" aria-label="回首頁">‹</a>
      <h1>🔊 聲音設定</h1>
    </header>
    <main class="page">
      ${!voices.length ? '<div class="notice warn"><p>正在載入語音…如果一直沒出現，請重新整理頁面。</p></div>' : ''}
      ${voices.length && !hasMale ? `
        <div class="notice warn">
          <p>⚠️ 你的手機沒有提供可以辨認的英文男聲（或語音名稱看不出男女），自動模式會把聲音調低來模擬男聲。</p>
          <p>可以試聽下面每個語音，或先到手機下載男聲：</p>
          <p><b>iPhone</b>：設定 → 輔助使用 → 朗讀內容 → 聲音 → 英文 → 下載「Aaron」</p>
          <p><b>Android</b>：設定 → 搜尋「文字轉語音」→ Google 語音引擎的齒輪 → 安裝語音資料 → 英文（美國）→ 選男聲。<br>Android 的 Chrome 有時只讓網頁用「預設語音」，可以把預設改成男聲。</p>
        </div>` : ''}
      ${section('customer', 'voiceMe', '🙋 「我」的聲音')}
      ${section('staff', 'voiceOther', '🧑‍💼 對方（店員等）的聲音')}
      <p class="muted">共找到 ${voices.length} 個英文語音。</p>
    </main>`;

  app.querySelectorAll('.voice-sec').forEach((sec) => {
    const role = sec.dataset.role;
    const setting = sec.dataset.setting;
    sec.querySelectorAll('input[type=radio]').forEach((r) =>
      r.addEventListener('change', () => {
        store.setSetting(setting, r.value);
        applyVoicePrefs();
        speech.stopSpeaking();
        speech.speak(SAMPLE[role], { role, voiceId: r.value || undefined });
      })
    );
    sec.querySelectorAll('.play-voice').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.preventDefault(); // 試聽不要順便選取
        speech.stopSpeaking();
        speech.speak(SAMPLE[role], { role, voiceId: b.dataset.id || undefined });
      })
    );
  });
}

// 語音清單晚到時，如果正在聲音設定頁就重畫
speech.onVoicesChanged(() => {
  if (location.hash.startsWith('#/settings')) renderSettings();
});

/* ---------------- 啟動 ---------------- */

applyVoicePrefs();
router();

// 註冊 Service Worker（離線使用）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
  });
}
