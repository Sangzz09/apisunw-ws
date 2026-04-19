import WebSocket from 'ws';
import express from 'express';
import cors from 'cors';

// ============================================================
// --- CẤU HÌNH ---
// ============================================================
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

const WS_BASE_URL = "wss://websocket.azhkthg1.net/websocket?token=";
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://play.sun.win"
};
const RECONNECT_DELAY = 3000;
const PING_INTERVAL = 15000;

// --- TÀI KHOẢN ---
const ACCOUNT = {
    username: "Msangzz09",
    password: "sang09",
    loginUrl: "https://web.sunwin.ec/api/auth/login",
};

// --- TOKEN HIỆN TẠI ---
let currentToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
let tokenExpiry = null;
let isRefreshing = false;

// ============================================================
// --- TOKEN MANAGER ---
// ============================================================
function parseTokenExpiry(token) {
    try {
        const payload = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64').toString('utf8')
        );
        if (payload.exp) return payload.exp * 1000;
        if (payload.timestamp) return payload.timestamp + (2 * 60 * 60 * 1000);
        return Date.now() + (2 * 60 * 60 * 1000);
    } catch {
        return Date.now() + (2 * 60 * 60 * 1000);
    }
}

async function refreshToken() {
    if (isRefreshing) return currentToken;
    isRefreshing = true;
    console.log("\n🔄 Đang lấy token mới...");
    try {
        const response = await fetch(ACCOUNT.loginUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: ACCOUNT.username, password: ACCOUNT.password })
        });
        const data = await response.json();
        const newToken = data.token || data.accessToken || data.access_token || data.jwt || data.data?.token || data.data?.accessToken;
        if (newToken) {
            currentToken = newToken;
            tokenExpiry = parseTokenExpiry(newToken);
            console.log(`✅ Token mới OK! Hết hạn: ${new Date(tokenExpiry).toLocaleString('vi-VN')}`);
            connectWebSocket();
        } else {
            console.error("❌ Không lấy được token. Response:", JSON.stringify(data));
            setTimeout(refreshToken, 60 * 1000);
        }
    } catch (e) {
        console.error("❌ Lỗi refresh token:", e.message);
        setTimeout(refreshToken, 60 * 1000);
    } finally {
        isRefreshing = false;
    }
    return currentToken;
}

function startTokenWatcher() {
    tokenExpiry = parseTokenExpiry(currentToken);
    console.log(`🔑 Token hết hạn lúc: ${new Date(tokenExpiry).toLocaleString('vi-VN')}`);
    const checkAndRefresh = async () => {
        const timeLeft = tokenExpiry - Date.now();
        const minutesLeft = Math.floor(timeLeft / 60000);
        console.log(`⏱️  Token còn hạn: ${minutesLeft} phút`);
        if (timeLeft < 15 * 60 * 1000) await refreshToken();
    };
    checkAndRefresh();
    setInterval(checkAndRefresh, 5 * 60 * 1000);
}

// ============================================================
// --- PATTERN DATABASE ---
// ============================================================
const PATTERN_DATABASE = {
    '1-1': ['tx', 'xt'],
    'bệt': ['tt', 'xx'],
    '2-2': ['ttxx', 'xxtt'],
    '3-3': ['tttxxx', 'xxxttt'],
    '4-4': ['ttttxxxx', 'xxxxtttt'],
    '5-5': ['tttttxxxxx', 'xxxxxttttt'],
    '1-2-1': ['txxxt', 'xtttx'],
    '2-1-2': ['ttxtt', 'xxtxx'],
    '1-2-3': ['txxttt', 'xttxxx'],
    '3-2-3': ['tttxttt', 'xxxtxxx'],
    '4-2-4': ['ttttxxtttt', 'xxxxttxxxx'],
    '3-1-3': ['tttxttt', 'xxxtxxx'],
    '1-3-1': ['txtttx', 'xtxxxt'],
    '2-3-2': ['ttxxtt', 'xxttxx'],
    '3-4-3': ['tttxxxxttt', 'xxxttttxxx'],
    '4-3-4': ['ttttxxxtttt', 'xxxxtttxxxx'],
    'zigzag': ['txt', 'xtx'],
    'double_zigzag': ['txtxt', 'xtxtx'],
    'triple_zigzag': ['txtxtxt', 'xtxtxtx'],
    'quad_alternate': ['txtxtxtx', 'xtxtxtxt'],
    'wave_2': ['ttxx', 'xxtt'],
    'wave_3': ['tttxxx', 'xxxttt'],
    'wave_4': ['ttttxxxx', 'xxxxtttt'],
    'mixed_1': ['ttxtxx', 'xxtxtt'],
    'mixed_2': ['txxxttx', 'xtttxxt'],
    'mixed_3': ['tttxxtxx', 'xxxxttxx'],
    'spiral_1': ['txxxt', 'xtttx'],
    'spiral_2': ['ttxxxtt', 'xxtttxx'],
    'alternate_1': ['txtx', 'xtxt'],
    'alternate_2': ['txtxtx', 'xtxtxt'],
    'alternate_3': ['txtxtxtx', 'xtxtxtxt'],
    'repeat_1': ['tt', 'xx'],
    'repeat_2': ['tttt', 'xxxx'],
    'symmetry_2': ['ttxxtt', 'xxttxx'],
    'branch_1': ['ttxtx', 'xxtxt'],
    'fibonacci_4': ['txttx', 'xtxxt'],
    'break_3': ['ttttx', 'xxxxT'],
    'break_4': ['xxxxt', 'tttttx'],
    'galaxy': ['ttxttx', 'xxtxxt'],
    'mirror': ['tttxxx', 'xxxttt'],
    'omega': ['txtttxt', 'xtxxxxt'],
    'sigma': ['ttxtxtx', 'xxtxtxt'],
    'delta': ['tttxtxx', 'xxxxttt'],
    'alpha': ['ttttxt', 'xxxxxt'],
    'beta':  ['txtttt', 'xTxxxx'],
};

