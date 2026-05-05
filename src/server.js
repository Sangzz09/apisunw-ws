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

const ACCOUNT = {
    username: "Msangzz09",
    password: "sang09",
    loginUrl: "https://web.sunwin.ec/api/auth/login",
};

let currentToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
let tokenExpiry = null;
let isRefreshing = false;

// ============================================================
// --- TOKEN MANAGER ---
// ============================================================
function parseTokenExpiry(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        if (payload.exp) return payload.exp * 1000;
        if (payload.timestamp) return payload.timestamp + (2 * 60 * 60 * 1000);
        return Date.now() + (2 * 60 * 60 * 1000);
    } catch { return Date.now() + (2 * 60 * 60 * 1000); }
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
    } finally { isRefreshing = false; }
    return currentToken;
}

function startTokenWatcher() {
    tokenExpiry = parseTokenExpiry(currentToken);
    console.log(`🔑 Token hết hạn lúc: ${new Date(tokenExpiry).toLocaleString('vi-VN')}`);
    const checkAndRefresh = async () => {
        const timeLeft = tokenExpiry - Date.now();
        console.log(`⏱️  Token còn hạn: ${Math.floor(timeLeft / 60000)} phút`);
        if (timeLeft < 15 * 60 * 1000) await refreshToken();
    };
    checkAndRefresh();
    setInterval(checkAndRefresh, 5 * 60 * 1000);
}

// ============================================================
// --- GLOBAL STATE ---
// ============================================================
let rikResults = [];
let winLoseStats = { wins: 0, losses: 0, total: 0, history: [] };
let currentSessionId = null;
let apiResponseData = {
    "phien_hien_tai": null,
    "ket_qua": "đang chờ...",
    "xuc_xac": [],
    "phien_du_doan": null,
    "du_doan": "đang tính...",
    "do_tin_cay": "50%",
    "pattern": "",
    "id": "@sewdangcap"
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

function calcStdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length);
}

