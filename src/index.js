import fastify from "fastify";
import cors from "@fastify/cors";
import WebSocket from "ws";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=";

// --- CẤU HÌNH TÀI KHOẢN & TOKEN ---
const ACCOUNT = {
    username: "Msangzz09",       // <-- Tài khoản
    password: "sang09",   // <-- Mật khẩu
    loginUrl: "https://web.sunwin.ec/api/auth/login", // URL đăng nhập
};

let currentToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOnRydWUsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MjIxNjQwNjcyLCJhZmZJZCI6IlN1bndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsImVtYWlsIjoiIiwidGltZXN0YW1wIjoxNzc2NTMyMDU5MjUxLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0Ijp0cnVlLCJwaG9uZVZlcmlmaWVkIjp0cnVlLCJpcEFkZHJlc3MiOiIxNC4xODMuMTk0LjEzOSIsIm11dGUiOnRydWUsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJlbWFpbFZlcmlmaWVkIjpudWxsLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.ACM5cBsEU4776s7x1Ac8Ibn3xYh21G9KYNVAB64_bmA";
let tokenExpiry = null;
let isRefreshing = false;

// --- GLOBAL STATE ---
let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// --- TOKEN MANAGER ---
// ============================================================

function parseTokenExpiry(token) {
    try {
        const payload = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64').toString('utf8')
        );
        if (payload.exp) return payload.exp * 1000;
        if (payload.timestamp) return payload.timestamp + (6 * 60 * 60 * 1000);
        return Date.now() + (6 * 60 * 60 * 1000);
    } catch {
        return Date.now() + (6 * 60 * 60 * 1000);
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
            connectRikWebSocket();
        } else {
            console.error("❌ Không lấy được token. Response:", JSON.stringify(data));
        }
    } catch (e) {
        console.error("❌ Lỗi refresh token:", e.message);
    } finally {
        isRefreshing = false;
    }

    return currentToken;
}

function startTokenWatcher() {
    tokenExpiry = parseTokenExpiry(currentToken);
    console.log(`🔑 Token hết hạn lúc: ${new Date(tokenExpiry).toLocaleString('vi-VN')}`);

    setInterval(async () => {
        const timeLeft = tokenExpiry - Date.now();
        const minutesLeft = Math.floor(timeLeft / 60000);
        console.log(`⏱️  Token còn hạn: ${minutesLeft} phút`);
        if (timeLeft < 15 * 60 * 1000) {
            await refreshToken();
        }
    }, 5 * 60 * 1000);
}

// ============================================================
// --- PATTERN DATABASE ĐẦY ĐỦ ---
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
    '1-2-1-2': ['txxxtx', 'xtttxt'],
    '2-1-2-1': ['ttxttx', 'xxtxxt'],
    '1-1-2-2': ['txttxx', 'xtxxxt'],
    '2-2-1-1': ['ttxxtx', 'xxttxx'],
    '3-2-1': ['tttxtx', 'xxxtxt'],
    '1-2-2-1': ['txxxttx', 'xtttxxt'],
    'zigzag': ['txt', 'xtx'],
    'double_zigzag': ['txtxt', 'xtxtx'],
    'triple_zigzag': ['txtxtxt', 'xtxtxtx'],
    'quad_alternate': ['txtxtxtx', 'xtxtxtxt'],
    'penta_alternate': ['txtxtxtxtx', 'xtxtxtxtxt'],
    '1-1-1-2': ['txttx', 'xtxxt'],
    '2-1-1-1': ['ttxtx', 'xxtxt'],
    '1-2-2-2': ['txxxtt', 'xtttxx'],
    '2-2-2-1': ['ttxxttx', 'xxttxx'],
    '3-3-2': ['tttxxxtt', 'xxxttxx'],
    '2-3-3': ['ttxxttt', 'xxttxxx'],
    'fibonacci_1': ['t', 'x'],
    'fibonacci_2': ['tx', 'xt'],
    'fibonacci_3': ['txt', 'xtx'],
    'fibonacci_4': ['txttx', 'xtxxt'],
    'fibonacci_5': ['txttxttx', 'xtxtxxxt'],
    'triangle': ['txx', 'xtt'],
    'square': ['ttxx', 'xxtt'],
    'pentagon': ['tttxx', 'xxxtt'],
    'hexagon': ['ttttxx', 'xxxxxt'],
    'wave_2': ['ttxx', 'xxtt'],
    'wave_3': ['tttxxx', 'xxxttt'],
    'wave_4': ['ttttxxxx', 'xxxxtttt'],
    'wave_5': ['tttttxxxxx', 'xxxxxttttt'],
    'reverse_1': ['ttx', 'xxt'],
    'reverse_2': ['ttxx', 'xxtt'],
    'reverse_3': ['tttxxx', 'xxxttt'],
    'reverse_4': ['ttttxxxx', 'xxxxtttt'],
    'interlace_1': ['txtxt', 'xtxtx'],
    'interlace_2': ['ttxxtt', 'xxttxx'],
    'interlace_3': ['tttxxttt', 'xxxxtxxx'],
    'branch_1': ['ttxtx', 'xxtxt'],
    'branch_2': ['ttxxttx', 'xxttxx'],
    'branch_3': ['tttxxtttx', 'xxxxtxxxt'],
    'spiral_1': ['txxxt', 'xtttx'],
    'spiral_2': ['ttxxxtt', 'xxtttxx'],
    'spiral_3': ['tttxxxxttt', 'xxxttttxxx'],
    'arithmetic_1': ['tx', 'xt'],
    'arithmetic_2': ['txx', 'xtt'],
    'arithmetic_3': ['txxx', 'xttt'],
    'arithmetic_4': ['txxxx', 'xtttt'],
    'geometric_1': ['tx', 'xt'],
    'geometric_2': ['txx', 'xtt'],
    'geometric_3': ['txxx', 'xttt'],
    'geometric_4': ['txxxx', 'xtttt'],
    'mixed_1': ['ttxtxx', 'xxtxtt'],
    'mixed_2': ['txxxttx', 'xtttxxt'],
    'mixed_3': ['tttxxtxx', 'xxxxttxx'],
    'mixed_4': ['txttxtxt', 'xtxtxtxt'],
    'mixed_5': ['ttxxtxtt', 'xxtxtxxt'],
    'symmetry_1': ['txt', 'xtx'],
    'symmetry_2': ['ttxxtt', 'xxttxx'],
    'symmetry_3': ['tttxxxttt', 'xxxxttxxx'],
    'symmetry_4': ['ttttxxxxtttt', 'xxxxxtttxxxx'],
    'repeat_1': ['tt', 'xx'],
    'repeat_2': ['tttt', 'xxxx'],
    'repeat_3': ['tttttt', 'xxxxxx'],
    'repeat_4': ['tttttttt', 'xxxxxxxx'],
    'alternate_1': ['txtx', 'xtxt'],
    'alternate_2': ['txtxtx', 'xtxtxt'],
    'alternate_3': ['txtxtxtx', 'xtxtxtxt'],
    'alternate_4': ['txtxtxtxtx', 'xtxtxtxtxt'],
};