// ============================================================
// --- GLOBAL STATE ---
// ============================================================
let rikResults = [];
let currentSessionId = null;

let apiResponseData = {
    "phien": null,
    "xuc_xac": [],
    "phien_hien_tai": null,
    "du_doan": "đang tính...",
    "do_tin_cay": "50%",
    "loai_cau": "đang thu thập...",
    "pattern": "",
    "dev": "@sewdangcap"
};

// ============================================================
// --- UTILITIES ---
// ============================================================
function parseRecord(obj) {
    const total = Number(obj.total) || 0;
    return {
        session: Number(obj.session) || 0,
        dice: Array.isArray(obj.dice) ? obj.dice : [],
        total,
        tx: total >= 11 ? 'T' : 'X'
    };
}

function calcVolatility(nums) {
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return Math.sqrt(nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length);
}

function calcRSI(txArr) {
    if (txArr.length < 14) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i < txArr.length; i++) {
        if (txArr[i] === 'T' && txArr[i-1] === 'X') gains++;
        else if (txArr[i] === 'X' && txArr[i-1] === 'T') losses++;
    }
    if (losses === 0) return 100;
    return 100 - (100 / (1 + gains / losses));
}

function calcMACD(totals) {
    if (totals.length < 26) return 0;
    const ema = (arr, p) => {
        const m = 2 / (p + 1);
        return arr.reduce((e, v) => v * m + e * (1 - m), arr[0]);
    };
    return ema(totals.slice(-12), 12) - ema(totals.slice(-26), 26);
}

function calcEMA(arr, period) {
    if (arr.length < period) return arr[arr.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < arr.length; i++) {
        ema = arr[i] * k + ema * (1 - k);
    }
    return ema;
}

function calcStdDev(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length);
}

function calcEntropy(txArr) {
    const n = txArr.length;
    const tCount = txArr.filter(t => t === 'T').length;
    const xCount = n - tCount;
    if (tCount === 0 || xCount === 0) return 0;
    const pt = tCount / n, px = xCount / n;
    return -(pt * Math.log2(pt) + px * Math.log2(px));
}

// ============================================================
// --- ALGORITHMS ---
// ============================================================

// Algo 1: Ultra Pattern Recognition
function algo1_ultraPatternRecognition(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 30) return null;
    const fullPattern = tx.join('').toLowerCase();
    let patternMatches = { t: 0, x: 0 };
    let totalWeight = 0;
    Object.entries(PATTERN_DATABASE).forEach(([, patternList]) => {
        patternList.forEach(pattern => {
            if (pattern.length > 8) return;
            for (let i = 0; i <= fullPattern.length - pattern.length - 1; i++) {
                if (fullPattern.substr(i, pattern.length) === pattern.toLowerCase()) {
                    const nextChar = fullPattern.charAt(i + pattern.length);
                    if (nextChar === 't' || nextChar === 'x') {
                        const weight = pattern.length / 8;
                        patternMatches[nextChar] += weight;
                        totalWeight += weight;
                    }
                }
            }
        });
    });
    if (totalWeight === 0) return null;
    const threshold = 0.65 + (Math.min(totalWeight, 50) / 100);
    if (patternMatches.t / totalWeight >= threshold) return 'T';
    if (patternMatches.x / totalWeight >= threshold) return 'X';
    return null;
}

// Algo 2: Quantum Adaptive AI
function algo2_quantumAdaptiveAI(history) {
    if (history.length < 40) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    let state = { t: 0.5, x: 0.5 };
    tx.slice(-20).forEach(t => {
        const w = 0.04;
        if (t === 'T') { state.t *= (1 + w); state.x *= (1 - w); }
        else { state.x *= (1 + w); state.t *= (1 - w); }
    });
    const recentAvg = totals.slice(-10).reduce((a, b) => a + b, 0) / 10;
    if (recentAvg > 11.2) { state.t *= 0.85; state.x *= 1.15; }
    else if (recentAvg < 9.8) { state.t *= 1.15; state.x *= 0.85; }
    const total = state.t + state.x;
    state.t /= total; state.x /= total;
    if (state.t > 0.68) return 'T';
    if (state.x > 0.68) return 'X';
    return null;
}