function calcEMA(arr, period) {
    if (arr.length < period) return arr[arr.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
    return ema;
}

// ============================================================
// --- CÔNG THỨC 68GB BÀN XANH ---
// ============================================================
function congThuc68GB(history) {
    if (history.length < 3) return null;
    const n = history.length;
    const totals = history.map(h => h.total);
    const txArr  = history.map(h => h.tx);
    const t0 = totals[n - 1];
    const t1 = totals[n - 2];
    const t2 = n >= 3 ? totals[n - 3] : null;
    const t3 = n >= 4 ? totals[n - 4] : null;
    const tx0 = txArr[n - 1];
    const tx1 = txArr[n - 2];
    const tx2 = n >= 3 ? txArr[n - 3] : null;
    const tx3 = n >= 4 ? txArr[n - 4] : null;
    const isKep    = t0 === t1;
    const isTriple = isKep && n >= 3 && t0 === t2;

    if (n >= 5) {
        const streak5 = txArr.slice(-5);
        const allSameTx = streak5.every(v => v === streak5[0]);
        if (allSameTx) {
            const tot5 = totals.slice(-5);
            const maxT = Math.max(...tot5);
            const minT = Math.min(...tot5);
            if ((maxT - minT) >= 4) {
                const opposite = tx0 === 'T' ? 'X' : 'T';
                return { rule: 1, duDoan: opposite, doTinCay: 0.67, moTa: `CT68 R1: Cầu bệt dao động mạnh (${minT}-${maxT}) → Bẻ ${opposite === 'T' ? 'Tài' : 'Xỉu'}` };
            }
        }
    }

    {
        let betStart = n - 1;
        while (betStart > 0 && txArr[betStart - 1] === tx0) betStart--;
        const betLen = n - betStart;
        if (betLen >= 3) {
            const openingTotal = totals[betStart];
            if (openingTotal >= t0 && betLen >= 3) {
                const opposite = tx0 === 'T' ? 'X' : 'T';
                return { rule: 2, duDoan: opposite, doTinCay: 0.65, moTa: `CT68 R2: Tổng đầu cầu (${openingTotal}) ≥ hiện tại (${t0}), bệt ${betLen} tay → Bẻ` };
            }
        }
    }

    if (isKep && t0 === 11 && tx2 === 'X') return { rule: 3, duDoan: 'T', doTinCay: 0.68, moTa: `CT68 R3: Kép 11-11 sau xỉu → Tài` };
    if ((t0 === 16 || t0 === 17) && tx0 === 'T') return { rule: '3b', duDoan: 'X', doTinCay: 0.72, moTa: `CT68 R3b: Tổng Tài ${t0} (cao bất thường) → Bẻ Xỉu` };
    if (tx0 === 'X' && tx1 === 'X') { const t0Even = t0 % 2 === 0; const t1Even = t1 % 2 === 0; if (t0Even !== t1Even) return { rule: 4, duDoan: 'T', doTinCay: 0.66, moTa: `CT68 R4: 2 Xỉu chẵn-lẻ (${t1} & ${t0}) → Tài` }; }
    if (t3 !== null) { const peak = Math.max(t3, t2, t1); const valleyBefore = Math.min(t3, t2); if (peak >= 14 && valleyBefore <= 11 && t0 <= 10) return { rule: 5, duDoan: 'T', doTinCay: 0.66, moTa: `CT68 R5: Sóng nhỏ→cao(${peak})→nhỏ(${t0}) → Bẻ Tài` }; }
    if (t2 !== null) { const isZigzag3 = tx0 !== tx1 && tx1 !== tx2; if (isZigzag3 && t2 > t0 + 3) return { rule: 6, duDoan: 'X', doTinCay: 0.65, moTa: `CT68 R6: Cầu 1-1, đầu (${t2}) >> mới (${t0}) → Xỉu` }; }
    if (tx0 === 'X' && tx1 === 'X' && t0 < t1) return { rule: 7, duDoan: 'X', doTinCay: 0.63, moTa: `CT68 R7: Xỉu lùi (${t1}→${t0}) → Tiếp Xỉu` };
    if (tx0 === 'T' && tx1 === 'T' && t0 < t1) return { rule: 8, duDoan: 'X', doTinCay: 0.66, moTa: `CT68 R8: Tài lùi (${t1}→${t0}) → Bẻ Xỉu` };
    if (tx0 === 'T' && tx1 === 'X' && t0 > t1 && t0 > 11) return { rule: 9, duDoan: 'T', doTinCay: 0.63, moTa: `CT68 R9: Tổng tiến mạnh (${t1}→${t0}) → Tài` };
    if (tx0 === 'T' && tx1 === 'T' && Math.abs(t0 - t1) === 1) { if (tx2 === 'T') return { rule: '10b', duDoan: 'X', doTinCay: 0.72, moTa: `CT68 R10b: Tài vị liền 3+ tay → Bẻ Xỉu chắc` }; return { rule: 10, duDoan: 'X', doTinCay: 0.68, moTa: `CT68 R10: Tài vị liền (${t1}-${t0}) → Bẻ Xỉu` }; }
    if (tx0 === 'T' && tx1 === 'T' && Math.abs(t0 - t1) === 2) return { rule: 11, duDoan: 'T', doTinCay: 0.63, moTa: `CT68 R11: Tài cách 1 vị (${t1}-${t0}) → Tiếp Tài` };
    if (isKep && tx0 === 'X') { if (isTriple) { if (t0 === 10) return { rule: '12-triple10', duDoan: 'X', doTinCay: 0.72, moTa: `CT68 R12: Ba 10 liên tiếp → Tiếp Xỉu` }; return { rule: '12-triple', duDoan: 'T', doTinCay: 0.71, moTa: `CT68 R12: Ba Xỉu ${t0} liên tiếp → Bẻ Tài` }; } if (t0 % 2 === 0) return { rule: '12-even', duDoan: 'X', doTinCay: 0.67, moTa: `CT68 R12: Kép Xỉu chẵn (${t0}-${t0}) → Tiếp Xỉu` }; return { rule: '12-odd', duDoan: 'T', doTinCay: 0.67, moTa: `CT68 R12: Kép Xỉu lẻ (${t0}-${t0}) → Bẻ Tài` }; }
    if (isKep && tx0 === 'T') { if (isTriple) return { rule: '13-triple', duDoan: 'X', doTinCay: 0.71, moTa: `CT68 R13: Ba Tài ${t0} liên tiếp → Bẻ Xỉu` }; if (t0 % 2 === 0) return { rule: '13-even', duDoan: 'X', doTinCay: 0.69, moTa: `CT68 R13: Kép Tài chẵn (${t0}-${t0}) → Bẻ Xỉu` }; return { rule: '13-odd', duDoan: 'T', doTinCay: 0.67, moTa: `CT68 R13: Kép Tài lẻ (${t0}-${t0}) → Tiếp Tài` }; }
    if (tx0 === 'T' && tx1 === 'T' && tx2 === 'T' && t2 !== null) { const taiCount = txArr.slice(-6).filter(v => v === 'T').length; if (taiCount >= 5) return { rule: 14, duDoan: 'X', doTinCay: 0.70, moTa: `CT68 R14: Tài liên tục dài → Bẻ Xỉu` }; }
    if (t2 !== null && t2 === t0) { const midIsDiff = tx1 !== tx0; if (midIsDiff) return { rule: 15, duDoan: 'T', doTinCay: 0.68, moTa: `CT68 R15: Đối xứng (${t2}-${t1}-${t0}) → Bệt Tài` }; }
    return null;
}

// ============================================================
// --- PHÂN TÍCH CẦU ---
// ============================================================
function phanTichCau(tx) {
    if (tx.length < 5) return { loaiCau: 'Chưa đủ dữ liệu', duDoan: null, doTinCay: 0.5 };
    const results = [];
    const cauBet = phatHienCauBet(tx); if (cauBet) results.push(cauBet);
    const cau11 = phatHienCau11(tx); if (cau11) results.push(cau11);
    const cauNhom = phatHienCauNhom(tx); if (cauNhom) results.push(cauNhom);
    const cauPhuc = phatHienCauPhuc(tx); if (cauPhuc) results.push(cauPhuc);
    const cauLech = phatHienCauLech(tx); if (cauLech) results.push(cauLech);
    const cauDao = phatHienCauDao(tx); if (cauDao) results.push(cauDao);
    const cauSong = phatHienCauSong(tx); if (cauSong) results.push(cauSong);
    const cauTuanHoan = phatHienCauTuanHoan(tx); if (cauTuanHoan) results.push(cauTuanHoan);
    const cauDotPha = phatHienCauDotPha(tx); if (cauDotPha) results.push(cauDotPha);
    const cauDoiXung = phatHienCauDoiXung(tx); if (cauDoiXung) results.push(cauDoiXung);
    if (results.length === 0) return { loaiCau: 'Hỗn loạn', duDoan: duDoanTheoThongKe(tx), doTinCay: 0.52 };
    results.sort((a, b) => b.doTinCay - a.doTinCay);
    return results[0];
}

function phatHienCauBet(tx) {
    const last = tx[tx.length - 1]; let streak = 1;
    for (let i = tx.length - 2; i >= 0; i--) { if (tx[i] === last) streak++; else break; }
    if (streak < 2) return null;
    const betHistory = []; let cur = 1;
    for (let i = 1; i < tx.length; i++) { if (tx[i] === tx[i - 1]) cur++; else { betHistory.push(cur); cur = 1; } }
    betHistory.push(cur);
    const avgBetLen = betHistory.length > 3 ? betHistory.slice(-10).reduce((a, b) => a + b, 0) / Math.min(betHistory.length, 10) : 3;
    let duDoan, doTinCay, moTa;
    if (streak >= avgBetLen + 1) { duDoan = last === 'T' ? 'X' : 'T'; doTinCay = Math.min(0.75, 0.55 + (streak - avgBetLen) * 0.04); moTa = `Cầu bệt ${last === 'T' ? 'Tài' : 'Xỉu'} ${streak} (>TB ${avgBetLen.toFixed(1)}) → Sắp đảo`; }
    else if (streak >= 4) { duDoan = last === 'T' ? 'X' : 'T'; doTinCay = 0.58 + streak * 0.02; moTa = `Cầu bệt dài ${streak} → Nghiêng đảo`; }
    else { duDoan = last; doTinCay = 0.55 + streak * 0.03; moTa = `Cầu bệt ${last === 'T' ? 'Tài' : 'Xỉu'} ${streak} → Tiếp tục`; }
    return { loaiCau: `Cầu Bệt-${streak}`, moTa, duDoan, doTinCay: Math.min(0.82, doTinCay), streak, avgBetLen: avgBetLen.toFixed(1) };
}

function phatHienCau11(tx) {
    const recent = tx.slice(-10); let zigzagLen = 1;
    for (let i = recent.length - 2; i >= 0; i--) { if (recent[i] !== recent[i + 1]) zigzagLen++; else break; }
    if (zigzagLen < 4) return null;
    const last = recent[recent.length - 1];
    return { loaiCau: `Cầu 1-1 (Xen kẽ)`, moTa: `Cầu 1-1 dài ${zigzagLen} phiên → Tiếp tục xen kẽ`, duDoan: last === 'T' ? 'X' : 'T', doTinCay: Math.min(0.80, 0.60 + zigzagLen * 0.025), zigzagLen };
}

function phatHienCauNhom(tx) {
    const groups = []; let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) { if (tx[i] === cur.val) cur.len++; else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; } }
    groups.push(cur);
    if (groups.length < 4) return null;
    const recentGroups = groups.slice(-6); const lens = recentGroups.map(g => g.len);
    if (lens.slice(-4).every(l => l === 2)) { const last = tx[tx.length - 1]; const curGroupLen = recentGroups[recentGroups.length - 1].len; if (curGroupLen < 2) return { loaiCau: 'Cầu 2-2', moTa: 'Cầu 2-2 → Tiếp tục', duDoan: last, doTinCay: 0.70 }; return { loaiCau: 'Cầu 2-2', moTa: 'Cầu 2-2 → Đảo nhóm', duDoan: last === 'T' ? 'X' : 'T', doTinCay: 0.72 }; }
    if (lens.slice(-4).every(l => l === 3)) { const last = tx[tx.length - 1]; const curGroup = recentGroups[recentGroups.length - 1]; if (curGroup.len < 3) return { loaiCau: 'Cầu 3-3', moTa: 'Cầu 3-3 → Tiếp tục', duDoan: last, doTinCay: 0.72 }; return { loaiCau: 'Cầu 3-3', moTa: 'Cầu 3-3 → Đảo nhóm', duDoan: last === 'T' ? 'X' : 'T', doTinCay: 0.73 }; }
    return null;
}