// ============================================================
// --- PATTERN DESCRIPTION GENERATOR ---
// ============================================================
function generatePatternDescription(patternName, nextPrediction) {
    const predLabel = nextPrediction === 'T' ? 'Tài' : 'Xỉu';

    const descriptions = {
        '1-1':         `Cầu 1-1 – luân phiên đều → tiếp ${predLabel}`,
        'bệt':         `Cầu bệt – liên tiếp cùng loại → tiếp ${predLabel}`,
        '2-2':         `Cầu đôi 2-2 – đang ghép đôi → tiếp ${predLabel}`,
        '3-3':         `Cầu ba 3-3 – chuỗi 3 đang hình thành → tiếp ${predLabel}`,
        '4-4':         `Cầu bốn 4-4 – chuỗi 4 mạnh → tiếp ${predLabel}`,
        '5-5':         `Cầu năm 5-5 – chuỗi dài → tiếp ${predLabel}`,
        '1-2-1':       `Cầu 1-2-1 – sandwich đôi → tiếp ${predLabel}`,
        '2-1-2':       `Cầu 2-1-2 – kẹp đơn → tiếp ${predLabel}`,
        '1-2-3':       `Cầu leo thang 1-2-3 – tăng dần → tiếp ${predLabel}`,
        '3-2-3':       `Cầu đối xứng 3-2-3 → tiếp ${predLabel}`,
        '4-2-4':       `Cầu cân bằng 4-2-4 → tiếp ${predLabel}`,
        '3-1-3':       `Cầu 3-1-3 – kẹp đơn dày → tiếp ${predLabel}`,
        '1-3-1':       `Cầu 1-3-1 – bọc ba → tiếp ${predLabel}`,
        '2-3-2':       `Cầu 2-3-2 – nhịp tăng giữa → tiếp ${predLabel}`,
        '3-4-3':       `Cầu đỉnh 3-4-3 → tiếp ${predLabel}`,
        '4-3-4':       `Cầu sóng 4-3-4 → tiếp ${predLabel}`,
        'zigzag':      `Cầu zigzag – đảo chiều liên tục → tiếp ${predLabel}`,
        'double_zigzag':`Cầu zigzag đôi – dao động nhanh → tiếp ${predLabel}`,
        'triple_zigzag':`Cầu zigzag ba – rung lắc mạnh → tiếp ${predLabel}`,
        'quad_alternate':`Cầu xen kẽ 4 – nhịp đều → tiếp ${predLabel}`,
        'penta_alternate':`Cầu xen kẽ 5 – ổn định → tiếp ${predLabel}`,
        'fibonacci_4': `Cầu Fibonacci – mẫu tăng trưởng → tiếp ${predLabel}`,
        'fibonacci_5': `Cầu Fibonacci mở rộng → tiếp ${predLabel}`,
        'wave_2':      `Cầu sóng đôi → tiếp ${predLabel}`,
        'wave_3':      `Cầu sóng ba → tiếp ${predLabel}`,
        'wave_4':      `Cầu sóng bốn → tiếp ${predLabel}`,
        'wave_5':      `Cầu sóng năm – sóng lớn → tiếp ${predLabel}`,
        'spiral_1':    `Cầu xoắn ốc → tiếp ${predLabel}`,
        'spiral_2':    `Cầu xoắn ốc mở rộng → tiếp ${predLabel}`,
        'spiral_3':    `Cầu xoắn ốc lớn → tiếp ${predLabel}`,
        'mixed_1':     `Cầu hỗn hợp 1 – phức tạp → tiếp ${predLabel}`,
        'mixed_2':     `Cầu hỗn hợp 2 → tiếp ${predLabel}`,
        'mixed_3':     `Cầu hỗn hợp 3 → tiếp ${predLabel}`,
        'mixed_4':     `Cầu hỗn hợp 4 → tiếp ${predLabel}`,
        'mixed_5':     `Cầu hỗn hợp 5 → tiếp ${predLabel}`,
        'symmetry_2':  `Cầu đối xứng → tiếp ${predLabel}`,
        'symmetry_3':  `Cầu đối xứng rộng → tiếp ${predLabel}`,
        'repeat_1':    `Cầu bệt đôi → tiếp ${predLabel}`,
        'repeat_2':    `Cầu bệt tứ → tiếp ${predLabel}`,
        'alternate_1': `Cầu xen kẽ đều → tiếp ${predLabel}`,
        'alternate_2': `Cầu xen kẽ dài → tiếp ${predLabel}`,
        'alternate_3': `Cầu xen kẽ rộng → tiếp ${predLabel}`,
        'alternate_4': `Cầu xen kẽ cực dài → tiếp ${predLabel}`,
    };

    return descriptions[patternName] || `Cầu ${patternName} – phân tích AI → tiếp ${predLabel}`;
}