// Algo 3: Deep Trend Analysis
function algo3_deepTrendAnalysis(history) {
    if (history.length < 25) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const trends = { t: 0, x: 0 };
    [5, 10, 15, 20].forEach(period => {
        if (tx.length >= period) {
            const recent = tx.slice(-period);
            const tCount = recent.filter(c => c === 'T').length;
            if (tCount > period - tCount) trends.t++;
            else if (period - tCount > tCount) trends.x++;
        }
    });
    const totalAvg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const recentAvg = totals.slice(-8).reduce((a, b) => a + b, 0) / 8;
    if (recentAvg > totalAvg + 0.8) trends.t += 1.5;
    if (recentAvg < totalAvg - 0.8) trends.x += 1.5;
    if (trends.t > trends.x + 1.5) return 'T';
    if (trends.x > trends.t + 1.5) return 'X';
    return null;
}

// Algo 4: Smart Bridge Detection
function algo4_smartBridgeDetection(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 15) return null;
    const recent = tx.slice(-15);
    const last = recent[recent.length - 1];
    let runLength = 1;
    for (let i = recent.length - 2; i >= 0; i--) {
        if (recent[i] === last) runLength++;
        else break;
    }
    if (runLength >= 5) return last === 'T' ? 'X' : 'T';
    const pattern = recent.slice(-6).join('').toLowerCase();
    if (['tttxxx', 'xxxttt', 'ttxx', 'xxtt', 'txtxtx', 'xtxtxt'].includes(pattern)) {
        return last === 'T' ? 'X' : 'T';
    }
    if (runLength >= 2 && runLength <= 4) {
        const tCount = tx.filter(t => t === 'T').length;
        if (tCount > tx.length * 1.3 * 0.5) return 'T';
        if ((tx.length - tCount) > tx.length * 1.3 * 0.5) return 'X';
    }
    return null;
}

// Algo 5: Volatility Prediction
function algo5_volatilityPrediction(history) {
    if (history.length < 30) return null;
    const totals = history.map(h => h.total);
    const vol10 = calcVolatility(totals.slice(-10));
    const vol20 = calcVolatility(totals.slice(-20));
    if (vol10 > vol20 * 1.5) {
        const avg = totals.slice(-10).reduce((a, b) => a + b, 0) / 10;
        if (avg > 11.0) return 'X';
        if (avg < 10.0) return 'T';
    } else if (vol10 < vol20 * 0.7) {
        const recentTx = history.slice(-10).map(h => h.tx);
        const tCount = recentTx.filter(t => t === 'T').length;
        if (tCount > 7) return 'T';
        if (tCount < 3) return 'X';
    }
    return null;
}

// Algo 6: Pattern Fusion AI
function algo6_patternFusionAI(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 35) return null;
    const combined = { t: 0, x: 0 };
    [{ length: 3, weight: 0.3 }, { length: 5, weight: 0.5 }, { length: 7, weight: 0.7 }].forEach(({ length, weight }) => {
        if (tx.length < length + 1) return;
        const lastPat = tx.slice(-length).join('').toLowerCase();
        let match = { t: 0, x: 0 };
        for (let i = 0; i <= tx.length - length - 1; i++) {
            if (tx.slice(i, i + length).join('').toLowerCase() === lastPat) {
                match[tx[i + length].toLowerCase()]++;
            }
        }
        const total = match.t + match.x;
        if (total >= 2) {
            const conf = Math.max(match.t, match.x) / total;
            if (conf > 0.7) {
                const winner = match.t > match.x ? 't' : 'x';
                combined[winner] += conf * weight;
            }
        }
    });
    if (combined.t > combined.x * 1.3) return 'T';
    if (combined.x > combined.t * 1.3) return 'X';
    return null;
}

// Algo 7: Real-time Adaptive AI
function algo7_realtimeAdaptiveAI(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const rsi = calcRSI(tx.slice(-14));
    const macd = calcMACD(totals);
    const bias = tx.slice(-20).filter(t => t === 'T').length / 20;
    const momentum = totals[totals.length - 1] - totals[Math.max(0, totals.length - 10)];
    let tScore = 0, xScore = 0;
    if (rsi > 70) xScore += 1.5; else if (rsi < 30) tScore += 1.5;
    if (macd > 0.5) tScore += 1; else if (macd < -0.5) xScore += 1;
    if (bias > 0.6) tScore += 1.2; else if (bias < 0.4) xScore += 1.2;
    if (momentum > 0.3) tScore += 0.8; else if (momentum < -0.3) xScore += 0.8;
    if (tScore > xScore + 1.5) return 'T';
    if (xScore > tScore + 1.5) return 'X';
    return null;
}

// Algo 8: Markov Chain Predictor
function algo8_markovChain(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    const trans = { TT: 0, TX: 0, XT: 0, XX: 0 };
    for (let i = 0; i < tx.length - 1; i++) {
        trans[tx[i] + tx[i+1]]++;
    }
    const last = tx[tx.length - 1];
    if (last === 'T') {
        const total = trans.TT + trans.TX;
        if (total < 5) return null;
        if (trans.TT / total > 0.65) return 'T';
        if (trans.TX / total > 0.65) return 'X';
    } else {
        const total = trans.XT + trans.XX;
        if (total < 5) return null;
        if (trans.XT / total > 0.65) return 'T';
        if (trans.XX / total > 0.65) return 'X';
    }
    return null;
}