function phatHienCauPhuc(tx) {
    const groups = []; let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) { if (tx[i] === cur.val) cur.len++; else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; } }
    groups.push(cur);
    if (groups.length < 6) return null;
    const recentGroups = groups.slice(-8); const lens = recentGroups.map(g => g.len);
    const patterns = [{ name: '2-1', seq: [2,1] },{ name: '1-2', seq: [1,2] },{ name: '3-1', seq: [3,1] },{ name: '1-3', seq: [1,3] },{ name: '2-3', seq: [2,3] },{ name: '3-2', seq: [3,2] }];
    for (const pat of patterns) {
        const pLen = pat.seq.length; if (lens.length < pLen * 2) continue;
        let matches = 0;
        for (let i = 0; i <= lens.length - pLen; i += pLen) { const slice = lens.slice(i, i + pLen); if (slice.length === pLen && slice.every((v, j) => v === pat.seq[j])) matches++; }
        if (matches >= 2) {
            const curGroup = recentGroups[recentGroups.length - 1]; const posInPattern = (recentGroups.length - 1) % pLen; const expectedLen = pat.seq[posInPattern]; const last = tx[tx.length - 1];
            if (curGroup.len < expectedLen) return { loaiCau: `Cầu ${pat.name}`, moTa: `Cầu ${pat.name} lặp ${matches}x → Tiếp tục`, duDoan: last, doTinCay: Math.min(0.78, 0.60 + matches * 0.04) };
            return { loaiCau: `Cầu ${pat.name}`, moTa: `Cầu ${pat.name} lặp ${matches}x → Đảo sang nhóm mới`, duDoan: last === 'T' ? 'X' : 'T', doTinCay: Math.min(0.78, 0.62 + matches * 0.04) };
        }
    }
    return null;
}

function phatHienCauLech(tx) {
    const windows = [{ n: 10, weight: 0.5 },{ n: 20, weight: 0.3 },{ n: 30, weight: 0.2 }];
    let tScore = 0, xScore = 0;
    for (const { n, weight } of windows) { if (tx.length < n) continue; const slice = tx.slice(-n); const tRate = slice.filter(v => v === 'T').length / n; tScore += tRate * weight; xScore += (1 - tRate) * weight; }
    const total = tScore + xScore; if (total === 0) return null;
    const tRate = tScore / total;
    if (tRate >= 0.68) return { loaiCau: 'Cầu Lệch Tài', moTa: `Tài áp đảo ${(tRate * 100).toFixed(0)}%`, duDoan: 'T', doTinCay: Math.min(0.72, 0.55 + (tRate - 0.5) * 0.6) };
    if (tRate <= 0.32) return { loaiCau: 'Cầu Lệch Xỉu', moTa: `Xỉu áp đảo ${((1 - tRate) * 100).toFixed(0)}%`, duDoan: 'X', doTinCay: Math.min(0.72, 0.55 + (0.5 - tRate) * 0.6) };
    return null;
}

function phatHienCauDao(tx) {
    if (tx.length < 15) return null;
    const groups = []; let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) { if (tx[i] === cur.val) cur.len++; else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; } }
    groups.push(cur);
    if (groups.length < 3) return null;
    const lastGroup = groups[groups.length - 1]; const prevGroup = groups[groups.length - 2];
    if (prevGroup.len >= 4 && lastGroup.len <= 2) {
        const last = tx[tx.length - 1];
        if (lastGroup.len === 1) return { loaiCau: 'Cầu Đảo Chiều', moTa: `Vừa đảo chiều sau cầu ${prevGroup.len} → Cầu mới đang hình thành`, duDoan: last, doTinCay: 0.58 };
        return { loaiCau: 'Cầu Đảo Chiều', moTa: `Đảo chiều xác nhận → Tiếp tục`, duDoan: last, doTinCay: 0.65 };
    }
    return null;
}

function phatHienCauSong(tx) {
    if (tx.length < 20) return null;
    const groups = []; let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) { if (tx[i] === cur.val) cur.len++; else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; } }
    groups.push(cur);
    if (groups.length < 6) return null;
    const lens = groups.slice(-6).map(g => g.len);
    let isWave = true;
    for (let i = 1; i < lens.length - 1; i++) { const prevDir = Math.sign(lens[i] - lens[i-1]); const nextDir = Math.sign(lens[i+1] - lens[i]); if (prevDir === 0 || nextDir === 0 || prevDir === nextDir) { isWave = false; break; } }
    if (!isWave) return null;
    const last = tx[tx.length - 1];
    return { loaiCau: 'Cầu Sóng', moTa: `Cầu sóng dao động → Phân tích nhóm`, duDoan: last, doTinCay: 0.65 };
}

function phatHienCauTuanHoan(tx) {
    if (tx.length < 24) return null;
    const str = tx.join('');
    for (let cycleLen = 2; cycleLen <= 8; cycleLen++) {
        const candidate = str.slice(-cycleLen); let matches = 0;
        for (let i = 0; i <= str.length - cycleLen * 2; i++) { if (str.slice(i, i + cycleLen) === candidate) matches++; }
        if (matches >= 3) {
            const votes = { T: 0, X: 0 };
            const posInCycle = tx.length % cycleLen;
            for (let i = posInCycle; i < str.length; i += cycleLen) { if (str[i]) votes[str[i]]++; }
            const total = votes.T + votes.X; if (total < 2) continue;
            const winner = votes.T > votes.X ? 'T' : 'X'; const conf = Math.max(votes.T, votes.X) / total;
            if (conf >= 0.65) return { loaiCau: `Cầu Tuần Hoàn-${cycleLen}`, moTa: `Chu kỳ ${cycleLen} phiên lặp ${matches}x`, duDoan: winner, doTinCay: Math.min(0.78, 0.55 + conf * 0.3) };
        }
    }
    return null;
}

