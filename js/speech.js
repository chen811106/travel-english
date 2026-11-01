/* =========================================================
 * speech.js — 語音播放（speechSynthesis）與語音辨識（SpeechRecognition）
 * ========================================================= */

/* ---------------- 語音播放 TTS ---------------- */

const synth = window.speechSynthesis;
export const ttsSupported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

export const RATE_NORMAL = 0.95;
export const RATE_SLOW = 0.6;

let voices = [];
function loadVoices() {
  if (!ttsSupported) return;
  voices = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
}
if (ttsSupported) {
  loadVoices();
  // 很多瀏覽器的語音清單是非同步載入的
  synth.addEventListener?.('voiceschanged', loadVoices);
}

// 瀏覽器不會告訴我們語音是男是女，只能用各平台常見的語音名稱猜
// （iPhone／Mac、Android、Windows、Chrome 內建）；猜不準時使用者可以在「聲音設定」自己選
const MALE = /\b(male|man|david|guy|mark|james|christopher|eric|roger|steffan|ryan|brian|andrew|alex|aaron|fred|ralph|albert|junior|daniel|arthur|gordon|oliver|tom|rishi|lee|evan|nathan|reed|rocko|grandpa|eddy)\b|en-us-x-(iol|iom|tpd)/i;
const FEMALE = /\b(female|woman|samantha|aria|jenny|zira|susan|hazel|libby|sonia|emma|ava|allison|karen|moira|tessa|fiona|victoria|kate|kathy|serena|nicky|joelle|zoe|catherine|martha|shelley|sandy|flo|grandma)\b|google us english|en-us-x-(sfg|tpc|tpf|iob|iog)/i;
// iPhone 的趣味／機器人語音，盡量不要選
const NOVELTY = /\b(fred|ralph|albert|junior|kathy|bad news|good news|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ|princess)\b/i;

const label = (v) => v.name + ' ' + v.voiceURI;
const isMale = (v) => MALE.test(label(v)) && !/female/i.test(v.name);
const isFemale = (v) => FEMALE.test(label(v));

// 每個語音的唯一代號（Android 上 voiceURI 可能重複，所以加上名稱和語言）
const voiceId = (v) => `${v.voiceURI}|${v.name}|${v.lang}`;

// 使用者在「聲音設定」選的語音（空字串＝自動）
let prefs = { customer: '', staff: '' };
export function setVoicePrefs(p) {
  prefs = { ...prefs, ...p };
}

/** 列出這台裝置的英文語音（給聲音設定頁用） */
export function listVoices() {
  if (!voices.length) loadVoices();
  return voices.map((v) => ({
    id: voiceId(v),
    name: v.name,
    lang: v.lang,
    gender: isMale(v) ? 'male' : isFemale(v) ? 'female' : '',
  }));
}

/** 語音清單載入完成時通知（有些瀏覽器要等一下才拿得到） */
export function onVoicesChanged(cb) {
  synth?.addEventListener?.('voiceschanged', () => { loadVoices(); cb(); });
}

/**
 * 依角色挑英文語音
 * - 使用者有選 → 用選的
 * - customer（我）：自動找男聲；找不到就把音高調低
 * - staff（對方）：自動找女聲，和「我」有明顯區別
 * @returns {{voice: SpeechSynthesisVoice|null, pitch: number}}
 */
export function pickVoice(role) {
  if (!voices.length) loadVoices();
  const chosen = prefs[role] && voices.find((v) => voiceId(v) === prefs[role]);
  if (chosen) return { voice: chosen, pitch: 1.0 };

  // 美式英文優先，其次其他英文；本機語音優先；趣味語音放最後
  const rank = (v) => (/en[-_]US/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0) - (NOVELTY.test(label(v)) ? 5 : 0);
  const best = (list) => [...list].sort((a, b) => rank(b) - rank(a))[0] || null;

  if (role === 'customer') {
    const male = best(voices.filter(isMale));
    if (male) return { voice: male, pitch: 1.0 };
    // 沒有男聲：用預設語音，把音高調低聽起來像男生
    return { voice: best(voices.filter((v) => !isFemale(v))) || best(voices), pitch: 0.6 };
  }
  const female = best(voices.filter(isFemale));
  if (female) return { voice: female, pitch: 1.0 };
  return { voice: best(voices.filter((v) => !isMale(v))) || best(voices), pitch: 1.1 };
}