// ============================================================
// --- UTILITIES ---
// ============================================================
function parseLines(lines) {
    try {
        const arr = lines.map(l => (typeof l === 'string' ? JSON.parse(l) : l));
        return arr.map(item => ({
            session: Number(item.session) || 0,
            dice: Array.isArray(item.dice) ? item.dice : [],
            total: Number(item.total) || 0,
            result: item.result || '',
            tx: (Number(item.total) || 0) >= 11 ? 'T' : 'X'
        })).sort((a, b) => a.session - b.session);
    } catch (e) {
        console.error("Lỗi parseLines:", e.message);
        return [];
    }
}

// ============================================================
// --- THUẬT TOÁN AI ---
// ============================================================

function algo1_ultraPatternRecognition(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 30) return null;

    const txLower = tx.map(t => t.toLowerCase());
    const fullPattern = txLower.join('');
    
    let patternMatches = { t: 0, x: 0 };
    let totalWeight = 0;
    
    Object.entries(PATTERN_DATABASE).forEach(([patternName, patternList]) => {
        patternList.forEach(pattern => {
            const patternLength = pattern.length;
            if (patternLength > 8) return;
            
            for (let i = 0; i <= fullPattern.length - patternLength - 1; i++) {
                if (fullPattern.substr(i, patternLength) === pattern) {
                    const nextChar = fullPattern.charAt(i + patternLength);
                    if (nextChar === 't' || nextChar === 'x') {
                        const weight = (patternLength / 8) * (patternName.includes('complex') ? 1.5 : 1);
                        patternMatches[nextChar] += weight;
                        totalWeight += weight;
                    }
                }
            }
        });
    });
    
    if (totalWeight === 0) return null;
    
    const threshold = 0.65 + (Math.min(totalWeight, 50) / 100);
    const tProb = patternMatches.t / totalWeight;
    const xProb = patternMatches.x / totalWeight;
    
    if (tProb >= threshold) return 'T';
    if (xProb >= threshold) return 'X';
    
    return null;
}

function algo2_quantumAdaptiveAI(history) {
    if (history.length < 40) return null;
    
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    
    const quantumState = { t: 0.5, x: 0.5 };
    
    const recentCount = Math.min(20, history.length);
    for (let i = history.length - recentCount; i < history.length; i++) {
        const weight = 0.04;
        if (tx[i] === 'T') {
            quantumState.t = quantumState.t * (1 + weight);
            quantumState.x = quantumState.x * (1 - weight);
        } else {
            quantumState.x = quantumState.x * (1 + weight);
            quantumState.t = quantumState.t * (1 - weight);
        }
    }
    
    const recentAvg = totals.slice(-10).reduce((a, b) => a + b, 0) / 10;
    if (recentAvg > 11.2) {
        quantumState.t *= 0.85;
        quantumState.x *= 1.15;
    } else if (recentAvg < 9.8) {
        quantumState.t *= 1.15;
        quantumState.x *= 0.85;
    }
    
    const total = quantumState.t + quantumState.x;
    quantumState.t /= total;
    quantumState.x /= total;
    
    const decisionThreshold = 0.68;
    if (quantumState.t > decisionThreshold) return 'T';
    if (quantumState.x > decisionThreshold) return 'X';
    
    return null;
}