// Algo 9: Bollinger Band AI
function algo9_bollingerBand(history) {
    if (history.length < 20) return null;
    const totals = history.map(h => h.total);
    const recent = totals.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / 20;
    const std = calcStdDev(recent);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    const last = totals[totals.length - 1];
    if (last >= upper) return 'X';
    if (last <= lower) return 'T';
    const prev = totals[totals.length - 2];
    if (prev <= lower && last > lower) return 'T';
    if (prev >= upper && last < upper) return 'X';
    return null;
}

// Algo 10: Entropy Chaos AI
function algo10_entropyAI(history) {
    if (history.length < 40) return null;
    const tx = history.map(h => h.tx);
    const entropy10 = calcEntropy(tx.slice(-10));
    const entropy20 = calcEntropy(tx.slice(-20));
    const entropy40 = calcEntropy(tx.slice(-40));
    // Khi entropy thấp → cầu bệt → tiếp tục
    if (entropy10 < 0.7) {
        const last = tx[tx.length - 1];
        return last;
    }
    // Khi entropy giảm dần → xu hướng đang hình thành
    if (entropy10 < entropy20 && entropy20 < entropy40) {
        const recentTx = tx.slice(-10);
        const tCount = recentTx.filter(t => t === 'T').length;
        return tCount >= 6 ? 'T' : 'X';
    }
    // Khi entropy tăng → hỗn loạn → dùng momentum
    if (entropy10 > entropy20 * 1.1) {
        const totals = history.map(h => h.total);
        const avg5 = totals.slice(-5).reduce((a, b) => a + b, 0) / 5;
        return avg5 >= 10.5 ? 'T' : 'X';
    }
    return null;
}

// Algo 11: EMA Crossover
function algo11_emaCrossover(history) {
    if (history.length < 26) return null;
    const totals = history.map(h => h.total);
    const ema5 = calcEMA(totals, 5);
    const ema13 = calcEMA(totals, 13);
    const ema26 = calcEMA(totals, 26);
    const prevEma5 = calcEMA(totals.slice(0, -1), 5);
    const prevEma13 = calcEMA(totals.slice(0, -1), 13);
    // Golden cross / death cross
    if (prevEma5 < prevEma13 && ema5 > ema13) return 'T';
    if (prevEma5 > prevEma13 && ema5 < ema13) return 'X';
    if (ema5 > ema13 && ema13 > ema26) return 'T';
    if (ema5 < ema13 && ema13 < ema26) return 'X';
    return null;
}

// Algo 12: Streak Breaker Pro
function algo12_streakBreakerPro(history) {
    if (history.length < 10) return null;
    const tx = history.map(h => h.tx);
    const last = tx[tx.length - 1];
    let streak = 1;
    for (let i = tx.length - 2; i >= 0; i--) {
        if (tx[i] === last) streak++;
        else break;
    }
    // Chuỗi dài → khả năng break cao
    if (streak >= 6) return last === 'T' ? 'X' : 'T';
    if (streak >= 4) {
        const totals = history.map(h => h.total);
        const avg = totals.slice(-streak).reduce((a, b) => a + b, 0) / streak;
        if (last === 'T' && avg < 12.5) return 'X';
        if (last === 'X' && avg > 8.5) return 'T';
    }
    // Chuỗi ngắn → tiếp tục
    if (streak <= 2) {
        const prev2 = tx.slice(-4, -2).join('');
        if (prev2 === last + last) return last;
    }
    return null;
}

// Algo 13: Neural Sequence Predictor
function algo13_neuralSequence(history) {
    if (history.length < 50) return null;
    const tx = history.map(h => h.tx);
    const seqLen = 8;
    const lastSeq = tx.slice(-seqLen).join('');
    let votes = { T: 0, X: 0 };
    let count = 0;
    for (let i = 0; i <= tx.length - seqLen - 1; i++) {
        const seq = tx.slice(i, i + seqLen).join('');
        // Tính độ tương đồng
        let sim = 0;
        for (let j = 0; j < seqLen; j++) {
            if (seq[j] === lastSeq[j]) sim++;
        }
        const simRate = sim / seqLen;
        if (simRate >= 0.75) {
            const weight = simRate * simRate;
            votes[tx[i + seqLen]] += weight;
            count++;
        }
    }
    if (count < 3) return null;
    const total = votes.T + votes.X;
    if (votes.T / total > 0.65) return 'T';
    if (votes.X / total > 0.65) return 'X';
    return null;
}

// Algo 14: Regression Mean Reversion
function algo14_meanReversion(history) {
    if (history.length < 30) return null;
    const totals = history.map(h => h.total);
    const longMean = totals.slice(-30).reduce((a, b) => a + b, 0) / 30;
    const shortMean = totals.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const deviation = shortMean - longMean;
    const std = calcStdDev(totals.slice(-30));
    const zScore = deviation / (std || 1);
    // Z-score cao → revert về mean
    if (zScore > 1.5) return 'X';
    if (zScore < -1.5) return 'T';
    if (zScore > 0.8) return 'X';
    if (zScore < -0.8) return 'T';
    return null;
}

// Algo 15: Fibonacci Sequence AI
function algo15_fibonacciAI(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    const fibPoints = [1, 2, 3, 5, 8, 13, 21];
    let tScore = 0, xScore = 0;
    fibPoints.forEach(n => {
        if (tx.length > n) {
            const val = tx[tx.length - n];
            const weight = 1 / n;
            if (val === 'T') tScore += weight;
            else xScore += weight;
        }
    });
    const total = tScore + xScore;
    if (tScore / total > 0.65) return 'T';
    if (xScore / total > 0.65) return 'X';
    return null;
}