function phatHienCauDotPha(tx) {
    if (tx.length < 20) return null;
    const recent5 = tx.slice(-5); const prev10 = tx.slice(-15, -5);
    const recentTRate = recent5.filter(v => v === 'T').length / 5; const prevTRate = prev10.filter(v => v === 'T').length / 10;
    const shift = Math.abs(recentTRate - prevTRate);
    if (shift >= 0.35) { const newTrend = recentTRate > prevTRate ? 'T' : 'X'; return { loaiCau: 'Cầu Đột Phá', moTa: `Đột phá xu hướng (shift ${(shift * 100).toFixed(0)}%)`, duDoan: newTrend, doTinCay: Math.min(0.68, 0.55 + shift * 0.4) }; }
    return null;
}

function phatHienCauDoiXung(tx) {
    if (tx.length < 16) return null;
    const recent = tx.slice(-16); const half = 8;
    const left = recent.slice(0, half).join(''); const right = recent.slice(half).join('');
    const mirror = left.split('').reverse().map(c => c === 'T' ? 'X' : 'T').join('');
    let matchCount = 0;
    for (let i = 0; i < half; i++) { if (right[i] === mirror[i]) matchCount++; }
    if (matchCount / half >= 0.75) {
        const last = tx[tx.length - 1];
        return { loaiCau: 'Cầu Đối Xứng', moTa: `Cầu đối xứng (${(matchCount / half * 100).toFixed(0)}% khớp)`, duDoan: last === 'T' ? 'X' : 'T', doTinCay: 0.60 + (matchCount / half - 0.75) * 0.5 };
    }
    return null;
}

function duDoanTheoThongKe(tx) {
    if (tx.length < 5) return 'T';
    const recent = tx.slice(-10); const tCount = recent.filter(v => v === 'T').length;
    return tCount >= 5 ? 'T' : 'X';
}

// ============================================================
// --- AI CORE V3 ---
// ============================================================
class AdvancedAI {
    constructor() {
        this.history = [];
        this.algoPerf = {};
        this.lastPreds = {};
        this.subAlgos = [
            { id: 'markov2',    fn: this._markov2.bind(this),    name: 'Markov-2',   weight: 1.0 },
            { id: 'markov3',    fn: this._markov3.bind(this),    name: 'Markov-3',   weight: 1.2 },
            { id: 'markov3ext', fn: this._markov3Ext.bind(this), name: 'Markov-3X',  weight: 1.2 },
            { id: 'ema_bias',   fn: this._emaBias.bind(this),    name: 'EMA Bias',   weight: 1.0 },
            { id: 'rsi',        fn: this._rsiSignal.bind(this),  name: 'RSI Signal', weight: 1.0 },
            { id: 'bollinger',  fn: this._bollinger.bind(this),  name: 'Bollinger',  weight: 1.0 },
            { id: 'momentum',   fn: this._momentum.bind(this),   name: 'Momentum',   weight: 1.0 },
            { id: 'mean_rev',   fn: this._meanReversion.bind(this), name: 'Mean Rev', weight: 1.0 },
            { id: 'dice_dist',  fn: this._diceDist.bind(this),   name: 'Dice Dist',  weight: 1.0 },
            { id: 'neural',     fn: this._neuralSeq.bind(this),  name: 'Neural Seq', weight: 1.0 },
            { id: 'bayesian',   fn: this._bayesian.bind(this),   name: 'Bayesian',   weight: 1.0 },
        ];
        this.subAlgos.forEach(a => { this.algoPerf[a.id] = { correct: 0, total: 0, recent: [], streak: 0 }; this.lastPreds[a.id] = null; });
    }

    addResult(record) {
        const parsed = parseRecord(record);
        if (this.history.length >= 10) this._updatePerf(parsed.tx);
        this.history.push(parsed);
        if (this.history.length > 600) this.history = this.history.slice(-500);
        return parsed;
    }

    _updatePerf(actualTx) {
        this.subAlgos.forEach(a => {
            const perf = this.algoPerf[a.id]; const pred = this.lastPreds[a.id]; if (!pred) return;
            const correct = pred === actualTx; perf.correct += correct ? 1 : 0; perf.total++; perf.streak = correct ? perf.streak + 1 : 0; perf.recent.push(correct ? 1 : 0); if (perf.recent.length > 15) perf.recent.shift();
            if (perf.total >= 20) { const acc = perf.correct / perf.total; const recAcc = perf.recent.reduce((a, b) => a + b, 0) / perf.recent.length; a.weight = Math.max(0.05, Math.min(2.5, (acc * 0.5 + recAcc * 0.4 + Math.min(perf.streak, 5) * 0.02) * 2.0)); }
        });
        this.subAlgos.forEach(a => { this.lastPreds[a.id] = null; });
    }

    predict() {
        const tx = this.history.map(h => h.tx);
        if (tx.length < 10) return { prediction: 'Tài', rawPrediction: 'T', confidence: 0.5, cauInfo: null, ct68Info: null, detail: 'Chưa đủ dữ liệu' };
        const ct68Result = congThuc68GB(this.history);
        const CT68_WEIGHT = 3.0;
        const cauResult = phanTichCau(tx);
        const CAU_WEIGHT = 2.5;
        const subVotes = { T: 0, X: 0 }; let activeSubAlgos = 0;
        this.subAlgos.forEach(a => { try { const v = a.fn(this.history); if (v === 'T' || v === 'X') { subVotes[v] += a.weight; activeSubAlgos++; this.lastPreds[a.id] = v; } } catch (_) {} });
        const finalVotes = { T: 0, X: 0 };
        if (ct68Result && (ct68Result.duDoan === 'T' || ct68Result.duDoan === 'X')) finalVotes[ct68Result.duDoan] += CT68_WEIGHT * ct68Result.doTinCay;
        if (cauResult.duDoan === 'T' || cauResult.duDoan === 'X') finalVotes[cauResult.duDoan] += CAU_WEIGHT * cauResult.doTinCay;
        const subTotal = subVotes.T + subVotes.X;
        if (subTotal > 0) { finalVotes['T'] += (subVotes.T / subTotal) * 1.5; finalVotes['X'] += (subVotes.X / subTotal) * 1.5; }
        const grandTotal = finalVotes.T + finalVotes.X;
        const final = finalVotes.T >= finalVotes.X ? 'T' : 'X';
        const rawConf = Math.max(finalVotes.T, finalVotes.X) / grandTotal;
        const cauAgrees = cauResult.duDoan === final;
        const ct68Agrees = ct68Result ? ct68Result.duDoan === final : false;
        const subConsensus = final === 'T' ? subVotes.T / (subTotal || 1) : subVotes.X / (subTotal || 1);
        let confidence = rawConf * 0.55 + subConsensus * 0.20 + (cauAgrees ? 0.08 : 0) + cauResult.doTinCay * 0.05 + (ct68Agrees && ct68Result ? ct68Result.doTinCay * 0.12 : 0);
        confidence = Math.max(0.51, Math.min(0.95, confidence));
        return { prediction: final === 'T' ? 'Tài' : 'Xỉu', rawPrediction: final, confidence, cauInfo: cauResult, ct68Info: ct68Result, activeSubAlgos, detail: ct68Result ? `[CT68] ${ct68Result.moTa}` : (cauResult.moTa || 'N/A') };
    }