function algo3_deepTrendAnalysis(history) {
    if (history.length < 25) return null;
    
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    
    const periods = [5, 10, 15, 20];
    const trends = { t: 0, x: 0 };
    
    periods.forEach(period => {
        if (tx.length >= period) {
            const recent = tx.slice(-period);
            const tCount = recent.filter(c => c === 'T').length;
            const xCount = recent.filter(c => c === 'X').length;
            
            if (tCount > xCount) trends.t += 1;
            else if (xCount > tCount) trends.x += 1;
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
    
    const recentTx = tx.slice(-15);
    const lastResult = recentTx[recentTx.length - 1];
    
    let runLength = 1;
    for (let i = recentTx.length - 2; i >= 0; i--) {
        if (recentTx[i] === lastResult) runLength++;
        else break;
    }
    
    if (runLength >= 2 && runLength <= 4) {
        const patternStr = recentTx.slice(-8).join('').toLowerCase();
        const strongPatterns = ['tttt', 'xxxx', 'txtxtx', 'xtxtxt'];
        
        let inStrongPattern = false;
        strongPatterns.forEach(pattern => {
            if (patternStr.includes(pattern)) inStrongPattern = true;
        });
        
        if (inStrongPattern) return lastResult;
        
        const overallTrend = calculateOverallTrend(tx);
        if (overallTrend === lastResult) return lastResult;
    }
    
    if (runLength >= 5) return lastResult === 'T' ? 'X' : 'T';
    
    const lastPattern = recentTx.slice(-6).join('').toLowerCase();
    const reversalPatterns = ['tttxxx', 'xxxttt', 'ttxx', 'xxtt', 'txtxtx', 'xtxtxt'];
    
    if (reversalPatterns.includes(lastPattern)) {
        return lastResult === 'T' ? 'X' : 'T';
    }
    
    return null;
}

function algo5_volatilityPrediction(history) {
    if (history.length < 30) return null;
    
    const totals = history.map(h => h.total);
    const recent10 = totals.slice(-10);
    const recent20 = totals.slice(-20);
    
    const vol10 = calculateVolatility(recent10);
    const vol20 = calculateVolatility(recent20);
    
    if (vol10 > vol20 * 1.5) {
        const avgRecent = recent10.reduce((a, b) => a + b, 0) / 10;
        if (avgRecent > 11.0) return 'X';
        if (avgRecent < 10.0) return 'T';
    } else if (vol10 < vol20 * 0.7) {
        const recentTx = history.slice(-10).map(h => h.tx);
        const tCount = recentTx.filter(t => t === 'T').length;
        const xCount = recentTx.filter(t => t === 'X').length;
        
        if (tCount > xCount + 2) return 'T';
        if (xCount > tCount + 2) return 'X';
    }
    
    return null;
}

function algo6_patternFusionAI(history) {
    const tx = history.map(h => h.tx);
    if (tx.length < 35) return null;
    
    const txLower = tx.map(t => t.toLowerCase());
    const patterns = [];
    
    const patternTypes = [
        { name: 'basic', length: 3, weight: 0.3 },
        { name: 'advanced', length: 5, weight: 0.5 },
        { name: 'complex', length: 7, weight: 0.7 }
    ];
    
    patternTypes.forEach(type => {
        if (txLower.length >= type.length + 1) {
            const lastPattern = txLower.slice(-type.length).join('');
            let matches = { t: 0, x: 0 };
            
            for (let i = 0; i <= txLower.length - type.length - 1; i++) {
                if (txLower.slice(i, i + type.length).join('') === lastPattern) {
                    const nextChar = txLower[i + type.length];
                    matches[nextChar]++;
                }
            }
            
            const total = matches.t + matches.x;
            if (total >= 2) {
                const confidence = Math.max(matches.t, matches.x) / total;
                if (confidence > 0.7) {
                    patterns.push({
                        prediction: matches.t > matches.x ? 'T' : 'X',
                        confidence: confidence * type.weight,
                        weight: type.weight
                    });
                }
            }
        }
    });
    
    if (patterns.length === 0) return null;
    
    const combined = { t: 0, x: 0 };
    patterns.forEach(p => {
        if (p.prediction === 'T') combined.t += p.confidence;
        else combined.x += p.confidence;
    });
    
    if (combined.t > combined.x * 1.3) return 'T';
    if (combined.x > combined.t * 1.3) return 'X';
    
    return null;
}

function algo7_realtimeAdaptiveAI(history) {
    if (history.length < 20) return null;
    
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    
    const indicators = {
        rsi: calculateRSI(tx.slice(-14)),
        macd: calculateMACD(totals),
        bias: calculateBias(tx.slice(-20)),
        momentum: calculateMomentum(totals.slice(-10))
    };
    
    let tScore = 0;
    let xScore = 0;
    
    if (indicators.rsi > 70) xScore += 1.5;
    else if (indicators.rsi < 30) tScore += 1.5;
    
    if (indicators.macd > 0.5) tScore += 1;
    else if (indicators.macd < -0.5) xScore += 1;
    
    if (indicators.bias > 0.6) tScore += 1.2;
    else if (indicators.bias < 0.4) xScore += 1.2;
    
    if (indicators.momentum > 0.3) tScore += 0.8;
    else if (indicators.momentum < -0.3) xScore += 0.8;
    
    if (tScore > xScore + 1.5) return 'T';
    if (xScore > tScore + 1.5) return 'X';
    
    return null;
}

// --- HELPER FUNCTIONS ---
function calculateVolatility(numbers) {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const variance = numbers.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numbers.length;
    return Math.sqrt(variance);
}

function calculateOverallTrend(txArray) {
    if (txArray.length < 10) return null;
    const tCount = txArray.filter(t => t === 'T').length;
    const xCount = txArray.filter(t => t === 'X').length;
    if (tCount > xCount * 1.3) return 'T';
    if (xCount > tCount * 1.3) return 'X';
    return null;
}

function calculateRSI(txArray) {
    if (txArray.length < 14) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i < txArray.length; i++) {
        if (txArray[i] === 'T' && txArray[i-1] === 'X') gains++;
        else if (txArray[i] === 'X' && txArray[i-1] === 'T') losses++;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(totals) {
    if (totals.length < 26) return 0;
    const ema12 = calculateEMA(totals.slice(-12), 12);
    const ema26 = calculateEMA(totals.slice(-26), 26);
    return ema12 - ema26;
}

function calculateEMA(numbers, period) {
    const multiplier = 2 / (period + 1);
    let ema = numbers[0];
    for (let i = 1; i < numbers.length; i++) {
        ema = numbers[i] * multiplier + ema * (1 - multiplier);
    }
    return ema;
}

function calculateBias(txArray) {
    const tCount = txArray.filter(t => t === 'T').length;
    return tCount / txArray.length;
}

function calculateMomentum(numbers) {
    if (numbers.length < 2) return 0;
    return numbers[numbers.length - 1] - numbers[0];
}

// ============================================================
// --- DANH SÁCH THUẬT TOÁN ---
// ============================================================
const ALGORITHMS = [
    { id: 'ultra_pattern', fn: algo1_ultraPatternRecognition, name: 'Ultra Pattern AI' },
    { id: 'quantum_ai', fn: algo2_quantumAdaptiveAI, name: 'Quantum Adaptive AI' },
    { id: 'deep_trend', fn: algo3_deepTrendAnalysis, name: 'Deep Trend AI' },
    { id: 'smart_bridge', fn: algo4_smartBridgeDetection, name: 'Smart Bridge AI' },
    { id: 'volatility', fn: algo5_volatilityPrediction, name: 'Volatility AI' },
    { id: 'pattern_fusion', fn: algo6_patternFusionAI, name: 'Pattern Fusion AI' },
    { id: 'realtime_ai', fn: algo7_realtimeAdaptiveAI, name: 'Real-time Adaptive AI' },
];

// ============================================================
// --- ADVANCED AI CORE ---
// ============================================================
class AdvancedDeepLearningAI {
    constructor() {
        this.history = [];
        this.algorithmWeights = {};
        this.algorithmPerformance = {};
        this.recentPredictions = {};
        this.learningRate = 0.1;
        
        ALGORITHMS.forEach(algo => {
            this.algorithmWeights[algo.id] = 1.0;
            this.algorithmPerformance[algo.id] = {
                correct: 0,
                total: 0,
                recent: [],
                streak: 0,
                maxStreak: 0,
                name: algo.name
            };
            this.recentPredictions[algo.id] = null;
        });
    }
    
    updateAlgorithmPerformance(actualTx) {
        ALGORITHMS.forEach(algo => {
            const perf = this.algorithmPerformance[algo.id];
            const lastPred = this.recentPredictions[algo.id];
            
            if (lastPred) {
                const correct = lastPred === actualTx;
                perf.correct += correct ? 1 : 0;
                perf.total += 1;
                
                if (correct) {
                    perf.streak++;
                    perf.maxStreak = Math.max(perf.maxStreak, perf.streak);
                } else {
                    perf.streak = 0;
                }
                
                perf.recent.push(correct ? 1 : 0);
                if (perf.recent.length > 10) perf.recent.shift();
                
                if (perf.total >= 15) {
                    const accuracy = perf.correct / perf.total;
                    const recentAccuracy = perf.recent.reduce((a, b) => a + b) / perf.recent.length;
                    const streakBonus = perf.streak * 0.03;
                    
                    let newWeight = (accuracy * 0.6 + recentAccuracy * 0.3 + streakBonus * 0.1);
                    newWeight = Math.max(0.1, Math.min(2.0, newWeight * 1.8));
                    
                    this.algorithmWeights[algo.id] =
                        this.algorithmWeights[algo.id] * 0.8 + newWeight * 0.2;
                }
            }
        });
        
        ALGORITHMS.forEach(algo => { this.recentPredictions[algo.id] = null; });
    }
    
    calculateTrueConfidence(predictions) {
        if (predictions.length === 0) return 0.5;
        
        const votes = { T: 0, X: 0 };
        let totalWeight = 0;
        
        predictions.forEach(pred => {
            const weight = this.algorithmWeights[pred.algorithm] || 1.0;
            votes[pred.prediction] += weight;
            totalWeight += weight;
        });
        
        if (totalWeight === 0) return 0.5;
        
        const tVotes = votes['T'] || 0;
        const xVotes = votes['X'] || 0;
        const winningPrediction = tVotes > xVotes ? 'T' : (xVotes > tVotes ? 'X' : null);
        
        if (!winningPrediction) return 0.5;
        
        const winningVotes = Math.max(tVotes, xVotes);
        let confidence = winningVotes / totalWeight;
        
        const consensus = predictions.filter(p =>
            p.prediction === winningPrediction).length / predictions.length;
        
        confidence = (confidence * 0.7) + (consensus * 0.3);
        
        return Math.max(0.5, Math.min(0.98, confidence));
    }
    
    predict() {
        if (this.history.length < 15) {
            return {
                prediction: 'Tài',
                confidence: 0.5,
                rawPrediction: 'T',
                algorithms: 0,
            };
        }
        
        const predictions = [];
        this.recentPredictions = {};
        
        ALGORITHMS.forEach(algo => {
            try {
                const pred = algo.fn(this.history);
                if (pred === 'T' || pred === 'X') {
                    const weight = this.algorithmWeights[algo.id] || 1.0;
                    predictions.push({
                        algorithm: algo.id,
                        prediction: pred,
                        weight: weight
                    });
                    this.recentPredictions[algo.id] = pred;
                }
            } catch (e) {
                console.error(`Lỗi thuật toán ${algo.id}:`, e.message);
            }
        });
        
        if (predictions.length === 0) {
            return {
                prediction: 'Tài',
                confidence: 0.5,
                rawPrediction: 'T',
                algorithms: 0,
            };
        }
        
        const votes = { T: 0, X: 0 };
        predictions.forEach(p => { votes[p.prediction] += p.weight; });
        
        const tVotes = votes['T'] || 0;
        const xVotes = votes['X'] || 0;
        
        let finalPrediction = 'T';
        if (xVotes > tVotes) {
            finalPrediction = 'X';
        } else if (xVotes === tVotes) {
            finalPrediction = this.history[this.history.length - 1].tx;
        }
        
        const confidence = this.calculateTrueConfidence(predictions);
        
        return {
            prediction: finalPrediction === 'T' ? 'Tài' : 'Xỉu',
            confidence: confidence,
            rawPrediction: finalPrediction,
            algorithms: predictions.length,
        };
    }
    
    addResult(record) {
        const parsed = {
            session: Number(record.session) || 0,
            dice: Array.isArray(record.dice) ? record.dice : [],
            total: Number(record.total) || 0,
            result: record.result || '',
            tx: (Number(record.total) || 0) >= 11 ? 'T' : 'X'
        };
        
        if (this.history.length >= 15) {
            this.updateAlgorithmPerformance(parsed.tx);
        }
        
        this.history.push(parsed);
        if (this.history.length > 500) {
            this.history = this.history.slice(-400);
        }
        
        return parsed;
    }
    
    loadHistory(historyData) {
        this.history = parseLines(historyData);
        
        if (this.history.length >= 30) {
            console.log(`🤖 Đang huấn luyện AI trên ${this.history.length} mẫu...`);
            
            for (let i = 20; i < this.history.length - 1; i++) {
                const pastHistory = this.history.slice(0, i + 1);
                const actualTx = this.history[i + 1]?.tx;
                
                if (!actualTx) continue;
                
                ALGORITHMS.forEach(algo => {
                    try {
                        const pred = algo.fn(pastHistory);
                        if (pred) {
                            const perf = this.algorithmPerformance[algo.id];
                            const correct = pred === actualTx;
                            
                            perf.recent.push(correct ? 1 : 0);
                            if (perf.recent.length > 10) perf.recent.shift();
                            perf.correct += correct ? 1 : 0;
                            perf.total++;
                            
                            if (perf.total >= 15) {
                                const accuracy = perf.correct / perf.total;
                                const recentAccuracy = perf.recent.reduce((a, b) => a + b) / perf.recent.length;
                                let newWeight = (accuracy * 0.6 + recentAccuracy * 0.3);
                                newWeight = Math.max(0.1, Math.min(2.0, newWeight * 1.8));
                                this.algorithmWeights[algo.id] = newWeight;
                            }
                        }
                    } catch (e) {
                        // Bỏ qua lỗi
                    }
                });
            }
            
            console.log('✅ Huấn luyện AI hoàn tất!');
        }
    }
    
    getPattern() {
        if (this.history.length < 50) return { recent: 'đang thu thập...', long: 'đang thu thập...', discovered: null };
        const tx = this.history.map(h => h.tx);
        const recent = tx.slice(-20).join('').toLowerCase();
        const long = tx.slice(-50).join('').toLowerCase();
        
        return {
            recent: recent,
            long: long,
            discovered: this.discoverDominantPattern(tx.slice(-30))
        };
    }
    
    discoverDominantPattern(txArray) {
        const str = txArray.join('').toLowerCase();
        let dominantPattern = null;
        let maxOccurrences = 0;
        
        Object.entries(PATTERN_DATABASE).forEach(([name, patterns]) => {
            patterns.forEach(pattern => {
                let count = 0;
                for (let i = 0; i <= str.length - pattern.length; i++) {
                    if (str.substr(i, pattern.length) === pattern) count++;
                }
                if (count > maxOccurrences) {
                    maxOccurrences = count;
                    dominantPattern = name;
                }
            });
        });
        
        return dominantPattern || null;
    }
    
    getStats() {
        const stats = {};
        ALGORITHMS.forEach(algo => {
            const perf = this.algorithmPerformance[algo.id];
            if (perf.total > 0) {
                stats[algo.id] = {
                    name: perf.name,
                    accuracy: (perf.correct / perf.total * 100).toFixed(1) + '%',
                    weight: this.algorithmWeights[algo.id].toFixed(2),
                    predictions: perf.total,
                    streak: perf.streak
                };
            }
        });
        return stats;
    }
}

// --- Khởi tạo AI ---
const ai = new AdvancedDeepLearningAI();

// ============================================================
// --- API SERVER ---
// ============================================================
const app = fastify({ logger: false });

await app.register(cors, { origin: "*" });

// ============================================================
// --- ENDPOINT CHÍNH: FORMAT JSON MỚI ---
// ============================================================
app.get("/api/taixiu/sunwin", async (request, reply) => {
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        const lastResult = valid.length ? valid[0] : null;
        const currentPrediction = ai.predict();
        const pattern = ai.getPattern();

        // Tạo mô tả cầu
        const patternDesc = pattern.discovered
            ? generatePatternDescription(pattern.discovered, currentPrediction.rawPrediction)
            : `Đang phân tích cầu → tiếp ${currentPrediction.prediction}`;

        if (!lastResult) {
            return {
                phien_hien_tai: null,
                ket_qua: "đang chờ...",
                xuc_xac: null,
                phien_du_doan: null,
                du_doan: "đang tính...",
                do_tin_cay: "50%",
                pattern: "Đang thu thập dữ liệu...",
                id: "@sewdangcap"
            };
        }

        return {
            phien_hien_tai: lastResult.session,
            ket_qua: lastResult.total >= 11 ? "Tài" : "Xỉu",
            xuc_xac: lastResult.dice?.length === 3 ? lastResult.dice : null,
            phien_du_doan: lastResult.session + 1,
            du_doan: currentPrediction.prediction,
            do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(0)}%`,
            pattern: patternDesc,
            id: "@sewdangcap"
        };
    } catch (error) {
        console.error('Lỗi API /api/taixiu/sunwin:', error);
        return {
            phien_hien_tai: null,
            ket_qua: null,
            xuc_xac: null,
            phien_du_doan: null,
            du_doan: null,
            do_tin_cay: null,
            pattern: "Hệ thống đang xử lý lỗi hoặc chưa đủ dữ liệu.",
            id: "@sewdangcap"
        };
    }
});

app.get("/api/taixiu/history", async () => { 
    try {
        const valid = rikResults.filter((r) => r.dice?.length === 3);
        if (!valid.length) return { message: "chưa có dữ liệu." };
        
        return valid.slice(0, 30).map((i) => ({
            session: i.session,
            dice: i.dice,
            total: i.total,
            ket_qua: i.total >= 11 ? 'Tài' : 'Xỉu',
            tx: i.total >= 11 ? 'T' : 'X'
        }));
    } catch (e) {
        console.error('Lỗi API /api/taixiu/history:', e);
        return { message: "lỗi hệ thống" };
    }
});

app.get("/api/taixiu/ai-stats", async () => {
    try {
        const stats = ai.getStats();
        const prediction = ai.predict();
        const pattern = ai.getPattern();
        
        return {
            status: "online",
            ai_version: "9.0 - Ultra Pattern Recognition",
            current_prediction: prediction.prediction,
            confidence: `${(prediction.confidence * 100).toFixed(1)}%`,
            algorithms_active: prediction.algorithms,
            pattern_dominant: pattern.discovered,
            algorithm_stats: stats
        };
    } catch (e) {
        console.error('Lỗi API /api/taixiu/ai-stats:', e);
        return { error: "Lỗi hệ thống" };
    }
});

app.get("/api/token-status", async () => {
    const timeLeft = tokenExpiry ? tokenExpiry - Date.now() : 0;
    const minutesLeft = Math.floor(timeLeft / 60000);
    return {
        status: timeLeft > 0 ? "valid" : "expired",
        expires_at: tokenExpiry ? new Date(tokenExpiry).toLocaleString('vi-VN') : "unknown",
        minutes_remaining: minutesLeft,
        username: ACCOUNT.username,
    };
});

app.get("/", async () => { 
    return {
        status: "online",
        name: "SEW PROPRO",
        version: "9.0 - Ultra Pattern Recognition & Quantum AI",
        description: "Hệ thống AI dự đoán với 100+ mẫu cầu và học máy nâng cao",
        algorithms_count: ALGORITHMS.length,
        pattern_database: Object.keys(PATTERN_DATABASE).length + " mẫu cầu",
        features: [
            "Ultra Pattern Recognition (100+ mẫu)",
            "Quantum Adaptive AI",
            "Smart Bridge Detection",
            "Real-time Adaptive Learning",
            "Multi-layer Pattern Fusion",
            "Auto Token Refresh"
        ]
    };
});

// ============================================================
// --- WEBSOCKET ---
// ============================================================
function decodeBinaryMessage(data) {
    try {
        const message = new TextDecoder().decode(data);
        if (message.startsWith("[") || message.startsWith("{")) {
            return JSON.parse(message);
        }
        return null;
    } catch {
        return null;
    }
}

function sendRikCmd1005() {
    if (rikWS?.readyState === WebSocket.OPEN) {
        try {
            rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
        } catch (e) {
            console.error("Lỗi gửi lệnh 1005:", e.message);
        }
    }
}

function connectRikWebSocket() {
    console.log("\n🔌 Đang kết nối WebSocket...");
    
    if (rikWS && (rikWS.readyState === WebSocket.OPEN || rikWS.readyState === WebSocket.CONNECTING)) {
        rikWS.close();
    }
    clearInterval(rikIntervalCmd);

    try {
        rikWS = new WebSocket(`${WS_URL}${currentToken}`);
    } catch (e) {
        console.error("Lỗi tạo WebSocket:", e.message);
        setTimeout(connectRikWebSocket, 5000);
        return;
    }

    rikWS.on("open", () => {
        console.log("✅ WebSocket connected - Đang xác thực...");
        
        const authPayload = [1, "MiniGame", "SC_giathinh2133", "thinh211", {
            info: JSON.stringify({
                ipAddress: "2402:800:62cd:b4d1:8c64:a3c9:12bf:c19a",
                wsToken: currentToken,
                userId: "cdbaf598-e4ef-47f8-b4a6-a4881098db86",
                username: "SC_hellokietne212",
                timestamp: Date.now(),
            }),
            signature: "473ABDDDA6BDD74D8F0B6036223B0E3A002A518203A9BB9F95AD763E3BF969EC2CBBA61ED1A3A9E217B52A4055658D7BEA38F89B806285974C7F3F62A9400066709B4746585887D00C9796552671894F826E69EFD234F6778A5DDC24830CEF68D51217EF047644E0B0EB1CB26942EB34AEF114AEC36A6DF833BB10F7D122EA5E",
            pid: 5,
            subi: true,
        }];
        
        try {
            rikWS.send(JSON.stringify(authPayload));
        } catch (e) {
            console.error("Lỗi gửi xác thực:", e.message);
        }
       
        rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
    });

    rikWS.on("message", (data) => {
        try {
            const json = typeof data === "string" ? JSON.parse(data) : decodeBinaryMessage(data);
            if (!json) return;

            if (json.code === 401 || json.error === 'token_expired' || json.msg?.includes?.('token')) {
                console.log("⚠️  Token bị từ chối bởi server, đang refresh...");
                refreshToken();
                return;
            }

            if (json.session && Array.isArray(json.dice)) {
                const record = {
                    session: json.session,
                    dice: json.dice,
                    total: json.total,
                    result: json.result,
                };
                
                const parsed = ai.addResult(record);
                
                if (!rikCurrentSession || record.session > rikCurrentSession) {
                    rikCurrentSession = record.session;
                    rikResults.unshift(record);
                    if (rikResults.length > 100) rikResults.pop();
                }
                
                const prediction = ai.predict();
                console.log(`\n==============================================`);
                console.log(`📥 PHIÊN ${parsed.session}: ${parsed.total >= 11 ? 'Tài' : 'Xỉu'} (${parsed.total})`);
                console.log(`🔮 DỰ ĐOÁN ${parsed.session + 1}: **${prediction.prediction.toUpperCase()}**`);
                console.log(`🎯 CONFIDENCE: ${(prediction.confidence * 100).toFixed(0)}%`);
                console.log(`🤖 ALGORITHMS: ${prediction.algorithms}/${ALGORITHMS.length}`);
                
            } else if (Array.isArray(json) && json[1]?.htr) {
                const newHistory = json[1].htr
                    .map((i) => ({
                        session: i.sid,
                        dice: [i.d1, i.d2, i.d3],
                        total: i.d1 + i.d2 + i.d3,
                        result: i.d1 + i.d2 + i.d3 >= 11 ? "Tài" : "Xỉu",
                    }))
                    .sort((a, b) => a.session - b.session);

                ai.loadHistory(newHistory);
                rikResults = newHistory.slice(-50).sort((a, b) => b.session - a.session);

                const prediction = ai.predict();
                const stats = ai.getStats();

                console.log(`\n==============================================`);
                console.log(`📊 Đã tải ${newHistory.length} kết quả lịch sử`);
                console.log(`🤖 ULTRA PATTERN AI ĐÃ SẴN SÀNG`);
                console.log(`==============================================`);
                console.log(`🎯 Confidence: ${(prediction.confidence * 100).toFixed(0)}%`);
                
                const algoArray = Object.entries(stats)
                    .map(([key, value]) => ({ key, ...value }))
                    .sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight))
                    .slice(0, 3);
                
                console.log(`📈 Top 3 thuật toán:`);
                algoArray.forEach((algo, idx) => {
                    console.log(`   ${idx + 1}. ${algo.name}: WGT ${algo.weight} | ACC ${algo.accuracy}`);
                });
            }
        } catch (e) {
            console.error("❌ Parse message error:", e.message);
        }
    });

    rikWS.on("close", () => {
        console.log("🔌 WebSocket disconnected. Reconnecting in 3s...");
        clearInterval(rikIntervalCmd);
        setTimeout(connectRikWebSocket, 3000);
    });

    rikWS.on("error", (err) => {
        console.error("🔌 WebSocket error:", err.message);
        rikWS.close();
    });
}

// ============================================================
// --- KHỞI ĐỘNG ---
// ============================================================
const start = async () => {
    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
        
        console.log(`====================================`);
        console.log(`🚀 SEW PROPRO Sunwin AI ULTRA Server`);
        console.log(`====================================`);
        console.log(`   Port    : ${PORT}`);
        console.log(`   Tài khoản: ${ACCOUNT.username}`);
        console.log(`   Thuật toán: ${ALGORITHMS.length} AI Algorithms`);
        console.log(`   Pattern DB: ${Object.keys(PATTERN_DATABASE).length} mẫu`);
        console.log(`   Login URL : ${ACCOUNT.loginUrl}`);
        console.log(`   Auto Token Refresh: ✅ BẬT`);
        console.log(`==============================================`);
    } catch (err) {
        console.error('❌ Lỗi khởi động server:', err);
        process.exit(1);
    }
};

start().then(() => {
    startTokenWatcher();
    connectRikWebSocket();
}).catch(err => {
    console.error('Failed to start application:', err);
    process.exit(1);
});
