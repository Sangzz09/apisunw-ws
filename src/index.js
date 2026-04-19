const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

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

// --- TOKEN HIỆN TẠI (fallback nếu chưa login được) ---
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
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(ACCOUNT.loginUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: ACCOUNT.username,
                password: ACCOUNT.password,
            })
        });

        const data = await response.json();
        const newToken =
            data.token ||
            data.accessToken ||
            data.access_token ||
            data.jwt ||
            data.data?.token ||
            data.data?.accessToken;

        if (newToken) {
            currentToken = newToken;
            tokenExpiry = parseTokenExpiry(newToken);
            console.log(`✅ Token mới OK! Hết hạn: ${new Date(tokenExpiry).toLocaleString('vi-VN')}`);
            connectWebSocket(); // reconnect với token mới
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
        if (timeLeft < 15 * 60 * 1000) {
            await refreshToken();
        }
    };

    checkAndRefresh(); // check ngay khi khởi động
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
};

// ============================================================
// --- GLOBAL STATE ---
// ============================================================
let rikResults = [];
let currentSessionId = null;

let apiResponseData = {
    "Phien": null,
    "Xuc_xac_1": null,
    "Xuc_xac_2": null,
    "Xuc_xac_3": null,
    "Tong": null,
    "Ket_qua": "",
    "Du_doan": "đang tính...",
    "Do_tin_cay": "50%",
    "Pattern": "đang thu thập...",
    "id": "@tiendataox"
};

// ============================================================
// --- UTILITIES ---
// ============================================================
function generatePatternDescription(patternName, nextPrediction) {
    const predLabel = nextPrediction === 'T' ? 'Tài' : 'Xỉu';
    const descriptions = {
        '1-1':          `Cầu 1-1 – luân phiên đều → tiếp ${predLabel}`,
        'bệt':          `Cầu bệt – liên tiếp cùng loại → tiếp ${predLabel}`,
        '2-2':          `Cầu đôi 2-2 → tiếp ${predLabel}`,
        '3-3':          `Cầu ba 3-3 → tiếp ${predLabel}`,
        'zigzag':       `Cầu zigzag – đảo chiều liên tục → tiếp ${predLabel}`,
        'double_zigzag': `Cầu zigzag đôi → tiếp ${predLabel}`,
        'wave_2':       `Cầu sóng đôi → tiếp ${predLabel}`,
        'wave_3':       `Cầu sóng ba → tiếp ${predLabel}`,
        'mixed_1':      `Cầu hỗn hợp → tiếp ${predLabel}`,
        'spiral_1':     `Cầu xoắn ốc → tiếp ${predLabel}`,
        'alternate_1':  `Cầu xen kẽ → tiếp ${predLabel}`,
        'repeat_1':     `Cầu bệt đôi → tiếp ${predLabel}`,
        'fibonacci_4':  `Cầu Fibonacci → tiếp ${predLabel}`,
    };
    return descriptions[patternName] || `Cầu ${patternName} → tiếp ${predLabel}`;
}

function parseRecord(obj) {
    const total = Number(obj.total) || 0;
    return {
        session: Number(obj.session) || 0,
        dice: Array.isArray(obj.dice) ? obj.dice : [],
        total,
        tx: total >= 11 ? 'T' : 'X'
    };
}