// Algo 16: Dice Sum Distribution AI
function algo16_diceSumDistribution(history) {
    if (history.length < 50) return null;
    const totals = history.map(h => h.total);
    const dist = {};
    totals.forEach(t => { dist[t] = (dist[t] || 0) + 1; });
    // Tính xác suất lý thuyết của từng tổng
    const theoretical = {
        3: 1, 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27,
        11: 27, 12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3, 18: 1
    };
    const totalTheo = 216;
    const n = totals.length;
    // Tính tổng nào bị under/over-represented
    let taiExpected = 0, xiuExpected = 0;
    let taiActual = 0, xiuActual = 0;
    for (let sum = 3; sum <= 18; sum++) {
        const expected = (theoretical[sum] || 0) / totalTheo * n;
        const actual = dist[sum] || 0;
        const deficit = expected - actual;
        if (sum >= 11) { taiExpected += expected; taiActual += actual; }
        else { xiuExpected += expected; xiuActual += actual; }
        // Nếu tổng nào đó thiếu nhiều → có thể sắp xuất hiện
    }
    // So sánh tỷ lệ thực tế với lý thuyết
    const taiRatio = taiActual / (taiExpected || 1);
    const xiuRatio = xiuActual / (xiuExpected || 1);
    if (xiuRatio < 0.88 && taiRatio > 1.05) return 'X';
    if (taiRatio < 0.88 && xiuRatio > 1.05) return 'T';
    return null;
}

// Algo 17: Hot/Cold Number AI
function algo17_hotColdAI(history) {
    if (history.length < 40) return null;
    const recent = history.slice(-20).map(h => h.total);
    const old = history.slice(-40, -20).map(h => h.total);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgOld = old.reduce((a, b) => a + b, 0) / old.length;
    // Hot: xu hướng gần đây rõ ràng
    if (avgRecent > avgOld + 0.5 && avgRecent > 11) return 'T';
    if (avgRecent < avgOld - 0.5 && avgRecent < 10) return 'X';
    // Cold: cân bằng đang thay đổi
    const tCountRecent = recent.filter(t => t >= 11).length;
    const tCountOld = old.filter(t => t >= 11).length;
    if (tCountRecent > 14 && tCountOld < 10) return 'T';
    if (tCountRecent < 6 && tCountOld > 12) return 'X';
    return null;
}

// Algo 18: Momentum Oscillator
function algo18_momentumOscillator(history) {
    if (history.length < 20) return null;
    const totals = history.map(h => h.total);
    const tx = history.map(h => h.tx);
    const n = totals.length;
    // Rate of change
    const roc5 = (totals[n-1] - totals[n-6]) / totals[n-6] * 100;
    const roc10 = (totals[n-1] - totals[n-11]) / totals[n-11] * 100;
    // Stochastic
    const high10 = Math.max(...totals.slice(-10));
    const low10 = Math.min(...totals.slice(-10));
    const stoch = (totals[n-1] - low10) / (high10 - low10 || 1) * 100;
    // Williams %R
    const willR = (high10 - totals[n-1]) / (high10 - low10 || 1) * -100;
    let tScore = 0, xScore = 0;
    if (roc5 > 2) tScore += 1; else if (roc5 < -2) xScore += 1;
    if (roc10 > 3) tScore += 0.8; else if (roc10 < -3) xScore += 0.8;
    if (stoch > 80) xScore += 1.2; else if (stoch < 20) tScore += 1.2;
    if (willR > -20) xScore += 1; else if (willR < -80) tScore += 1;
    if (tScore > xScore + 1.2) return 'T';
    if (xScore > tScore + 1.2) return 'X';
    return null;
}

// Algo 19: Cycle Detection AI
function algo19_cycleDetection(history) {
    if (history.length < 40) return null;
    const tx = history.map(h => h.tx);
    const str = tx.join('');
    // Tìm chu kỳ lặp lại
    for (let cycleLen = 2; cycleLen <= 10; cycleLen++) {
        const lastCycle = str.slice(-cycleLen);
        let matches = 0;
        for (let i = 0; i <= str.length - cycleLen * 2; i++) {
            if (str.slice(i, i + cycleLen) === lastCycle) matches++;
        }
        if (matches >= 3) {
            // Dự đoán phần tử tiếp theo dựa trên chu kỳ
            const nextInCycle = tx[tx.length - cycleLen + 1 % cycleLen];
            if (nextInCycle) return nextInCycle;
        }
    }
    return null;
}

// Algo 20: Adaptive Bayesian AI
function algo20_bayesianAI(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    // Prior: 50/50
    let priorT = 0.5, priorX = 0.5;
    // Update với evidence từ nhiều window size
    const windows = [5, 10, 15, 20];
    windows.forEach(w => {
        if (tx.length >= w) {
            const recent = tx.slice(-w);
            const tRate = recent.filter(t => t === 'T').length / w;
            const xRate = 1 - tRate;
            // Likelihood
            const likT = 0.5 + (tRate - 0.5) * 0.6;
            const likX = 0.5 + (xRate - 0.5) * 0.6;
            // Update prior
            const normFactor = priorT * likT + priorX * likX;
            priorT = (priorT * likT) / normFactor;
            priorX = (priorX * likX) / normFactor;
        }
    });
    if (priorT > 0.67) return 'T';
    if (priorX > 0.67) return 'X';
    return null;
}