let speakToken = 0; // 用來中斷「整段播放」
let lastSpeakEnd = 0; // 上一次語音播放結束的時間（錄音前要讓喇叭先停下來）

/**
 * 播放一句英文，回傳 Promise（播完才 resolve）
 * @param {string} text
 * @param {{slow?: boolean, role?: string, voiceId?: string}} opt  voiceId：指定語音（試聽用）
 */
export function speak(text, { slow = false, role = 'staff', voiceId: forceId } = {}) {
  return new Promise((resolve) => {
    if (!ttsSupported) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = slow ? RATE_SLOW : RATE_NORMAL;
    const forced = forceId && voices.find((v) => voiceId(v) === forceId);
    const { voice, pitch } = forced ? { voice: forced, pitch: 1.0 } : pickVoice(role);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.pitch = pitch;

    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lastSpeakEnd = Date.now();
      resolve(ok);
    };
    u.onend = () => done(true);
    u.onerror = () => done(false);
    // 保險：某些瀏覽器偶爾不觸發 onend
    const timer = setTimeout(() => done(true), 2000 + text.length * (slow ? 160 : 100));

    // 先停掉正在播的；Chrome 在 cancel 後立刻 speak 偶爾會沒聲音，所以稍等一下
    log('播放：' + text.slice(0, 24));
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(() => synth.speak(u), 80);
    } else {
      synth.speak(u);
    }
    synth.resume(); // 某些 Chrome 版本會卡在暫停狀態
  });
}

/**
 * 依序播放多句（例如整段對話）
 * @param {{en:string, role:string}[]} lines
 * @param {(i:number)=>void} onLine 每播一句前呼叫（用來高亮）
 * @returns {Promise<boolean>} 是否完整播完（被中斷回傳 false）
 */
export async function speakAll(lines, { slow = false, onLine } = {}) {
  const token = ++speakToken;
  for (let i = 0; i < lines.length; i++) {
    if (token !== speakToken) return false;
    onLine?.(i);
    await speak(lines[i].en, { slow, role: lines[i].role });
    if (token !== speakToken) return false;
    await new Promise((r) => setTimeout(r, 350)); // 句子間稍微停頓
  }
  return token === speakToken;
}

export function stopSpeaking() {
  speakToken++;
  if (ttsSupported) {
    if (synth.speaking || synth.pending) lastSpeakEnd = Date.now();
    synth.cancel();
  }
}

/* ---------------- 語音辨識 STT ---------------- */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;

/* ---------- 錄音紀錄（除錯用：失敗時畫面會顯示，方便截圖回報） ---------- */
const logs = [];
const logBase = Date.now();
function log(msg) {
  logs.push(`${((Date.now() - logBase) / 1000).toFixed(1)}s ${msg}`);
  if (logs.length > 40) logs.shift();
}
export const getLog = () => logs.join('\n');
export const micPermission = () => micState;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 建立帶有代碼的錯誤（app.js 用 code 判斷要不要顯示「再試一次」）
function speechError(code) {
  const messages = {
    timeout: '好像沒有聽到你的聲音。',
    'no-speech': '好像沒有聽到你的聲音。',
    'mic-not-started': '麥克風沒有成功啟動。',
    'audio-capture': '找不到麥克風，或麥克風正被其他 App 使用。',
    'not-allowed': '麥克風權限被拒絕了，請到瀏覽器設定允許使用麥克風。',
    'service-not-allowed': '這個瀏覽器不允許語音辨識，請換 Chrome 或 Safari 試試。',
    network: '語音辨識需要網路連線，請確認網路後再試。',
    unsupported: '你的瀏覽器不支援語音辨識。',
  };
  const err = new Error(messages[code] || `辨識失敗（${code}），請再試一次。`);
  err.code = code;
  return err;
}

