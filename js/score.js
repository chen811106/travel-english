/* =========================================================
 * score.js — 比對「標準句子」和「使用者唸的內容」，逐字判斷對錯並給分
 *
 * 作法：
 * 1. 兩邊都轉小寫、去標點，縮寫展開（I'd → i would），數字轉英文（2 → two）
 * 2. 用 LCS（最長共同子序列）找出依序唸對的字
 * 3. 分數 = 唸對的字數 / 標準句字數 × 100
 * ========================================================= */

// 常見縮寫展開（語音辨識有時給縮寫、有時給完整寫法）
const CONTRACTIONS = {
  "i'd": 'i would', "i'm": 'i am', "i'll": 'i will', "i've": 'i have',
  "you're": 'you are', "you'd": 'you would', "it's": 'it is', "that's": 'that is',
  "what's": 'what is', "where's": 'where is', "here's": 'here is', "there's": 'there is',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'can not',
  "cannot": 'can not', "isn't": 'is not', "aren't": 'are not', "won't": 'will not',
  "let's": 'let us', "we'd": 'we would', "we're": 'we are', "they're": 'they are',
};

// 同義寫法統一（值可以是多個字）
const ALIASES = { okay: ['ok'], hey: ['hi'], zero: ['oh'], wifi: ['wi', 'fi'], aircon: ['air', 'conditioner'] };

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth'];

// 數字轉英文字：0–99 照一般唸法；三位數（例如房號 502）一個一個唸，0 唸 oh
function numberToWords(str) {
  const n = Number(str);
  if (str.length === 3) return str.split('').map((d) => (d === '0' ? 'oh' : ONES[d])).join(' ');
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  return str;
}

/** 把一個字轉成標準化的字串陣列（一個字可能展開成多個） */
function normalizeWord(raw) {
  let w = raw.toLowerCase().replace(/[’‘`]/g, "'");
  // 有連字號的字拆開處理：twenty-five → twenty five、Wi-Fi → wi fi
  if (/[a-z0-9]-[a-z0-9]/.test(w)) return w.split('-').flatMap(normalizeWord);
  const suffix = [];
  if (/^\$\d/.test(w)) suffix.push('dollars'); // $12 → twelve dollars
  if (/\d%/.test(w)) suffix.push('percent');   // 10% → ten percent
  w = w.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''); // 去頭尾標點
  if (!w) return [];
  if (CONTRACTIONS[w]) return CONTRACTIONS[w].split(' ');
  if (ALIASES[w]) return ALIASES[w];
  const ord = w.match(/^(\d+)(st|nd|rd|th)$/); // 5th → fifth
  if (ord && ORDINALS[Number(ord[1])]) return [ORDINALS[Number(ord[1])]];
  if (/^\d+$/.test(w)) return [...numberToWords(w).split(' '), ...suffix];
  w = w.replace(/'s$/, '').replace(/'$/, ''); // kids' / kid's 都當作 kid
  return [w];
}

/** 把句子拆成「顯示用的字」，每個字附帶標準化結果 */
export function tokenize(sentence) {
  return sentence
    .split(/\s+/)
    .filter(Boolean)
    .map((display) => ({ display, norm: normalizeWord(display) }));
}

/** 把辨識結果轉成標準化字串陣列 */
function normalizeSpoken(text) {
  return text.split(/\s+/).flatMap(normalizeWord);
}

/** LCS：回傳 target 中哪些位置有被依序配對到 */
function lcsMatch(target, spoken) {
  const n = target.length, m = spoken.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = target[i] === spoken[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array(n).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (target[i] === spoken[j]) {
      matched[i] = true;
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return matched;
}

/**
 * 評分
 * @param {string} target 標準句子
 * @param {string} spoken 使用者唸的（辨識結果）
 * @returns {{score:number, words:{display:string, ok:boolean}[]}}
 */
export function scoreSentence(target, spoken) {
  const words = tokenize(target);
  // 攤平成標準化字串，同時記住每個字串屬於哪個顯示字
  const flat = [];
  const owner = [];
  words.forEach((w, wi) => w.norm.forEach((t) => { flat.push(t); owner.push(wi); }));

  const matched = lcsMatch(flat, normalizeSpoken(spoken));

  // 一個顯示字的所有部分都對，才算對（例如 I'd = i + would）
  const okCount = new Array(words.length).fill(0);
  matched.forEach((ok, k) => { if (ok) okCount[owner[k]]++; });
  const result = words.map((w, wi) => ({ display: w.display, ok: w.norm.length > 0 && okCount[wi] === w.norm.length }));

  const total = flat.length || 1;
  const score = Math.round((matched.filter(Boolean).length / total) * 100);
  return { score, words: result };
}

/** 從多個辨識候選中挑分數最高的 */
export function bestOf(target, alternatives) {
  let best = { score: -1, words: [], spoken: '' };
  for (const alt of alternatives) {
    const r = scoreSentence(target, alt);
    if (r.score > best.score) best = { ...r, spoken: alt };
  }
  return best;
}

/** 依分數給中文鼓勵 */
export function feedback(score) {
  if (score >= 90) return { text: '太棒了！發音很清楚 🎉', level: 'great' };
  if (score >= 70) return { text: '很好！再練一次會更順 👍', level: 'good' };
  if (score >= 40) return { text: '不錯喔！紅色的字再多聽幾次 💪', level: 'ok' };
  return { text: '慢慢來，先按「聽示範」再跟著唸 🙂', level: 'low' };
}