// ============================================================
// --- ALGORITHMS LIST ---
// ============================================================
const ALGORITHMS = [
    { id: 'ultra_pattern',   fn: algo1_ultraPatternRecognition,  name: 'Ultra Pattern AI' },
    { id: 'quantum_ai',      fn: algo2_quantumAdaptiveAI,        name: 'Quantum Adaptive AI' },
    { id: 'deep_trend',      fn: algo3_deepTrendAnalysis,         name: 'Deep Trend AI' },
    { id: 'smart_bridge',    fn: algo4_smartBridgeDetection,      name: 'Smart Bridge AI' },
    { id: 'volatility',      fn: algo5_volatilityPrediction,      name: 'Volatility AI' },
    { id: 'pattern_fusion',  fn: algo6_patternFusionAI,           name: 'Pattern Fusion AI' },
    { id: 'realtime_ai',     fn: algo7_realtimeAdaptiveAI,        name: 'Real-time Adaptive AI' },
    { id: 'markov_chain',    fn: algo8_markovChain,               name: 'Markov Chain AI' },
    { id: 'bollinger',       fn: algo9_bollingerBand,             name: 'Bollinger Band AI' },
    { id: 'entropy',         fn: algo10_entropyAI,                name: 'Entropy Chaos AI' },
    { id: 'ema_cross',       fn: algo11_emaCrossover,             name: 'EMA Crossover AI' },
    { id: 'streak_breaker',  fn: algo12_streakBreakerPro,         name: 'Streak Breaker Pro' },
    { id: 'neural_seq',      fn: algo13_neuralSequence,           name: 'Neural Sequence AI' },
    { id: 'mean_revert',     fn: algo14_meanReversion,            name: 'Mean Reversion AI' },
    { id: 'fibonacci',       fn: algo15_fibonacciAI,              name: 'Fibonacci AI' },
    { id: 'dice_dist',       fn: algo16_diceSumDistribution,      name: 'Dice Distribution AI' },
    { id: 'hot_cold',        fn: algo17_hotColdAI,                name: 'Hot Cold AI' },
    { id: 'momentum',        fn: algo18_momentumOscillator,       name: 'Momentum Oscillator AI' },
    { id: 'cycle',           fn: algo19_cycleDetection,           name: 'Cycle Detection AI' },
    { id: 'bayesian',        fn: algo20_bayesianAI,               name: 'Bayesian AI' },
];

// ============================================================
// --- AI CORE ---
// ============================================================
class AdvancedAI {
    constructor() {
        this.history = [];
        this.weights = {};
        this.performance = {};
        // pendingPreds: dự đoán cho phiên KẾ TIẾP (chưa có kết quả)
        // khi kết quả phiên đó về → so sánh → cập nhật weight
        this.pendingPreds = {};
        ALGORITHMS.forEach(a => {
            this.weights[a.id] = 1.0;
            this.performance[a.id] = { correct: 0, total: 0, recent: [], streak: 0, name: a.name };
            this.pendingPreds[a.id] = null;
        });
    }

    // Gọi khi có kết quả phiên mới:
    // 1. Đánh giá pendingPreds (dự đoán của phiên này)
    // 2. Push kết quả vào history
    // 3. Chạy predict cho phiên tiếp theo → lưu vào pendingPreds
    addResult(record) {
        const parsed = parseRecord(record);

        // Bước 1: Cập nhật weight dựa trên pendingPreds vs kết quả thực
        if (this.history.length >= 15) {
            this._updatePerformance(parsed.tx);
        }

        // Bước 2: Lưu kết quả
        this.history.push(parsed);
        if (this.history.length > 500) this.history = this.history.slice(-400);

        // Bước 3: Chạy từng algo ngay sau khi có kết quả mới → lưu pending cho phiên sau
        ALGORITHMS.forEach(a => {
            try {
                const p = a.fn(this.history);
                this.pendingPreds[a.id] = (p === 'T' || p === 'X') ? p : null;
            } catch (_) {
                this.pendingPreds[a.id] = null;
            }
        });

        return parsed;
    }

    _updatePerformance(actualTx) {
        ALGORITHMS.forEach(a => {
            const perf = this.performance[a.id];
            const pred = this.pendingPreds[a.id];
            if (!pred) return; // algo không đưa ra dự đoán → bỏ qua

            const correct = pred === actualTx;
            perf.correct += correct ? 1 : 0;
            perf.total++;
            perf.streak = correct ? perf.streak + 1 : 0;
            perf.recent.push(correct ? 1 : 0);
            if (perf.recent.length > 15) perf.recent.shift();

            if (perf.total >= 10) {
                const acc = perf.correct / perf.total;
                const recAcc = perf.recent.reduce((a, b) => a + b, 0) / perf.recent.length;
                // Weight tăng khi chính xác cao, giảm khi sai liên tục
                const targetW = Math.max(0.05, Math.min(2.5,
                    acc * 0.5 + recAcc * 0.4 + Math.min(perf.streak, 5) * 0.04
                ));
                this.weights[a.id] = this.weights[a.id] * 0.75 + targetW * 0.25;
            }
        });
    }