/*
 * 手機上常見的錄音問題與對策：
 * 1. 剛播完示範語音就錄音 → 喇叭還沒切回麥克風，錄不到聲音。對策：先停播，等一下再開麥克風。
 * 2. iPhone Safari 每次 new 一個辨識器，常常只有第一次有效。對策：重複使用同一個辨識器。
 * 3. 上一次錄音還沒完全結束就開始下一次 → 衝突。對策：等上一次的 onend 再開始。
 * 4. 麥克風沒真的啟動（沒有 onstart/onaudiostart）→ 自動換一個新的辨識器重試一次。
 */
let rec = null;      // 重複使用的辨識器
let active = false;  // 是否有錄音正在進行（還沒收到 onend）
let ended = null;    // 等待目前這次錄音結束的 Promise
let sessionCount = 0;

// 麥克風權限狀態：還沒允許時，第一次錄音會跳出詢問視窗，不能太快判定「沒啟動」
let micState = 'unknown';
navigator.permissions?.query({ name: 'microphone' })
  .then((st) => {
    micState = st.state;
    st.onchange = () => (micState = st.state);
  })
  .catch(() => {});

/**
 * 開始聽使用者說話
 * - 說話的同時會一直呼叫 onInterim(目前聽到的文字)，用來即時把唸對的字變綠
 * - 講完停一下，瀏覽器會自動結束，不用按停止
 * - silenceMs 內完全沒聽到聲音 → 自動停止，回傳 code = 'timeout'（畫面會問要不要再試一次）
 * @returns {Promise<string[]>} 可能的辨識結果（最多 5 個）
 */
export async function listen(opts = {}) {
  if (!SR) throw speechError('unsupported');
  log('--- 按下錄音 ---');

  // 對策 1：示範語音還在播或剛播完，先停掉並等喇叭釋放
  const ttsBusy = ttsSupported && (synth.speaking || synth.pending || Date.now() - lastSpeakEnd < 500);
  stopSpeaking();

  // 對策 3：上一次錄音還沒結束 → 先中止並等它結束（最多 1 秒，不行就換新的辨識器）
  if (active) {
    log('上一次錄音還沒結束，先停止');
    try { rec.abort(); } catch {}
    await Promise.race([ended, sleep(1000)]);
    if (active) {
      log('上一次錄音卡住，換新的辨識器');
      rec = null;
      active = false;
    }
  }
  if (ttsBusy) {
    log('等示範語音停止');
    await sleep(450);
  }

  try {
    return await session(opts);
  } catch (err) {
    // 對策 4：麥克風沒有啟動 → 換新的辨識器自動重試一次
    if (err.code === 'mic-not-started') {
      log('麥克風沒啟動，自動重試');
      rec = null;
      active = false;
      await sleep(300);
      return await session(opts);
    }
    throw err;
  }
}