    loadHistory(arr) {
        this.history = arr.map(parseRecord).sort((a, b) => a.session - b.session);
        console.log(`📊 Đã tải ${this.history.length} lịch sử vào AI`);
    }

    getPatternString(len = 25) { return this.history.slice(-len).map(h => h.tx).join('').toLowerCase(); }
    getTotalPattern(len = 15) { return this.history.slice(-len).map(h => h.total).join('-'); }
    getStats() {
        const stats = {};
        this.subAlgos.forEach(a => { const p = this.algoPerf[a.id]; if (p.total > 0) stats[a.id] = { name: a.name, accuracy: (p.correct / p.total * 100).toFixed(1) + '%', weight: a.weight.toFixed(2), predictions: p.total }; });
        return stats;
    }

    _markov2(history) { if (history.length < 20) return null; const tx = history.map(h => h.tx); const trans = {}; for (let i = 0; i < tx.length - 1; i++) { const key = tx[i]; if (!trans[key]) trans[key] = { T: 0, X: 0 }; trans[key][tx[i+1]]++; } const last = tx[tx.length - 1]; const t = trans[last]; if (!t) return null; const total = t.T + t.X; if (total < 8) return null; if (t.T / total > 0.62) return 'T'; if (t.X / total > 0.62) return 'X'; return null; }
    _markov3(history) { if (history.length < 30) return null; const tx = history.map(h => h.tx); const trans = {}; for (let i = 0; i < tx.length - 2; i++) { const key = tx[i] + tx[i+1]; if (!trans[key]) trans[key] = { T: 0, X: 0 }; trans[key][tx[i+2]]++; } const last2 = tx.slice(-2).join(''); const t = trans[last2]; if (!t) return null; const total = t.T + t.X; if (total < 5) return null; if (t.T / total > 0.62) return 'T'; if (t.X / total > 0.62) return 'X'; return null; }
    _markov3Ext(history) {
        if (history.length < 40) return null;
        const tx = history.map(h => h.tx);
        const gram3 = {};
        for (let i = 0; i < tx.length - 3; i++) { const key = tx[i] + tx[i+1] + tx[i+2]; if (!gram3[key]) gram3[key] = { T: 0, X: 0 }; gram3[key][tx[i+3]]++; }
        const key3 = tx.slice(-3).join(''); const g3 = gram3[key3];
        let score3T = 0, score3X = 0;
        if (g3) { const tot3 = g3.T + g3.X; if (tot3 >= 4) { score3T = g3.T / tot3; score3X = g3.X / tot3; } }
        let trendBoost = 0;
        if (history.length >= 3) { const recentTotals = history.slice(-3).map(h => h.total); const delta = recentTotals[2] - recentTotals[0]; if (delta >= 4) trendBoost = 0.12; else if (delta <= -4) trendBoost = -0.12; }
        const finalT = score3T + (trendBoost > 0 ? trendBoost : 0); const finalX = score3X + (trendBoost < 0 ? -trendBoost : 0);
        if (finalT > 0 && finalT - finalX >= 0.18) return 'T'; if (finalX > 0 && finalX - finalT >= 0.18) return 'X';
        if (g3) { const tot3 = g3.T + g3.X; if (tot3 >= 6 && score3T > 0.65) return 'T'; if (tot3 >= 6 && score3X > 0.65) return 'X'; }
        return null;
    }
    _emaBias(history) { if (history.length < 13) return null; const totals = history.map(h => h.total); const ema5 = calcEMA(totals, 5); const ema13 = calcEMA(totals, 13); if (ema5 > ema13 + 0.3) return 'T'; if (ema5 < ema13 - 0.3) return 'X'; return null; }
    _rsiSignal(history) { if (history.length < 14) return null; const tx = history.map(h => h.tx); let gains = 0, losses = 0; const slice = tx.slice(-14); for (let i = 1; i < slice.length; i++) { if (slice[i] === 'T' && slice[i-1] === 'X') gains++; else if (slice[i] === 'X' && slice[i-1] === 'T') losses++; } const rsi = losses === 0 ? 100 : 100 - (100 / (1 + gains / losses)); if (rsi > 72) return 'X'; if (rsi < 28) return 'T'; if (rsi > 58) return 'T'; if (rsi < 42) return 'X'; return null; }
    _bollinger(history) { if (history.length < 20) return null; const totals = history.map(h => h.total).slice(-20); const mean = totals.reduce((a, b) => a + b, 0) / 20; const std = calcStdDev(totals); const last = totals[totals.length - 1]; if (last >= mean + 1.8 * std) return 'X'; if (last <= mean - 1.8 * std) return 'T'; return null; }
    _momentum(history) { if (history.length < 12) return null; const totals = history.map(h => h.total); const n = totals.length; const mom5 = totals[n-1] - totals[n-6]; const mom10 = totals[n-1] - totals[n-11]; let t = 0, x = 0; if (mom5 > 1.5) t++; else if (mom5 < -1.5) x++; if (mom10 > 2) t++; else if (mom10 < -2) x++; if (t >= 2) return 'T'; if (x >= 2) return 'X'; return null; }
    _meanReversion(history) { if (history.length < 25) return null; const totals = history.map(h => h.total); const longMean = totals.slice(-25).reduce((a, b) => a + b, 0) / 25; const shortMean = totals.slice(-4).reduce((a, b) => a + b, 0) / 4; const std = calcStdDev(totals.slice(-25)); const z = (shortMean - longMean) / (std || 1); if (z > 1.6) return 'X'; if (z < -1.6) return 'T'; return null; }
    _diceDist(history) {
        if (history.length < 60) return null;
        const theoretical = { 3:1,4:3,5:6,6:10,7:15,8:21,9:25,10:27,11:27,12:25,13:21,14:15,15:10,16:6,17:3,18:1 };
        const totalTheo = 216; const n = history.length; const dist = {};
        history.forEach(h => { dist[h.total] = (dist[h.total] || 0) + 1; });
        let taiExp = 0, xiuExp = 0, taiAct = 0, xiuAct = 0;
        for (let s = 3; s <= 18; s++) { const exp = (theoretical[s] || 0) / totalTheo * n; const act = dist[s] || 0; if (s >= 11) { taiExp += exp; taiAct += act; } else { xiuExp += exp; xiuAct += act; } }
        const taiR = taiAct / (taiExp || 1); const xiuR = xiuAct / (xiuExp || 1);
        if (xiuR < 0.85 && taiR > 1.08) return 'X'; if (taiR < 0.85 && xiuR > 1.08) return 'T'; return null;
    }
    _neuralSeq(history) {
        if (history.length < 45) return null;
        const tx = history.map(h => h.tx); const seqLen = 6; const lastSeq = tx.slice(-seqLen).join(''); const votes = { T: 0, X: 0 }; let count = 0;
        for (let i = 0; i <= tx.length - seqLen - 1; i++) { const seq = tx.slice(i, i + seqLen).join(''); let sim = 0; for (let j = 0; j < seqLen; j++) if (seq[j] === lastSeq[j]) sim++; const simRate = sim / seqLen; if (simRate >= 0.70) { votes[tx[i + seqLen]] += simRate * simRate; count++; } }
        if (count < 3) return null; const total = votes.T + votes.X; if (votes.T / total > 0.63) return 'T'; if (votes.X / total > 0.63) return 'X'; return null;
    }
    _bayesian(history) {
        if (history.length < 15) return null;
        const tx = history.map(h => h.tx); let pT = 0.5, pX = 0.5;
        [5, 10, 15, 20, 30].forEach(w => { if (tx.length < w) return; const slice = tx.slice(-w); const tRate = slice.filter(v => v === 'T').length / w; const likT = 0.5 + (tRate - 0.5) * 0.55; const likX = 1 - likT; const norm = pT * likT + pX * likX; pT = (pT * likT) / norm; pX = (pX * likX) / norm; });
        if (pT > 0.65) return 'T'; if (pX > 0.65) return 'X'; return null;
    }
}