    // predict() đọc pendingPreds hiện tại (đã được tính sau kết quả gần nhất)
    predict() {
        if (this.history.length < 15) {
            return { prediction: 'Tài', rawPrediction: 'T', confidence: 0.5, algorithms: 0 };
        }

        const preds = [];
        ALGORITHMS.forEach(a => {
            const p = this.pendingPreds[a.id];
            if (p === 'T' || p === 'X') {
                preds.push({ id: a.id, prediction: p, weight: this.weights[a.id] });
            }
        });

        if (preds.length === 0) {
            // Fallback: chạy lại tất cả algo không cache
            ALGORITHMS.forEach(a => {
                try {
                    const p = a.fn(this.history);
                    if (p === 'T' || p === 'X') {
                        preds.push({ id: a.id, prediction: p, weight: this.weights[a.id] });
                    }
                } catch (_) {}
            });
        }

        if (preds.length === 0) {
            return { prediction: 'Tài', rawPrediction: 'T', confidence: 0.5, algorithms: 0 };
        }

        const votes = { T: 0, X: 0 };
        preds.forEach(p => { votes[p.prediction] += p.weight; });
        const totalW = votes.T + votes.X;
        const final = votes.T > votes.X ? 'T' : 'X';
        const consensus = preds.filter(p => p.prediction === final).length / preds.length;

        // Confidence thực sự dựa trên chênh lệch vote + mức đồng thuận
        const voteRatio = Math.max(votes.T, votes.X) / totalW;
        const confidence = Math.max(0.51, Math.min(0.96,
            voteRatio * 0.65 + consensus * 0.35
        ));

        return {
            prediction: final === 'T' ? 'Tài' : 'Xỉu',
            rawPrediction: final,
            confidence,
            algorithms: preds.length
        };
    }

    loadHistory(arr) {
        this.history = arr.map(parseRecord).sort((a, b) => a.session - b.session);
        // Khởi tạo pendingPreds ngay sau khi load lịch sử
        ALGORITHMS.forEach(a => {
            try {
                const p = a.fn(this.history);
                this.pendingPreds[a.id] = (p === 'T' || p === 'X') ? p : null;
            } catch (_) {
                this.pendingPreds[a.id] = null;
            }
        });
        console.log(`📊 Đã tải ${this.history.length} lịch sử vào AI`);
    }

    getPattern() {
        if (this.history.length < 20) return { discovered: null };
        const tx = this.history.map(h => h.tx);
        const str = tx.slice(-30).join('').toLowerCase();
        let best = null, maxCount = 0;
        Object.entries(PATTERN_DATABASE).forEach(([name, patterns]) => {
            patterns.forEach(pattern => {
                let count = 0;
                for (let i = 0; i <= str.length - pattern.length; i++) {
                    if (str.substr(i, pattern.length) === pattern.toLowerCase()) count++;
                }
                if (count > maxCount) { maxCount = count; best = name; }
            });
        });
        return { discovered: best };
    }

    getPatternString(len = 20) {
        if (this.history.length === 0) return '';
        return this.history.slice(-len).map(h => h.tx).join('');
    }

    getStats() {
        const stats = {};
        ALGORITHMS.forEach(a => {
            const p = this.performance[a.id];
            if (p.total > 0) {
                stats[a.id] = {
                    name: p.name,
                    accuracy: (p.correct / p.total * 100).toFixed(1) + '%',
                    weight: this.weights[a.id].toFixed(2),
                    predictions: p.total
                };
            }
        });
        return stats;
    }
}

const ai = new AdvancedAI();

// ============================================================
// --- WEBSOCKET ---
// ============================================================
let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let isConnecting = false;