// 一次錄音
//
// iPhone Safari 的特性：常常不會邊講邊回傳文字、也不會自己結束，
// 要呼叫 stop()（結束並交出結果）才會給結果。所以：
// - 時間到用 stop()，不要用 abort()（abort 會把聽到的內容丟掉）
// - 有聽到文字後安靜 1.5 秒 → 主動 stop()，達成「講完自動結束」
let requestStop = null; // 目前這次錄音的「結束並交出結果」
function session({ onInterim, silenceMs = 8000, maxMs = 15000, quietMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const r = rec || (rec = new SR());
    r.lang = 'en-US';
    r.interimResults = true; // 邊講邊回傳結果（支援的瀏覽器）
    r.continuous = false;    // 講完一句就結束
    r.maxAlternatives = 5;

    const t0 = Date.now();
    const my = ++sessionCount;
    let started = false;
    let heard = false;
    let finalAlts = null;
    let interim = '';
    let settled = false;
    let stopping = false;
    let timedOut = false;
    let silenceTimer = null;
    let maxTimer = null;
    let quietTimer = null;
    let stopGuard = null;
    let markEnded;
    active = true;
    ended = new Promise((res) => (markEnded = res));

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      [startTimer, silenceTimer, maxTimer, quietTimer, stopGuard].forEach(clearTimeout);
      if (requestStop === stop) requestStop = null;
      fn(value);
    };

    // 用目前拿到的內容收尾
    const settleWithWhatWeHave = () => {
      if (finalAlts && finalAlts.some((t) => t.trim())) finish(resolve, finalAlts.filter((t) => t.trim()));
      else if (interim) finish(resolve, [interim]);
      else finish(reject, speechError(timedOut ? 'timeout' : 'no-speech'));
    };

    // 結束並交出結果；2 秒內瀏覽器沒回應就強制收尾
    function stop(why) {
      if (stopping || settled) return;
      stopping = true;
      log(why);
      try { r.stop(); } catch {}
      stopGuard = setTimeout(() => {
        log('stop 後沒有回應，強制結束');
        try { r.abort(); } catch {}
        settleWithWhatWeHave();
      }, 2000);
    }
    requestStop = stop;

    // 麥克風一直沒啟動 → 判定失敗（listen 會自動重試）
    // 已允許權限：等 3 秒；還沒允許：使用者可能正在看權限詢問視窗，等久一點
    const startWait = micState === 'granted' ? 3000 : 20000;
    const startTimer = setTimeout(() => {
      if (started || heard) return;
      log(`${startWait / 1000} 秒內麥克風沒有啟動`);
      finish(reject, speechError('mic-not-started'));
      try { r.abort(); } catch {}
    }, startWait);

    const onStarted = (what) => {
      log(what);
      if (started) return;
      started = true;
      // 一直沒有收到文字 → 請瀏覽器結束並交出結果（iPhone 可能要這時候才給）
      silenceTimer = setTimeout(() => {
        if (heard) return;
        timedOut = true;
        stop(`${silenceMs / 1000} 秒沒有收到文字，結束錄音並取得結果`);
      }, silenceMs);
      // 講太久 → 結束，用目前聽到的內容評分
      maxTimer = setTimeout(() => stop('錄音時間到，結束'), maxMs);
    };

    r.onstart = () => onStarted('onstart 錄音開始');
    r.onaudiostart = () => onStarted('麥克風開啟');
    r.onsoundstart = () => log('收到聲音');
    r.onspeechstart = () => log('偵測到說話');
    r.onspeechend = () => log('說話結束');
    r.onnomatch = () => log('聽不出是什麼字（nomatch）');
    r.onresult = (e) => {
      if (settled) return;
      heard = true;
      let text = '';
      let allFinal = true;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript + ' ';
        if (!e.results[i].isFinal) allFinal = false;
      }
      interim = text.trim();
      if (allFinal) {
        if (e.results.length === 1) {
          finalAlts = [];
          for (let k = 0; k < e.results[0].length; k++) finalAlts.push(e.results[0][k].transcript);
        } else {
          finalAlts = [interim];
        }
      }
      log(`${allFinal ? '結果' : '聽到'}：${interim.slice(0, 30)}`);
      onInterim?.(interim);
      // 有聽到內容後安靜一下 → 視為講完，主動結束
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => stop(`${quietMs / 1000} 秒沒有新內容，視為講完`), quietMs);
    };
    r.onerror = (e) => {
      log('錯誤：' + e.error);
      // 我們自己 stop/abort 造成的錯誤，用已經拿到的內容收尾
      if ((e.error === 'aborted' || e.error === 'no-speech') && (stopping || heard)) return settleWithWhatWeHave();
      finish(reject, speechError(e.error));
    };
    r.onend = () => {
      log(`onend（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
      if (my === sessionCount) active = false; // 舊的錄音晚到的結束事件不影響新的
      markEnded();
      if (!interim && !started && Date.now() - t0 < 1500) {
        return finish(reject, speechError('mic-not-started')); // 一開始就結束
      }
      settleWithWhatWeHave();
    };

    try {
      r.start();
      log('start()');
    } catch (err) {
      // 常見原因：上一次還沒結束（InvalidStateError）
      log('start() 失敗：' + err.name);
      active = false;
      markEnded();
      finish(reject, speechError('mic-not-started'));
    }
  });
}

// 手動停止錄音（會用目前聽到的內容評分）
export function stopListening() {
  if (requestStop) requestStop('按下「說完了」');
  else if (active && rec) {
    try { rec.stop(); } catch {}
  }
}

// 取消錄音（切換頁面、換句時用）
export function abortListening() {
  if (active && rec) {
    log('取消錄音');
    try { rec.abort(); } catch {}
  }
}