const ai = new AdvancedAI();

// ============================================================
// --- WEBSOCKET ---
// ============================================================
let ws = null, pingInterval = null, reconnectTimeout = null, isConnecting = false;

function getInitialMessages() {
    return [
        [1, "MiniGame", "GM_apivopnha", "WangLin", {
            "info": JSON.stringify({ ipAddress: "14.249.227.107", wsToken: currentToken, locale: "vi", userId: "8838533e-de43-4b8d-9503-621f4050534e", username: "GM_apivopnha", timestamp: Date.now() }),
            "signature": "45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"
        }],
        [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
        [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
    ];
}

function connectWebSocket() {
    if (isConnecting) return;
    isConnecting = true;
    clearInterval(pingInterval);
    clearTimeout(reconnectTimeout);
    if (ws) { ws.removeAllListeners(); try { ws.close(); } catch (_) {} }
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
        getInitialMessages().forEach((msg, i) => { setTimeout(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }, i * 600); });
        pingInterval = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.ping(); }, PING_INTERVAL);
    });

    ws.on('pong', () => console.log('[📶] Ping OK.'));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (!Array.isArray(data) || typeof data[1] !== 'object') return;
            const payload = data[1];
            const { cmd, sid, d1, d2, d3, gBB } = payload;

            if (payload.code === 401 || payload.error === 'token_expired' || (typeof payload.msg === 'string' && payload.msg.toLowerCase().includes('token'))) {
                console.log("⚠️  Token bị từ chối, đang refresh...");
                refreshToken(); return;
            }

            if (cmd === 1008 && sid) currentSessionId = sid;

            if (cmd === 1003 && gBB) {
                if (!d1 || !d2 || !d3) return;
                const total = d1 + d2 + d3;
                const session = currentSessionId;
                const record = { session, dice: [d1, d2, d3], total };
                const parsed = ai.addResult(record);

                // Cập nhật thống kê thắng/thua
                if (apiResponseData.du_doan && apiResponseData.phien_du_doan === session) {
                    const ketQua = total >= 11 ? 'Tài' : 'Xỉu';
                    const thang = apiResponseData.du_doan === ketQua;
                    winLoseStats.total++;
                    if (thang) winLoseStats.wins++; else winLoseStats.losses++;
                    winLoseStats.history.unshift({ session, du_doan: apiResponseData.du_doan, ket_qua: ketQua, thang });
                    if (winLoseStats.history.length > 50) winLoseStats.history.pop();
                }

                rikResults.unshift(record);
                if (rikResults.length > 100) rikResults.pop();
                currentSessionId = null;

                const prediction = ai.predict();
                const patternStr = ai.getPatternString(25);

                apiResponseData = {
                    "phien_hien_tai": session,
                    "ket_qua": total >= 11 ? 'Tài' : 'Xỉu',
                    "xuc_xac": [d1, d2, d3],
                    "phien_du_doan": session ? session + 1 : null,
                    "du_doan": prediction.prediction,
                    "do_tin_cay": `${(prediction.confidence * 100).toFixed(0)}%`,
                    "pattern": patternStr,
                    "id": "@sewdangcap"
                };

                console.log(`\n==============================================`);
                console.log(`📥 PHIÊN ${session}: ${total >= 11 ? 'Tài' : 'Xỉu'} (${total}) [${d1}-${d2}-${d3}]`);
                if (prediction.ct68Info) console.log(`🃏 CT68GB: ${prediction.ct68Info.moTa}`);
                console.log(`🎯 CẦU: ${prediction.cauInfo?.loaiCau || 'Hỗn loạn'}`);
                console.log(`🔮 DỰ ĐOÁN ${session ? session + 1 : '?'}: **${prediction.prediction.toUpperCase()}**`);
                console.log(`💯 ĐỘ TIN CẬY: ${(prediction.confidence * 100).toFixed(0)}%`);
                console.log(`📊 PATTERN: ${patternStr}`);
            }

            if (payload.htr && Array.isArray(payload.htr)) {
                const history = payload.htr.map(i => ({ session: i.sid, dice: [i.d1, i.d2, i.d3], total: i.d1 + i.d2 + i.d3 })).filter(i => i.dice.every(d => d > 0));
                ai.loadHistory(history);
                rikResults = history.slice(-50).sort((a, b) => b.session - a.session);
                const prediction = ai.predict();
                console.log(`\n✅ AI sẵn sàng | Cầu: ${prediction.cauInfo?.loaiCau || 'Đang phân tích'} | Confidence: ${(prediction.confidence * 100).toFixed(0)}%`);
            }
        } catch (e) { console.error('[❌] Lỗi parse message:', e.message); }
    });

    ws.on('close', (code) => {
        console.log(`[🔌] WebSocket closed. Code: ${code}`);
        isConnecting = false;
        clearInterval(pingInterval);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });

    ws.on('error', (err) => {
        console.error('[❌] WebSocket error:', err.message);
        isConnecting = false;
        try { ws.close(); } catch (_) {}
    });
}

