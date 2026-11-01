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
      resolve(ok);
    };
    u.onend = () => done(true);
    u.onerror = () => done(false);
    // 保險：某些瀏覽器偶爾不觸發 onend
    const timer = setTimeout(() => done(true), 2000 + text.length * (slow ? 160 : 100));

    // 先停掉正在播的；Chrome 在 cancel 後立刻 speak 偶爾會沒聲音，所以稍等一下
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
  if (ttsSupported) synth.cancel();
}

/* ---------------- 語音辨識 STT ---------------- */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;

let current = null;

// 建立帶有代碼的錯誤（app.js 用 code 判斷要不要顯示「再試一次」）
function speechError(code) {
  const messages = {
    timeout: '好像沒有聽到你的聲音。',
    'no-speech': '好像沒有聽到你的聲音。',
    'audio-capture': '找不到麥克風，請確認手機或電腦有麥克風。',
    'not-allowed': '麥克風權限被拒絕了，請到瀏覽器設定允許使用麥克風。',
    'service-not-allowed': '這個瀏覽器不允許語音辨識，請換 Chrome 或 Safari 試試。',
    network: '語音辨識需要網路連線，請確認網路後再試。',
    unsupported: '你的瀏覽器不支援語音辨識。',
  };
  const err = new Error(messages[code] || '辨識失敗，請再試一次。');
  err.code = code;
  return err;
}

/**
 * 開始聽使用者說話
 * - 說話的同時會一直呼叫 onInterim(目前聽到的文字)，用來即時把唸對的字變綠
 * - 講完停一下，瀏覽器會自動結束，不用按停止
 * - silenceMs 內完全沒聽到聲音 → 自動停止，回傳 code = 'timeout'（畫面會問要不要再試一次）
 * @returns {Promise<string[]>} 可能的辨識結果（最多 5 個）
 */
export function listen({ onInterim, silenceMs = 8000, maxMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(speechError('unsupported'));
    stopSpeaking();
    abortListening();

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true; // 邊講邊回傳結果
    rec.continuous = false;    // 講完一句就自動結束
    rec.maxAlternatives = 5;
    current = rec;

    let finalAlts = null;
    let interim = '';
    let heard = false;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(silenceTimer);
      clearTimeout(maxTimer);
      if (current === rec) current = null;
      fn(value);
    };

    // 太久沒聲音 → 停止並提示再試一次
    const silenceTimer = setTimeout(() => {
      if (heard) return;
      finish(reject, speechError('timeout')); // 先記錄是逾時，再停止（避免被 aborted 蓋掉）
      try { rec.abort(); } catch {}
    }, silenceMs);
    // 講太久 → 強制結束，用目前聽到的內容評分
    const maxTimer = setTimeout(() => {
      try { rec.stop(); } catch {}
    }, maxMs);

    rec.onresult = (e) => {
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
      onInterim?.(interim);
    };
    rec.onerror = (e) => finish(reject, speechError(e.error));
    rec.onend = () => {
      if (finalAlts) finish(resolve, finalAlts);
      else if (interim) finish(resolve, [interim]);
      else finish(reject, speechError('no-speech'));
    };

    try {
      rec.start();
    } catch {
      finish(reject, speechError('start'));
    }
  });
}

// 手動停止錄音（會用目前聽到的內容評分）
export function stopListening() {
  if (current) {
    try { current.stop(); } catch {}
  }
}

// 取消錄音（切換頁面時用）
export function abortListening() {
  if (current) {
    const rec = current;
    current = null;
    try { rec.abort(); } catch {}
  }
}