function getInitialMessages() {
    return [
        [
            1, "MiniGame", "GM_apivopnha", "WangLin",
            {
                "info": JSON.stringify({
                    ipAddress: "14.249.227.107",
                    wsToken: currentToken,
                    locale: "vi",
                    userId: "8838533e-de43-4b8d-9503-621f4050534e",
                    username: "GM_apivopnha",
                    timestamp: Date.now(),
                }),
                "signature": "45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"
            }
        ],
        [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
        [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
    ];
}

function connectWebSocket() {
    if (isConnecting) return;
    isConnecting = true;
    clearInterval(pingInterval);
    clearTimeout(reconnectTimeout);
    if (ws) {
        ws.removeAllListeners();
        try { ws.close(); } catch (_) {}
    }
    console.log(`\n🔌 Đang kết nối WebSocket...`);
    try {
        ws = new WebSocket(`${WS_BASE_URL}${currentToken}`, { headers: WS_HEADERS });
    } catch (e) {
        console.error("❌ Lỗi tạo WebSocket:", e.message);
        isConnecting = false;
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
        return;
    }

    ws.on('open', () => {
        console.log('✅ WebSocket connected.');
        isConnecting = false;
        const msgs = getInitialMessages();
        msgs.forEach((msg, i) => {
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
            }, i * 600);
        });
        pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) ws.ping();
        }, PING_INTERVAL);
    });

    ws.on('pong', () => console.log('[📶] Ping OK.'));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (!Array.isArray(data) || typeof data[1] !== 'object') return;
            const payload = data[1];
            const { cmd, sid, d1, d2, d3, gBB } = payload;

            if (payload.code === 401 || payload.error === 'token_expired' ||
                (typeof payload.msg === 'string' && payload.msg.toLowerCase().includes('token'))) {
                console.log("⚠️  Token bị từ chối, đang refresh...");
                refreshToken();
                return;
            }

            if (cmd === 1008 && sid) {
                currentSessionId = sid;
            }

            if (cmd === 1003 && gBB) {
                if (!d1 || !d2 || !d3) return;
                const total = d1 + d2 + d3;
                const session = currentSessionId;

                const record = { session, dice: [d1, d2, d3], total };
                const parsed = ai.addResult(record);

                rikResults.unshift(record);
                if (rikResults.length > 100) rikResults.pop();
                currentSessionId = null;

                const prediction = ai.predict();
                const pattern = ai.getPattern();
                const patternStr = ai.getPatternString(20);

                apiResponseData = {
                    "phien": String(session),
                    "xuc_xac": [d1, d2, d3],
                    "phien_hien_tai": session ? String(session + 1) : null,
                    "du_doan": prediction.prediction,
                    "do_tin_cay": `${(prediction.confidence * 100).toFixed(0)}%`,
                    "loai_cau": pattern.discovered || "Không rõ cầu",
                    "pattern": patternStr,
                    "dev": "@sewdangcap"
                };

                console.log(`\n==============================================`);
                console.log(`📥 PHIÊN ${session}: ${total >= 11 ? 'Tài' : 'Xỉu'} (${total}) [${d1}-${d2}-${d3}]`);
                console.log(`🔮 DỰ ĐOÁN ${session ? session + 1 : '?'}: **${prediction.prediction.toUpperCase()}**`);
                console.log(`🎯 CONFIDENCE: ${(prediction.confidence * 100).toFixed(0)}%`);
                console.log(`🤖 ALGORITHMS: ${prediction.algorithms}/${ALGORITHMS.length}`);
                console.log(`📌 CẦU: ${pattern.discovered || 'Không rõ'}`);
                console.log(`📊 PATTERN: ${patternStr}`);
            }

            if (payload.htr && Array.isArray(payload.htr)) {
                const history = payload.htr.map(i => ({
                    session: i.sid,
                    dice: [i.d1, i.d2, i.d3],
                    total: i.d1 + i.d2 + i.d3,
                })).filter(i => i.dice.every(d => d > 0));
                ai.loadHistory(history);
                rikResults = history.slice(-50).sort((a, b) => b.session - a.session);
                const prediction = ai.predict();
                console.log(`\n✅ AI sẵn sàng | ${ALGORITHMS.length} thuật toán | Confidence: ${(prediction.confidence * 100).toFixed(0)}%`);
            }

        } catch (e) {
            console.error('[❌] Lỗi parse message:', e.message);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[🔌] WebSocket closed. Code: ${code}`);
        isConnecting = false;
        clearInterval(pingInterval);
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });

    ws.on('error', (err) => {
        console.error('[❌] WebSocket error:', err.message);
        isConnecting = false;
        try { ws.close(); } catch (_) {}
    });
}

// ============================================================
// --- API ENDPOINTS ---
// ============================================================
app.get('/sunlon', (req, res) => {
    res.json(apiResponseData);
});

app.get('/', (req, res) => {
    res.json(apiResponseData);
});

app.get('/api/taixiu/history', (req, res) => {
    if (!rikResults.length) return res.json({ message: "chưa có dữ liệu" });
    res.json(rikResults.slice(0, 30).map(r => ({
        session: r.session,
        dice: r.dice,
        total: r.total,
        ket_qua: r.total >= 11 ? 'Tài' : 'Xỉu'
    })));
});

app.get('/api/taixiu/ai-stats', (req, res) => {
    const prediction = ai.predict();
    res.json({
        status: "online",
        ai_version: `${ALGORITHMS.length} Algorithms VIP`,
        current_prediction: prediction.prediction,
        confidence: `${(prediction.confidence * 100).toFixed(1)}%`,
        algorithms_active: prediction.algorithms,
        algorithm_stats: ai.getStats()
    });
});

app.get('/api/token-status', (req, res) => {
    const timeLeft = tokenExpiry ? tokenExpiry - Date.now() : 0;
    res.json({
        status: timeLeft > 0 ? "valid" : "expired",
        expires_at: tokenExpiry ? new Date(tokenExpiry).toLocaleString('vi-VN') : "unknown",
        minutes_remaining: Math.floor(timeLeft / 60000),
        username: ACCOUNT.username,
    });
});

// ============================================================
// --- KHỞI ĐỘNG ---
// ============================================================
app.listen(PORT, () => {
    console.log(`====================================`);
    console.log(`🚀 SUN AI Server - Port: ${PORT}`);
    console.log(`   Tài khoản : ${ACCOUNT.username}`);
    console.log(`   Thuật toán: ${ALGORITHMS.length} AI Algorithms`);
    console.log(`   Pattern DB: ${Object.keys(PATTERN_DATABASE).length} mẫu`);
    console.log(`   Auto Token : ✅ BẬT`);
    console.log(`   Endpoint  : /sunlon`);
    console.log(`====================================`);
    startTokenWatcher();
    connectWebSocket();
});