// ============================================================
// --- HTML LANDING PAGE ---
// ============================================================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API Tool Tài Xiu Sunwin</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d1117;
    --bg2: #161b22;
    --bg3: #1c2128;
    --border: #30363d;
    --border-hover: #484f58;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --cyan: #39d0f0;
    --cyan-dim: rgba(57,208,240,0.12);
    --green: #3fb950;
    --green-dim: rgba(63,185,80,0.12);
    --yellow: #d29922;
    --yellow-dim: rgba(210,153,34,0.12);
    --blue: #58a6ff;
    --blue-dim: rgba(88,166,255,0.1);
    --purple: #bc8cff;
    --red: #f85149;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Space Grotesk', sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 60px 20px 40px;
    position: relative;
    overflow-x: hidden;
  }

  /* Grid background */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(rgba(57,208,240,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(57,208,240,0.03) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 0;
  }

  /* Glow orb top */
  body::after {
    content: '';
    position: fixed;
    top: -200px;
    left: 50%;
    transform: translateX(-50%);
    width: 600px;
    height: 400px;
    background: radial-gradient(ellipse, rgba(57,208,240,0.08) 0%, transparent 70%);
    pointer-events: none;
    z-index: 0;
  }

  .container {
    width: 100%;
    max-width: 1100px;
    position: relative;
    z-index: 1;
  }

  /* HEADER */
  .header {
    text-align: center;
    margin-bottom: 56px;
    animation: fadeDown 0.6s ease both;
  }

  .header-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--cyan-dim);
    border: 1px solid rgba(57,208,240,0.25);
    color: var(--cyan);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    padding: 4px 12px;
    border-radius: 20px;
    margin-bottom: 20px;
  }

  .header-badge::before {
    content: '';
    width: 6px;
    height: 6px;
    background: var(--cyan);
    border-radius: 50%;
    box-shadow: 0 0 6px var(--cyan);
    animation: pulse 2s infinite;
  }

  .title {
    font-size: clamp(28px, 5vw, 48px);
    font-weight: 700;
    background: linear-gradient(135deg, var(--cyan) 0%, var(--blue) 50%, var(--purple) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1.1;
    margin-bottom: 12px;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 15px;
    font-family: 'JetBrains Mono', monospace;
  }

  .subtitle span {
    color: var(--cyan);
  }

  /* GRID */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 16px;
  }

  .grid-bottom {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    margin-bottom: 48px;
  }

  /* CARD */
  .card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    cursor: pointer;
    transition: all 0.22s ease;
    text-decoration: none;
    color: inherit;
    display: block;
    position: relative;
    overflow: hidden;
    animation: fadeUp 0.5s ease both;
  }

  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.22s ease;
    border-radius: 12px;
  }

  .card:hover {
    border-color: var(--border-hover);
    transform: translateY(-3px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }

  .card:hover::before { opacity: 1; }

  /* Card color variants */
  .card-cyan::before { background: radial-gradient(ellipse at top left, rgba(57,208,240,0.06), transparent 60%); }
  .card-cyan:hover { border-color: rgba(57,208,240,0.4); box-shadow: 0 8px 32px rgba(57,208,240,0.1); }

  .card-green::before { background: radial-gradient(ellipse at top left, rgba(63,185,80,0.06), transparent 60%); }
  .card-green:hover { border-color: rgba(63,185,80,0.4); box-shadow: 0 8px 32px rgba(63,185,80,0.1); }

  .card-yellow::before { background: radial-gradient(ellipse at top left, rgba(210,153,34,0.06), transparent 60%); }
  .card-yellow:hover { border-color: rgba(210,153,34,0.4); box-shadow: 0 8px 32px rgba(210,153,34,0.1); }

  .card-blue::before { background: radial-gradient(ellipse at top left, rgba(88,166,255,0.06), transparent 60%); }
  .card-blue:hover { border-color: rgba(88,166,255,0.4); box-shadow: 0 8px 32px rgba(88,166,255,0.1); }

  .card-purple::before { background: radial-gradient(ellipse at top left, rgba(188,140,255,0.06), transparent 60%); }
  .card-purple:hover { border-color: rgba(188,140,255,0.4); box-shadow: 0 8px 32px rgba(188,140,255,0.1); }

  .card-nth-1 { animation-delay: 0.05s; }
  .card-nth-2 { animation-delay: 0.10s; }
  .card-nth-3 { animation-delay: 0.15s; }
  .card-nth-4 { animation-delay: 0.20s; }
  .card-nth-5 { animation-delay: 0.25s; }

  .card-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.06em;
    padding: 3px 9px;
    border-radius: 6px;
    margin-bottom: 14px;
    text-transform: uppercase;
  }

  .badge-json { background: var(--green-dim); color: var(--green); border: 1px solid rgba(63,185,80,0.2); }
  .badge-info { background: var(--yellow-dim); color: var(--yellow); border: 1px solid rgba(210,153,34,0.2); }
  .badge-stats { background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(88,166,255,0.2); }

  .badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .card-route {
    font-family: 'JetBrains Mono', monospace;
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card-route .icon { font-size: 22px; }

  .card-desc {
    color: var(--text-muted);
    font-size: 13.5px;
    line-height: 1.6;
  }

  /* STATS BAR */
  .stats-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 32px;
    margin-bottom: 48px;
    animation: fadeUp 0.5s 0.3s ease both;
    flex-wrap: wrap;
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .stat-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  .stat-dot.green { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .stat-dot.cyan { background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
  .stat-dot.yellow { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); }

  .stat-value { color: var(--text); font-weight: 600; font-family: 'JetBrains Mono', monospace; }

  /* FOOTER */
  .footer {
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
    animation: fadeUp 0.5s 0.35s ease both;
  }

  .footer a { color: var(--cyan); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }

  /* ANIMATIONS */
  @keyframes fadeDown {
    from { opacity: 0; transform: translateY(-20px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* RESPONSIVE */
  @media (max-width: 768px) {
    body { padding: 40px 16px 30px; }
    .grid { grid-template-columns: 1fr; }
    .grid-bottom { grid-template-columns: 1fr; }
    .stats-bar { gap: 16px; padding: 14px 20px; }
  }

  @media (min-width: 769px) and (max-width: 1024px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
    .grid-bottom { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<div class="container">

  <header class="header">
    <div class="header-badge">LIVE · SUNWIN API v3.0</div>
    <h1 class="title">API Tool Tài Xiu Sunwin</h1>
    <p class="subtitle">Được dev bởi <span>@sewdangcap</span></p>
  </header>

  <div class="stats-bar">
    <div class="stat-item">
      <span class="stat-dot green"></span>
      <span>WebSocket</span>
      <span class="stat-value">ONLINE</span>
    </div>
    <div class="stat-item">
      <span class="stat-dot cyan"></span>
      <span>AI Engine</span>
      <span class="stat-value">CT68 + Markov-3X</span>
    </div>
    <div class="stat-item">
      <span class="stat-dot yellow"></span>
      <span>Sub Algos</span>
      <span class="stat-value">11 Active</span>
    </div>
  </div>

  <div class="grid">
    <a class="card card-cyan card-nth-1" href="/sunlon" target="_blank">
      <div class="card-badge badge-json"><span class="badge-dot"></span>JSON</div>
      <div class="card-route"><span class="icon">⚡</span>/sunlon</div>
      <div class="card-desc">Dự đoán phiên tiếp theo — JSON realtime kết hợp CT68GB + Markov-3X</div>
    </a>

    <a class="card card-green card-nth-2" href="/api/taixiu/history" target="_blank">
      <div class="card-badge badge-json"><span class="badge-dot"></span>JSON</div>
      <div class="card-route"><span class="icon">📋</span>/history</div>
      <div class="card-desc">Lịch sử 50 phiên gần nhất với tổng điểm xúc xắc và kết quả</div>
    </a>

    <a class="card card-yellow card-nth-3" href="/thangthua" target="_blank">
      <div class="card-badge badge-stats"><span class="badge-dot"></span>STATS</div>
      <div class="card-route"><span class="icon">📊</span>/thangthua</div>
      <div class="card-desc">Thống kê thắng / thua — Win rate, tổng win/lose từng phiên</div>
    </a>
  </div>

  <div class="grid-bottom">
    <a class="card card-blue card-nth-4" href="/api/taixiu/ct68" target="_blank">
      <div class="card-badge badge-json"><span class="badge-dot"></span>JSON</div>
      <div class="card-route"><span class="icon">🃏</span>/ct68</div>
      <div class="card-desc">Phân tích Công Thức 68GB — 15 quy tắc bàn xanh realtime</div>
    </a>

    <a class="card card-purple card-nth-5" href="/id" target="_blank">
      <div class="card-badge badge-info"><span class="badge-dot"></span>INFO</div>
      <div class="card-route"><span class="icon">👤</span>/id</div>
      <div class="card-desc">Thông tin dev &amp; liên hệ Telegram @sewdangcap</div>
    </a>
  </div>

  <footer class="footer">
    <p>© 2025 DEV <a href="https://t.me/sewdangcap" target="_blank">@sewdangcap</a> — All rights reserved</p>
  </footer>

</div>
</body>
</html>`;

// ============================================================
// --- API ENDPOINTS ---
// ============================================================

// Landing page HTML
app.get('/', (req, res) => {
    const accept = req.headers['accept'] || '';
    if (accept.includes('text/html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(HTML_PAGE);
    }
    res.json(apiResponseData);
});

// Main prediction endpoint - format mới
app.get('/sunlon', (req, res) => res.json(apiResponseData));

// Lịch sử phiên
app.get('/api/taixiu/history', (req, res) => {
    if (!rikResults.length) return res.json({ message: "chưa có dữ liệu" });
    res.json(rikResults.slice(0, 30).map(r => ({
        session: r.session, dice: r.dice, total: r.total,
        ket_qua: r.total >= 11 ? 'Tài' : 'Xỉu'
    })));
});

// Alias /history
app.get('/history', (req, res) => {
    if (!rikResults.length) return res.json({ message: "chưa có dữ liệu" });
    res.json(rikResults.slice(0, 30).map(r => ({
        session: r.session, dice: r.dice, total: r.total,
        ket_qua: r.total >= 11 ? 'Tài' : 'Xỉu'
    })));
});

// Thống kê thắng/thua
app.get('/thangthua', (req, res) => {
    const winRate = winLoseStats.total > 0 ? (winLoseStats.wins / winLoseStats.total * 100).toFixed(1) + '%' : 'N/A';
    res.json({
        tong_phien: winLoseStats.total,
        thang: winLoseStats.wins,
        thua: winLoseStats.losses,
        win_rate: winRate,
        lich_su: winLoseStats.history.slice(0, 20),
        id: "@sewdangcap"
    });
});

// ID / Info
app.get('/id', (req, res) => res.json({
    dev: "@sewdangcap",
    telegram: "https://t.me/sewdangcap",
    version: "SUN AI v3.0",
    engine: "CT68GB + Markov-3X + 11 SubAlgos",
    endpoints: ["/sunlon", "/history", "/thangthua", "/ct68", "/id"]
}));

// CT68 endpoint
app.get('/api/taixiu/ct68', (req, res) => {
    if (ai.history.length < 3) return res.json({ message: "chưa đủ dữ liệu" });
    const ct68 = congThuc68GB(ai.history);
    const totals = ai.history.slice(-8).map(h => h.total).join(' → ');
    res.json({
        ten: "Công Thức 68GB Bàn Xanh",
        lich_su_tong: totals,
        ket_qua: ct68 ? { quy_tac: ct68.rule, mo_ta: ct68.moTa, du_doan: ct68.duDoan === 'T' ? 'Tài' : 'Xỉu', do_tin_cay: `${(ct68.doTinCay * 100).toFixed(0)}%` } : { mo_ta: "Không khớp quy tắc nào", du_doan: null }
    });
});

// Alias /ct68
app.get('/ct68', (req, res) => {
    if (ai.history.length < 3) return res.json({ message: "chưa đủ dữ liệu" });
    const ct68 = congThuc68GB(ai.history);
    res.json(ct68 ? { quy_tac: ct68.rule, mo_ta: ct68.moTa, du_doan: ct68.duDoan === 'T' ? 'Tài' : 'Xỉu', do_tin_cay: `${(ct68.doTinCay * 100).toFixed(0)}%` } : { mo_ta: "Không khớp quy tắc nào" });
});

app.get('/api/taixiu/ai-stats', (req, res) => {
    const prediction = ai.predict();
    res.json({ status: "online", ai_version: "CauAnalysis v3.0 + CT68GB + Markov-3X + 11 SubAlgos", current_prediction: prediction.prediction, confidence: `${(prediction.confidence * 100).toFixed(1)}%`, loai_cau: prediction.cauInfo?.loaiCau || "N/A", sub_algos_active: prediction.activeSubAlgos, sub_algo_stats: ai.getStats() });
});

app.get('/api/token-status', (req, res) => {
    const timeLeft = tokenExpiry ? tokenExpiry - Date.now() : 0;
    res.json({ status: timeLeft > 0 ? "valid" : "expired", expires_at: tokenExpiry ? new Date(tokenExpiry).toLocaleString('vi-VN') : "unknown", minutes_remaining: Math.floor(timeLeft / 60000), username: ACCOUNT.username });
});

// ============================================================
// --- KHỞI ĐỘNG ---
// ============================================================
app.listen(PORT, () => {
    console.log(`====================================`);
    console.log(`🚀 SUN AI Server v3.0 - Port: ${PORT}`);
    console.log(`   Tài khoản  : ${ACCOUNT.username}`);
    console.log(`   Công thức  : CT68GB (15 quy tắc)`);
    console.log(`   Sub Algos  : 11 (Markov-3X)`);
    console.log(`   Landing    : GET / → HTML`);
    console.log(`   Endpoints  : /sunlon /history /thangthua /ct68 /id`);
    console.log(`====================================`);
    startTokenWatcher();
    connectWebSocket();
});