// ============================================================
// --- THUẬT TOÁN AI ---
// ============================================================
function algo1_ultraPatternRecognition(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 30) return null;

    const fullPattern = tx.join('').toLowerCase();
    let patternMatches = { t: 0, x: 0 };
    let totalWeight = 0;

    Object.entries(PATTERN_DATABASE).forEach(([patternName, patternList]) => {
        patternList.forEach(pattern => {
            if (pattern.length > 8) return;
            for (let i = 0; i <= fullPattern.length - pattern.length - 1; i++) {
                if (fullPattern.substr(i, pattern.length) === pattern) {
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

function algo3_deepTrendAnalysis(history) {
    if (history.length < 25) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const trends = { t: 0, x: 0 };

    [5, 10, 15, 20].forEach(period => {
        if (tx.length >= period) {
            const recent = tx.slice(-period);
            const tCount = recent.filter(c => c === 'T').length;
            const xCount = period - tCount;
            if (tCount > xCount) trends.t++;
            else if (xCount > tCount) trends.x++;
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

function algo6_patternFusionAI(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 35) return null;

    const combined = { t: 0, x: 0 };
    [
        { length: 3, weight: 0.3 },
        { length: 5, weight: 0.5 },
        { length: 7, weight: 0.7 }
    ].forEach(({ length, weight }) => {
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

// --- Helper ---
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

// ============================================================
// --- ALGORITHMS LIST ---
// ============================================================
const ALGORITHMS = [
    { id: 'ultra_pattern',  fn: algo1_ultraPatternRecognition, name: 'Ultra Pattern AI' },
    { id: 'quantum_ai',     fn: algo2_quantumAdaptiveAI,       name: 'Quantum Adaptive AI' },
    { id: 'deep_trend',     fn: algo3_deepTrendAnalysis,        name: 'Deep Trend AI' },
    { id: 'smart_bridge',   fn: algo4_smartBridgeDetection,     name: 'Smart Bridge AI' },
    { id: 'volatility',     fn: algo5_volatilityPrediction,     name: 'Volatility AI' },
    { id: 'pattern_fusion', fn: algo6_patternFusionAI,          name: 'Pattern Fusion AI' },
    { id: 'realtime_ai',    fn: algo7_realtimeAdaptiveAI,       name: 'Real-time Adaptive AI' },
];

// ============================================================
// --- AI CORE ---
// ============================================================
class AdvancedAI {
    constructor() {
        this.history = [];
        this.weights = {};
        this.performance = {};
        this.lastPreds = {};
        ALGORITHMS.forEach(a => {
            this.weights[a.id] = 1.0;
            this.performance[a.id] = { correct: 0, total: 0, recent: [], streak: 0, name: a.name };
            this.lastPreds[a.id] = null;
        });
    }

    addResult(record) {
        const parsed = parseRecord(record);
        if (this.history.length >= 15) this._updatePerformance(parsed.tx);
        this.history.push(parsed);
        if (this.history.length > 500) this.history = this.history.slice(-400);
        return parsed;
    }

    _updatePerformance(actualTx) {
        ALGORITHMS.forEach(a => {
            const perf = this.performance[a.id];
            const pred = this.lastPreds[a.id];
            if (!pred) return;
            const correct = pred === actualTx;
            perf.correct += correct ? 1 : 0;
            perf.total++;
            perf.streak = correct ? perf.streak + 1 : 0;
            perf.recent.push(correct ? 1 : 0);
            if (perf.recent.length > 10) perf.recent.shift();
            if (perf.total >= 15) {
                const acc = perf.correct / perf.total;
                const recAcc = perf.recent.reduce((a, b) => a + b) / perf.recent.length;
                let w = Math.max(0.1, Math.min(2.0, (acc * 0.6 + recAcc * 0.3 + perf.streak * 0.03) * 1.8));
                this.weights[a.id] = this.weights[a.id] * 0.8 + w * 0.2;
            }
        });
        ALGORITHMS.forEach(a => { this.lastPreds[a.id] = null; });
    }

    predict() {
        if (this.history.length < 15) {
            return { prediction: 'Tài', rawPrediction: 'T', confidence: 0.5, algorithms: 0 };
        }

        const preds = [];
        ALGORITHMS.forEach(a => {
            try {
                const p = a.fn(this.history);
                if (p === 'T' || p === 'X') {
                    preds.push({ id: a.id, prediction: p, weight: this.weights[a.id] });
                    this.lastPreds[a.id] = p;
                }
            } catch (e) { /* bỏ qua */ }
        });

        if (preds.length === 0) {
            return { prediction: 'Tài', rawPrediction: 'T', confidence: 0.5, algorithms: 0 };
        }

        const votes = { T: 0, X: 0 };
        preds.forEach(p => { votes[p.prediction] += p.weight; });
        const totalW = votes.T + votes.X;

        let final = votes.T >= votes.X ? 'T' : 'X';
        const consensus = preds.filter(p => p.prediction === final).length / preds.length;
        const confidence = Math.max(0.5, Math.min(0.98,
            (Math.max(votes.T, votes.X) / totalW) * 0.7 + consensus * 0.3
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
                    if (str.substr(i, pattern.length) === pattern) count++;
                }
                if (count > maxCount) { maxCount = count; best = name; }
            });
        });
        return { discovered: best };
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

    console.log(`\n🔌 Đang kết nối WebSocket với token: ...${currentToken.slice(-20)}`);

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
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(msg));
                }
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

            // Token bị từ chối
            if (payload.code === 401 || payload.error === 'token_expired' ||
                (typeof payload.msg === 'string' && payload.msg.toLowerCase().includes('token'))) {
                console.log("⚠️  Token bị từ chối, đang refresh...");
                refreshToken();
                return;
            }

            // Nhận session ID mới
            if (cmd === 1008 && sid) {
                currentSessionId = sid;
            }

            // Nhận kết quả xúc xắc
            if (cmd === 1003 && gBB) {
                if (!d1 || !d2 || !d3) return;
                const total = d1 + d2 + d3;
                const session = currentSessionId;

                const record = { session, dice: [d1, d2, d3], total };
                ai.addResult(record);

                rikResults.unshift(record);
                if (rikResults.length > 100) rikResults.pop();
                currentSessionId = null;

                const prediction = ai.predict();
                const pattern = ai.getPattern();
                const patternDesc = pattern.discovered
                    ? generatePatternDescription(pattern.discovered, prediction.rawPrediction)
                    : `AI đang phân tích → tiếp ${prediction.prediction}`;

                apiResponseData = {
                    "Phien": session,
                    "Xuc_xac_1": d1,
                    "Xuc_xac_2": d2,
                    "Xuc_xac_3": d3,
                    "Tong": total,
                    "Ket_qua": total >= 11 ? "Tài" : "Xỉu",
                    "Phien_du_doan": session ? session + 1 : null,
                    "Du_doan": prediction.prediction,
                    "Do_tin_cay": `${(prediction.confidence * 100).toFixed(0)}%`,
                    "Pattern": patternDesc,
                    "Thuat_toan": `${prediction.algorithms}/${ALGORITHMS.length}`,
                    "id": "@tiendataox"
                };

                console.log(`\n==============================================`);
                console.log(`📥 PHIÊN ${session}: ${total >= 11 ? 'Tài' : 'Xỉu'} (${total})`);
                console.log(`🔮 DỰ ĐOÁN ${session ? session + 1 : '?'}: **${prediction.prediction.toUpperCase()}**`);
                console.log(`🎯 CONFIDENCE: ${(prediction.confidence * 100).toFixed(0)}%`);
                console.log(`🤖 ALGORITHMS: ${prediction.algorithms}/${ALGORITHMS.length}`);
                console.log(`📌 PATTERN: ${patternDesc}`);
            }

            // Nhận lịch sử
            if (payload.htr && Array.isArray(payload.htr)) {
                const history = payload.htr.map(i => ({
                    session: i.sid,
                    dice: [i.d1, i.d2, i.d3],
                    total: i.d1 + i.d2 + i.d3,
                })).filter(i => i.dice.every(d => d > 0));

                ai.loadHistory(history);
                rikResults = history.slice(-50).sort((a, b) => b.session - a.session);

                const prediction = ai.predict();
                console.log(`\n✅ AI sẵn sàng | Confidence: ${(prediction.confidence * 100).toFixed(0)}%`);
            }

        } catch (e) {
            console.error('[❌] Lỗi parse message:', e.message);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[🔌] WebSocket closed. Code: ${code}, Reason: ${reason?.toString()}`);
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
app.get('/api/ditmemaysun', (req, res) => {
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
        ai_version: "10.0 - Combined Ultra AI",
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

app.get('/', (req, res) => {
    res.json(apiResponseData);
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
    console.log(`====================================`);

    startTokenWatcher();
    connectWebSocket();
});
