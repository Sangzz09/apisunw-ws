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
let currentSessionId = null;
let apiResponseData = {
    "phien": null, "xuc_xac": [], "phien_hien_tai": null,
    "du_doan": "đang tính...", "do_tin_cay": "50%",
    "loai_cau": "đang thu thập...", "pattern": "",
    "chi_tiet_cau": {}, "dev": "@sewdangcap"
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
// --- PHÂN TÍCH CẦU CHUYÊN SÂU ---
// ============================================================

/**
 * Phát hiện toàn bộ loại cầu từ chuỗi T/X
 * Trả về object chi tiết loại cầu đang chạy
 */
function phanTichCau(tx) {
    if (tx.length < 5) return { loaiCau: 'Chưa đủ dữ liệu', duDoan: null, doTinCay: 0.5 };

    const results = [];

    // --- 1. CẦU BỆT (streak liên tiếp) ---
    const cauBet = phatHienCauBet(tx);
    if (cauBet) results.push(cauBet);

    // --- 2. CẦU 1-1 (zigzag xen kẽ) ---
    const cau11 = phatHienCau11(tx);
    if (cau11) results.push(cau11);

    // --- 3. CẦU 2-2, 3-3, N-N (nhóm đều) ---
    const cauNhom = phatHienCauNhom(tx);
    if (cauNhom) results.push(cauNhom);

    // --- 4. CẦU PHỨC (2-1, 3-1, 1-2, v.v.) ---
    const cauPhuc = phatHienCauPhuc(tx);
    if (cauPhuc) results.push(cauPhuc);

    // --- 5. CẦU LỆCH (T hoặc X áp đảo) ---
    const cauLech = phatHienCauLech(tx);
    if (cauLech) results.push(cauLech);

    // --- 6. CẦU ĐẢO (sau chuỗi dài đổi chiều) ---
    const cauDao = phatHienCauDao(tx);
    if (cauDao) results.push(cauDao);

    // --- 7. CẦU SÓNG (tăng giảm luân phiên theo nhịp) ---
    const cauSong = phatHienCauSong(tx);
    if (cauSong) results.push(cauSong);

    // --- 8. CẦU TUẦN HOÀN (chu kỳ lặp lại) ---
    const cauTuanHoan = phatHienCauTuanHoan(tx);
    if (cauTuanHoan) results.push(cauTuanHoan);

    // --- 9. CẦU ĐỘT PHÁ (phá vỡ cầu cũ) ---
    const cauDotPha = phatHienCauDotPha(tx);
    if (cauDotPha) results.push(cauDotPha);

    // --- 10. CẦU ĐỐI XỨNG ---
    const cauDoiXung = phatHienCauDoiXung(tx);
    if (cauDoiXung) results.push(cauDoiXung);

    if (results.length === 0) {
        return { loaiCau: 'Hỗn loạn', duDoan: duDoanTheoThongKe(tx), doTinCay: 0.52 };
    }

    // Chọn cầu có độ tin cậy cao nhất
    results.sort((a, b) => b.doTinCay - a.doTinCay);
    return results[0];
}

// --------------------------------
// CẦU BỆT: TTTT... hoặc XXXX...
// --------------------------------
function phatHienCauBet(tx) {
    const last = tx[tx.length - 1];
    let streak = 1;
    for (let i = tx.length - 2; i >= 0; i--) {
        if (tx[i] === last) streak++;
        else break;
    }

    if (streak < 2) return null;

    // Phân tích lịch sử cầu bệt để xem thường dài bao nhiêu
    const betHistory = [];
    let cur = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === tx[i - 1]) cur++;
        else { betHistory.push(cur); cur = 1; }
    }
    betHistory.push(cur);

    const avgBetLen = betHistory.length > 3
        ? betHistory.slice(-10).reduce((a, b) => a + b, 0) / Math.min(betHistory.length, 10)
        : 3;

    // Xác suất tiếp tục hay đảo dựa trên độ dài trung bình
    let duDoan, doTinCay, moTa;
    if (streak >= avgBetLen + 1) {
        // Vượt quá trung bình → có thể đảo
        duDoan = last === 'T' ? 'X' : 'T';
        doTinCay = Math.min(0.75, 0.55 + (streak - avgBetLen) * 0.04);
        moTa = `Cầu bệt ${last === 'T' ? 'Tài' : 'Xỉu'} ${streak} (>TB ${avgBetLen.toFixed(1)}) → Sắp đảo`;
    } else if (streak >= 4) {
        // Cầu bệt dài → khả năng break tăng
        duDoan = last === 'T' ? 'X' : 'T';
        doTinCay = 0.58 + streak * 0.02;
        moTa = `Cầu bệt dài ${streak} → Nghiêng đảo`;
    } else {
        // Cầu bệt ngắn → tiếp tục
        duDoan = last;
        doTinCay = 0.55 + streak * 0.03;
        moTa = `Cầu bệt ${last === 'T' ? 'Tài' : 'Xỉu'} ${streak} → Tiếp tục`;
    }

    return {
        loaiCau: `Cầu Bệt-${streak}`,
        moTa,
        duDoan,
        doTinCay: Math.min(0.82, doTinCay),
        streak,
        avgBetLen: avgBetLen.toFixed(1)
    };
}

// --------------------------------
// CẦU 1-1: TXTXTX hoặc XTXTXT
// --------------------------------
function phatHienCau11(tx) {
    const recent = tx.slice(-10);
    let zigzagLen = 1;
    for (let i = recent.length - 2; i >= 0; i--) {
        if (recent[i] !== recent[i + 1]) zigzagLen++;
        else break;
    }

    if (zigzagLen < 4) return null;

    const last = recent[recent.length - 1];
    // Zigzag → đảo liên tục
    const duDoan = last === 'T' ? 'X' : 'T';

    return {
        loaiCau: `Cầu 1-1 (Xen kẽ)`,
        moTa: `Cầu 1-1 dài ${zigzagLen} phiên → Tiếp tục xen kẽ`,
        duDoan,
        doTinCay: Math.min(0.80, 0.60 + zigzagLen * 0.025),
        zigzagLen
    };
}

// --------------------------------
// CẦU N-N: 2-2, 3-3, 4-4...
// --------------------------------
function phatHienCauNhom(tx) {
    // Tách thành các nhóm liên tiếp
    const groups = [];
    let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur.val) cur.len++;
        else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; }
    }
    groups.push(cur);

    if (groups.length < 4) return null;

    // Lấy 6 nhóm gần nhất
    const recentGroups = groups.slice(-6);
    const lens = recentGroups.map(g => g.len);

    // Kiểm tra 2-2
    if (lens.slice(-4).every(l => l === 2)) {
        const last = tx[tx.length - 1];
        const posInGroup = lens[lens.length - 1];
        const curGroupLen = recentGroups[recentGroups.length - 1].len;
        if (curGroupLen < 2) {
            return { loaiCau: 'Cầu 2-2', moTa: 'Cầu 2-2 → Tiếp tục', duDoan: last, doTinCay: 0.70, nhom: '2-2' };
        } else {
            const nextVal = last === 'T' ? 'X' : 'T';
            return { loaiCau: 'Cầu 2-2', moTa: 'Cầu 2-2 → Đảo nhóm', duDoan: nextVal, doTinCay: 0.72, nhom: '2-2' };
        }
    }

    // Kiểm tra 3-3
    if (lens.slice(-4).every(l => l === 3)) {
        const last = tx[tx.length - 1];
        const curGroup = recentGroups[recentGroups.length - 1];
        if (curGroup.len < 3) {
            return { loaiCau: 'Cầu 3-3', moTa: 'Cầu 3-3 → Tiếp tục', duDoan: last, doTinCay: 0.72, nhom: '3-3' };
        } else {
            return { loaiCau: 'Cầu 3-3', moTa: 'Cầu 3-3 → Đảo nhóm', duDoan: last === 'T' ? 'X' : 'T', doTinCay: 0.73, nhom: '3-3' };
        }
    }

    // Kiểm tra N-N tổng quát
    const recentLens = lens.slice(-4);
    const allSame = recentLens.every(l => l === recentLens[0]);
    if (allSame && recentLens[0] >= 2) {
        const n = recentLens[0];
        const last = tx[tx.length - 1];
        const curGroup = recentGroups[recentGroups.length - 1];
        const loai = `Cầu ${n}-${n}`;
        if (curGroup.len < n) {
            return { loaiCau: loai, moTa: `${loai} → Tiếp tục (còn ${n - curGroup.len})`, duDoan: last, doTinCay: 0.68, nhom: `${n}-${n}` };
        } else {
            return { loaiCau: loai, moTa: `${loai} → Đảo nhóm`, duDoan: last === 'T' ? 'X' : 'T', doTinCay: 0.70, nhom: `${n}-${n}` };
        }
    }

    // Cầu tăng dần: 1-2-3-4
    if (lens.length >= 4) {
        const last4 = lens.slice(-4);
        let increasing = true, decreasing = true;
        for (let i = 1; i < last4.length; i++) {
            if (last4[i] <= last4[i-1]) increasing = false;
            if (last4[i] >= last4[i-1]) decreasing = false;
        }
        if (increasing) {
            const last = tx[tx.length - 1];
            const curLen = recentGroups[recentGroups.length - 1].len;
            const expectedLen = last4[last4.length - 1];
            if (curLen < expectedLen) {
                return { loaiCau: 'Cầu Tăng Dần', moTa: `Cầu tăng dần → Tiếp tục`, duDoan: last, doTinCay: 0.65, nhom: 'tang-dan' };
            } else {
                return { loaiCau: 'Cầu Tăng Dần', moTa: `Cầu tăng dần → Nhóm mới`, duDoan: last === 'T' ? 'X' : 'T', doTinCay: 0.63, nhom: 'tang-dan' };
            }
        }
        if (decreasing) {
            const last = tx[tx.length - 1];
            const curLen = recentGroups[recentGroups.length - 1].len;
            const expectedLen = last4[last4.length - 1];
            if (curLen < expectedLen) {
                return { loaiCau: 'Cầu Giảm Dần', moTa: `Cầu giảm dần → Tiếp tục`, duDoan: last, doTinCay: 0.63, nhom: 'giam-dan' };
            } else {
                return { loaiCau: 'Cầu Giảm Dần', moTa: `Cầu giảm dần → Nhóm mới`, duDoan: last === 'T' ? 'X' : 'T', doTinCay: 0.62, nhom: 'giam-dan' };
            }
        }
    }

    return null;
}

// --------------------------------
// CẦU PHỨC: 2-1, 3-1, 1-2, 3-2...
// --------------------------------
function phatHienCauPhuc(tx) {
    const groups = [];
    let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur.val) cur.len++;
        else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; }
    }
    groups.push(cur);

    if (groups.length < 6) return null;

    // Lấy pattern nhóm
    const recentGroups = groups.slice(-8);
    const lens = recentGroups.map(g => g.len);

    // Kiểm tra pattern 2-1 lặp lại
    const patterns = [
        { name: '2-1', seq: [2, 1] },
        { name: '1-2', seq: [1, 2] },
        { name: '3-1', seq: [3, 1] },
        { name: '1-3', seq: [1, 3] },
        { name: '2-3', seq: [2, 3] },
        { name: '3-2', seq: [3, 2] },
        { name: '1-1-2', seq: [1, 1, 2] },
        { name: '2-1-1', seq: [2, 1, 1] },
        { name: '1-2-1', seq: [1, 2, 1] },
        { name: '2-2-1', seq: [2, 2, 1] },
        { name: '1-2-2', seq: [1, 2, 2] },
        { name: '3-1-2', seq: [3, 1, 2] },
        { name: '2-1-3', seq: [2, 1, 3] },
    ];

    for (const pat of patterns) {
        const pLen = pat.seq.length;
        if (lens.length < pLen * 2) continue;

        // Kiểm tra xem pLen nhóm cuối có khớp với pattern không
        let matches = 0;
        for (let i = 0; i <= lens.length - pLen; i += pLen) {
            const slice = lens.slice(i, i + pLen);
            if (slice.length === pLen && slice.every((v, j) => v === pat.seq[j])) matches++;
        }

        if (matches >= 2) {
            const curGroup = recentGroups[recentGroups.length - 1];
            const posInPattern = (recentGroups.length - 1) % pLen;
            const expectedLen = pat.seq[posInPattern];
            const last = tx[tx.length - 1];

            if (curGroup.len < expectedLen) {
                // Vẫn trong nhóm → tiếp tục
                return {
                    loaiCau: `Cầu ${pat.name}`,
                    moTa: `Cầu ${pat.name} lặp ${matches}x → Tiếp tục (${curGroup.len}/${expectedLen})`,
                    duDoan: last,
                    doTinCay: Math.min(0.78, 0.60 + matches * 0.04),
                    pattern: pat.name
                };
            } else {
                // Kết thúc nhóm → sang nhóm mới
                return {
                    loaiCau: `Cầu ${pat.name}`,
                    moTa: `Cầu ${pat.name} lặp ${matches}x → Đảo sang nhóm mới`,
                    duDoan: last === 'T' ? 'X' : 'T',
                    doTinCay: Math.min(0.78, 0.62 + matches * 0.04),
                    pattern: pat.name
                };
            }
        }
    }
    return null;
}

// --------------------------------
// CẦU LỆCH: T hoặc X áp đảo (>65%)
// --------------------------------
function phatHienCauLech(tx) {
    const windows = [
        { n: 10, weight: 0.5 },
        { n: 20, weight: 0.3 },
        { n: 30, weight: 0.2 }
    ];

    let tScore = 0, xScore = 0;
    for (const { n, weight } of windows) {
        if (tx.length < n) continue;
        const slice = tx.slice(-n);
        const tRate = slice.filter(v => v === 'T').length / n;
        tScore += tRate * weight;
        xScore += (1 - tRate) * weight;
    }

    const total = tScore + xScore;
    if (total === 0) return null;
    const tRate = tScore / total;

    if (tRate >= 0.68) {
        return {
            loaiCau: 'Cầu Lệch Tài',
            moTa: `Tài áp đảo ${(tRate * 100).toFixed(0)}% → Bắt cầu Tài`,
            duDoan: 'T',
            doTinCay: Math.min(0.72, 0.55 + (tRate - 0.5) * 0.6)
        };
    }
    if (tRate <= 0.32) {
        return {
            loaiCau: 'Cầu Lệch Xỉu',
            moTa: `Xỉu áp đảo ${((1 - tRate) * 100).toFixed(0)}% → Bắt cầu Xỉu`,
            duDoan: 'X',
            doTinCay: Math.min(0.72, 0.55 + (0.5 - tRate) * 0.6)
        };
    }
    return null;
}

// --------------------------------
// CẦU ĐẢO: Sau cầu bệt dài → đảo chiều
// --------------------------------
function phatHienCauDao(tx) {
    if (tx.length < 15) return null;

    const groups = [];
    let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur.val) cur.len++;
        else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; }
    }
    groups.push(cur);

    if (groups.length < 3) return null;

    const lastGroup = groups[groups.length - 1];
    const prevGroup = groups[groups.length - 2];

    // Vừa đảo chiều sau cầu dài
    if (prevGroup.len >= 4 && lastGroup.len <= 2) {
        const last = tx[tx.length - 1];
        // Giai đoạn đầu đảo → theo dõi xem cầu mới hình thành
        if (lastGroup.len === 1) {
            // Mới đảo 1 bước → chờ xem
            return {
                loaiCau: 'Cầu Đảo Chiều',
                moTa: `Vừa đảo chiều sau cầu ${prevGroup.len} → Cầu mới đang hình thành`,
                duDoan: last,
                doTinCay: 0.58
            };
        }
        return {
            loaiCau: 'Cầu Đảo Chiều',
            moTa: `Đảo chiều xác nhận → Tiếp tục ${last === 'T' ? 'Tài' : 'Xỉu'}`,
            duDoan: last,
            doTinCay: 0.65
        };
    }

    return null;
}

// --------------------------------
// CẦU SÓNG: nhịp tăng-giảm đều đặn
// --------------------------------
function phatHienCauSong(tx) {
    if (tx.length < 20) return null;

    const groups = [];
    let cur = { val: tx[0], len: 1 };
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur.val) cur.len++;
        else { groups.push({ ...cur }); cur = { val: tx[i], len: 1 }; }
    }
    groups.push(cur);

    if (groups.length < 6) return null;

    const lens = groups.slice(-6).map(g => g.len);

    // Sóng tăng-giảm xen kẽ
    let isWave = true;
    for (let i = 1; i < lens.length - 1; i++) {
        const prevDir = Math.sign(lens[i] - lens[i-1]);
        const nextDir = Math.sign(lens[i+1] - lens[i]);
        if (prevDir === 0 || nextDir === 0 || prevDir === nextDir) { isWave = false; break; }
    }

    if (!isWave) return null;

    const last = tx[tx.length - 1];
    const curGroup = groups[groups.length - 1];
    const prevGroupLen = groups[groups.length - 2]?.len || 1;
    const prevPrevGroupLen = groups[groups.length - 3]?.len || 1;

    // Dự đoán chiều dài nhóm tiếp theo
    const trendDir = prevGroupLen > prevPrevGroupLen ? 'giam' : 'tang';
    const expectedLen = trendDir === 'giam'
        ? Math.max(1, prevGroupLen - (prevPrevGroupLen - prevGroupLen))
        : prevGroupLen + (prevGroupLen - prevPrevGroupLen);

    if (curGroup.len < Math.max(1, expectedLen)) {
        return {
            loaiCau: 'Cầu Sóng',
            moTa: `Cầu sóng → Tiếp tục (${curGroup.len}/${expectedLen})`,
            duDoan: last,
            doTinCay: 0.65
        };
    } else {
        return {
            loaiCau: 'Cầu Sóng',
            moTa: `Cầu sóng → Chuyển nhóm`,
            duDoan: last === 'T' ? 'X' : 'T',
            doTinCay: 0.65
        };
    }
}

// --------------------------------
// CẦU TUẦN HOÀN: chu kỳ cố định
// --------------------------------
function phatHienCauTuanHoan(tx) {
    if (tx.length < 24) return null;

    const str = tx.join('');

    // Tìm chu kỳ lặp ngắn nhất khớp nhiều lần
    for (let cycleLen = 2; cycleLen <= 8; cycleLen++) {
        const candidate = str.slice(-cycleLen);
        let matches = 0;
        for (let i = 0; i <= str.length - cycleLen * 2; i++) {
            if (str.slice(i, i + cycleLen) === candidate) matches++;
        }

        if (matches >= 3) {
            // Tìm vị trí trong chu kỳ
            const posInCycle = (tx.length % cycleLen);
            const nextPosInCycle = posInCycle % cycleLen;

            // Dự đoán dựa trên chu kỳ phổ biến nhất
            const votes = { T: 0, X: 0 };
            for (let i = nextPosInCycle; i < str.length; i += cycleLen) {
                if (str[i]) votes[str[i]]++;
            }

            const total = votes.T + votes.X;
            if (total < 2) continue;

            const winner = votes.T > votes.X ? 'T' : 'X';
            const conf = Math.max(votes.T, votes.X) / total;

            if (conf >= 0.65) {
                return {
                    loaiCau: `Cầu Tuần Hoàn-${cycleLen}`,
                    moTa: `Chu kỳ ${cycleLen} phiên lặp ${matches}x → ${winner === 'T' ? 'Tài' : 'Xỉu'}`,
                    duDoan: winner,
                    doTinCay: Math.min(0.78, 0.55 + conf * 0.3 + matches * 0.02),
                    cycleLen,
                    matches
                };
            }
        }
    }
    return null;
}

// --------------------------------
// CẦU ĐỘT PHÁ: nhận diện phá vỡ cầu cũ
// --------------------------------
function phatHienCauDotPha(tx) {
    if (tx.length < 20) return null;

    const recent5 = tx.slice(-5);
    const prev10 = tx.slice(-15, -5);

    // Kiểm tra xem 5 phiên gần nhất có khác biệt đột ngột với 10 phiên trước không
    const recentTRate = recent5.filter(v => v === 'T').length / 5;
    const prevTRate = prev10.filter(v => v === 'T').length / 10;

    const shift = Math.abs(recentTRate - prevTRate);

    if (shift >= 0.35) {
        // Đột phá rõ ràng → theo xu hướng mới
        const newTrend = recentTRate > prevTRate ? 'T' : 'X';
        return {
            loaiCau: 'Cầu Đột Phá',
            moTa: `Đột phá xu hướng (shift ${(shift * 100).toFixed(0)}%) → Theo ${newTrend === 'T' ? 'Tài' : 'Xỉu'}`,
            duDoan: newTrend,
            doTinCay: Math.min(0.68, 0.55 + shift * 0.4)
        };
    }
    return null;
}

// --------------------------------
// CẦU ĐỐI XỨNG: TTXX-XXTT, TXXT...
// --------------------------------
function phatHienCauDoiXung(tx) {
    if (tx.length < 16) return null;

    const recent = tx.slice(-16);
    const half = 8;
    const left = recent.slice(0, half).join('');
    const right = recent.slice(half).join('');

    // Kiểm tra đối xứng gương
    const mirror = left.split('').reverse().map(c => c === 'T' ? 'X' : 'T').join('');

    let matchCount = 0;
    for (let i = 0; i < half; i++) {
        if (right[i] === mirror[i]) matchCount++;
    }

    if (matchCount / half >= 0.75) {
        const last = tx[tx.length - 1];
        // Dự đoán dựa trên đối xứng
        const posFromCenter = tx.length % (half * 2);
        const mirrorPos = half * 2 - 1 - posFromCenter;
        const mirrorVal = tx[tx.length - mirrorPos] === 'T' ? 'X' : 'T';

        return {
            loaiCau: 'Cầu Đối Xứng',
            moTa: `Cầu đối xứng (${(matchCount / half * 100).toFixed(0)}% khớp) → ${mirrorVal === 'T' ? 'Tài' : 'Xỉu'}`,
            duDoan: mirrorVal,
            doTinCay: 0.60 + (matchCount / half - 0.75) * 0.5
        };
    }
    return null;
}

// --------------------------------
// DỰ ĐOÁN THEO THỐNG KÊ (fallback)
// --------------------------------
function duDoanTheoThongKe(tx) {
    if (tx.length < 5) return 'T';
    const recent = tx.slice(-10);
    const tCount = recent.filter(v => v === 'T').length;
    return tCount >= 5 ? 'T' : 'X';
}

// ============================================================
// --- AI CORE V2 ---
// ============================================================
class AdvancedAI {
    constructor() {
        this.history = [];
        this.algoPerf = {};
        this.lastPreds = {};

        // Danh sách thuật toán phụ trợ (mỗi cái trả về { id, vote: 'T'|'X'|null, weight })
        this.subAlgos = [
            { id: 'markov2',   fn: this._markov2.bind(this),   name: 'Markov-2', weight: 1.0 },
            { id: 'markov3',   fn: this._markov3.bind(this),   name: 'Markov-3', weight: 1.0 },
            { id: 'ema_bias',  fn: this._emaBias.bind(this),   name: 'EMA Bias', weight: 1.0 },
            { id: 'rsi',       fn: this._rsiSignal.bind(this), name: 'RSI Signal', weight: 1.0 },
            { id: 'bollinger', fn: this._bollinger.bind(this), name: 'Bollinger', weight: 1.0 },
            { id: 'momentum',  fn: this._momentum.bind(this),  name: 'Momentum', weight: 1.0 },
            { id: 'mean_rev',  fn: this._meanReversion.bind(this), name: 'Mean Rev', weight: 1.0 },
            { id: 'dice_dist', fn: this._diceDist.bind(this),  name: 'Dice Dist', weight: 1.0 },
            { id: 'neural',    fn: this._neuralSeq.bind(this), name: 'Neural Seq', weight: 1.0 },
            { id: 'bayesian',  fn: this._bayesian.bind(this),  name: 'Bayesian', weight: 1.0 },
        ];

        this.subAlgos.forEach(a => {
            this.algoPerf[a.id] = { correct: 0, total: 0, recent: [], streak: 0 };
            this.lastPreds[a.id] = null;
        });
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
            const perf = this.algoPerf[a.id];
            const pred = this.lastPreds[a.id];
            if (!pred) return;
            const correct = pred === actualTx;
            perf.correct += correct ? 1 : 0;
            perf.total++;
            perf.streak = correct ? perf.streak + 1 : 0;
            perf.recent.push(correct ? 1 : 0);
            if (perf.recent.length > 15) perf.recent.shift();
            if (perf.total >= 20) {
                const acc = perf.correct / perf.total;
                const recAcc = perf.recent.reduce((a, b) => a + b, 0) / perf.recent.length;
                // Weight tự điều chỉnh: ưu tiên accuracy gần đây
                a.weight = Math.max(0.05, Math.min(2.5,
                    (acc * 0.5 + recAcc * 0.4 + Math.min(perf.streak, 5) * 0.02) * 2.0
                ));
            }
        });
        this.subAlgos.forEach(a => { this.lastPreds[a.id] = null; });
    }

    predict() {
        const tx = this.history.map(h => h.tx);
        if (tx.length < 10) {
            return { prediction: 'Tài', rawPrediction: 'T', confidence: 0.5, cauInfo: null, detail: 'Chưa đủ dữ liệu' };
        }

        // === BƯỚC 1: PHÂN TÍCH CẦU CHUYÊN SÂU ===
        const cauResult = phanTichCau(tx);
        const cauWeight = 2.5; // Cầu có trọng số cao nhất

        // === BƯỚC 2: CÁC THUẬT TOÁN PHỤ TRỢ ===
        const subVotes = { T: 0, X: 0 };
        let activeSubAlgos = 0;
        this.subAlgos.forEach(a => {
            try {
                const v = a.fn(this.history);
                if (v === 'T' || v === 'X') {
                    subVotes[v] += a.weight;
                    activeSubAlgos++;
                    this.lastPreds[a.id] = v;
                }
            } catch (_) {}
        });

        // === BƯỚC 3: KẾT HỢP ===
        const finalVotes = { T: 0, X: 0 };

        // Phiếu từ phân tích cầu
        if (cauResult.duDoan === 'T' || cauResult.duDoan === 'X') {
            finalVotes[cauResult.duDoan] += cauWeight * cauResult.doTinCay;
        }

        // Phiếu từ các thuật toán phụ
        const subTotal = subVotes.T + subVotes.X;
        if (subTotal > 0) {
            finalVotes['T'] += (subVotes.T / subTotal) * 1.5;
            finalVotes['X'] += (subVotes.X / subTotal) * 1.5;
        }

        const grandTotal = finalVotes.T + finalVotes.X;
        const final = finalVotes.T >= finalVotes.X ? 'T' : 'X';
        const rawConf = Math.max(finalVotes.T, finalVotes.X) / grandTotal;

        // Điều chỉnh confidence dựa trên sự đồng thuận
        const cauAgrees = cauResult.duDoan === final;
        const subConsensus = final === 'T' ? subVotes.T / (subTotal || 1) : subVotes.X / (subTotal || 1);

        let confidence = rawConf * 0.6 + subConsensus * 0.25 + (cauAgrees ? 0.1 : 0) + cauResult.doTinCay * 0.05;
        confidence = Math.max(0.51, Math.min(0.95, confidence));

        return {
            prediction: final === 'T' ? 'Tài' : 'Xỉu',
            rawPrediction: final,
            confidence,
            cauInfo: cauResult,
            activeSubAlgos,
            detail: cauResult.moTa || 'N/A'
        };
    }

    loadHistory(arr) {
        this.history = arr.map(parseRecord).sort((a, b) => a.session - b.session);
        console.log(`📊 Đã tải ${this.history.length} lịch sử vào AI`);
    }

    getPatternString(len = 25) {
        return this.history.slice(-len).map(h => h.tx).join('');
    }

    getStats() {
        const stats = {};
        this.subAlgos.forEach(a => {
            const p = this.algoPerf[a.id];
            if (p.total > 0) {
                stats[a.id] = {
                    name: a.name,
                    accuracy: (p.correct / p.total * 100).toFixed(1) + '%',
                    weight: a.weight.toFixed(2),
                    predictions: p.total
                };
            }
        });
        return stats;
    }

    // ===== SUB ALGORITHMS =====

    _markov2(history) {
        if (history.length < 20) return null;
        const tx = history.map(h => h.tx);
        const trans = {};
        for (let i = 0; i < tx.length - 1; i++) {
            const key = tx[i];
            if (!trans[key]) trans[key] = { T: 0, X: 0 };
            trans[key][tx[i+1]]++;
        }
        const last = tx[tx.length - 1];
        const t = trans[last];
        if (!t) return null;
        const total = t.T + t.X;
        if (total < 8) return null;
        if (t.T / total > 0.62) return 'T';
        if (t.X / total > 0.62) return 'X';
        return null;
    }

    _markov3(history) {
        if (history.length < 30) return null;
        const tx = history.map(h => h.tx);
        const trans = {};
        for (let i = 0; i < tx.length - 2; i++) {
            const key = tx[i] + tx[i+1];
            if (!trans[key]) trans[key] = { T: 0, X: 0 };
            trans[key][tx[i+2]]++;
        }
        const last2 = tx.slice(-2).join('');
        const t = trans[last2];
        if (!t) return null;
        const total = t.T + t.X;
        if (total < 5) return null;
        if (t.T / total > 0.65) return 'T';
        if (t.X / total > 0.65) return 'X';
        return null;
    }

    _emaBias(history) {
        if (history.length < 13) return null;
        const totals = history.map(h => h.total);
        const ema5 = calcEMA(totals, 5);
        const ema13 = calcEMA(totals, 13);
        if (ema5 > ema13 + 0.3) return 'T';
        if (ema5 < ema13 - 0.3) return 'X';
        return null;
    }

    _rsiSignal(history) {
        if (history.length < 14) return null;
        const tx = history.map(h => h.tx);
        let gains = 0, losses = 0;
        const slice = tx.slice(-14);
        for (let i = 1; i < slice.length; i++) {
            if (slice[i] === 'T' && slice[i-1] === 'X') gains++;
            else if (slice[i] === 'X' && slice[i-1] === 'T') losses++;
        }
        const rsi = losses === 0 ? 100 : 100 - (100 / (1 + gains / losses));
        if (rsi > 72) return 'X';
        if (rsi < 28) return 'T';
        if (rsi > 58) return 'T';
        if (rsi < 42) return 'X';
        return null;
    }

    _bollinger(history) {
        if (history.length < 20) return null;
        const totals = history.map(h => h.total).slice(-20);
        const mean = totals.reduce((a, b) => a + b, 0) / 20;
        const std = calcStdDev(totals);
        const last = totals[totals.length - 1];
        if (last >= mean + 1.8 * std) return 'X';
        if (last <= mean - 1.8 * std) return 'T';
        return null;
    }

    _momentum(history) {
        if (history.length < 12) return null;
        const totals = history.map(h => h.total);
        const n = totals.length;
        const mom5 = totals[n-1] - totals[n-6];
        const mom10 = totals[n-1] - totals[n-11];
        let t = 0, x = 0;
        if (mom5 > 1.5) t++; else if (mom5 < -1.5) x++;
        if (mom10 > 2) t++; else if (mom10 < -2) x++;
        if (t >= 2) return 'T';
        if (x >= 2) return 'X';
        return null;
    }

    _meanReversion(history) {
        if (history.length < 25) return null;
        const totals = history.map(h => h.total);
        const longMean = totals.slice(-25).reduce((a, b) => a + b, 0) / 25;
        const shortMean = totals.slice(-4).reduce((a, b) => a + b, 0) / 4;
        const std = calcStdDev(totals.slice(-25));
        const z = (shortMean - longMean) / (std || 1);
        if (z > 1.6) return 'X';
        if (z < -1.6) return 'T';
        return null;
    }

    _diceDist(history) {
        if (history.length < 60) return null;
        const theoretical = { 3:1,4:3,5:6,6:10,7:15,8:21,9:25,10:27,11:27,12:25,13:21,14:15,15:10,16:6,17:3,18:1 };
        const totalTheo = 216;
        const n = history.length;
        const dist = {};
        history.forEach(h => { dist[h.total] = (dist[h.total] || 0) + 1; });
        let taiExp = 0, xiuExp = 0, taiAct = 0, xiuAct = 0;
        for (let s = 3; s <= 18; s++) {
            const exp = (theoretical[s] || 0) / totalTheo * n;
            const act = dist[s] || 0;
            if (s >= 11) { taiExp += exp; taiAct += act; }
            else { xiuExp += exp; xiuAct += act; }
        }
        const taiR = taiAct / (taiExp || 1);
        const xiuR = xiuAct / (xiuExp || 1);
        if (xiuR < 0.85 && taiR > 1.08) return 'X';
        if (taiR < 0.85 && xiuR > 1.08) return 'T';
        return null;
    }

    _neuralSeq(history) {
        if (history.length < 45) return null;
        const tx = history.map(h => h.tx);
        const seqLen = 6;
        const lastSeq = tx.slice(-seqLen).join('');
        const votes = { T: 0, X: 0 };
        let count = 0;
        for (let i = 0; i <= tx.length - seqLen - 1; i++) {
            const seq = tx.slice(i, i + seqLen).join('');
            let sim = 0;
            for (let j = 0; j < seqLen; j++) if (seq[j] === lastSeq[j]) sim++;
            const simRate = sim / seqLen;
            if (simRate >= 0.70) {
                votes[tx[i + seqLen]] += simRate * simRate;
                count++;
            }
        }
        if (count < 3) return null;
        const total = votes.T + votes.X;
        if (votes.T / total > 0.63) return 'T';
        if (votes.X / total > 0.63) return 'X';
        return null;
    }

    _bayesian(history) {
        if (history.length < 15) return null;
        const tx = history.map(h => h.tx);
        let pT = 0.5, pX = 0.5;
        [5, 10, 15, 20, 30].forEach(w => {
            if (tx.length < w) return;
            const slice = tx.slice(-w);
            const tRate = slice.filter(v => v === 'T').length / w;
            const likT = 0.5 + (tRate - 0.5) * 0.55;
            const likX = 1 - likT;
            const norm = pT * likT + pX * likX;
            pT = (pT * likT) / norm;
            pX = (pX * likX) / norm;
        });
        if (pT > 0.65) return 'T';
        if (pX > 0.65) return 'X';
        return null;
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
            "info": JSON.stringify({
                ipAddress: "14.249.227.107", wsToken: currentToken,
                locale: "vi", userId: "8838533e-de43-4b8d-9503-621f4050534e",
                username: "GM_apivopnha", timestamp: Date.now(),
            }),
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
        getInitialMessages().forEach((msg, i) => {
            setTimeout(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }, i * 600);
        });
        pingInterval = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.ping(); }, PING_INTERVAL);
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
                refreshToken(); return;
            }

            if (cmd === 1008 && sid) currentSessionId = sid;

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
                const patternStr = ai.getPatternString(25);

                apiResponseData = {
                    "phien": String(session),
                    "xuc_xac": [d1, d2, d3],
                    "phien_hien_tai": session ? String(session + 1) : null,
                    "du_doan": prediction.prediction,
                    "do_tin_cay": `${(prediction.confidence * 100).toFixed(0)}%`,
                    "loai_cau": prediction.cauInfo?.loaiCau || "Hỗn loạn",
                    "mo_ta_cau": prediction.cauInfo?.moTa || "",
                    "pattern": patternStr,
                    "chi_tiet_cau": prediction.cauInfo || {},
                    "dev": "@sewdangcap"
                };

                console.log(`\n==============================================`);
                console.log(`📥 PHIÊN ${session}: ${total >= 11 ? 'Tài' : 'Xỉu'} (${total}) [${d1}-${d2}-${d3}]`);
                console.log(`🎯 PHÂN TÍCH CẦU: ${prediction.cauInfo?.loaiCau || 'Hỗn loạn'}`);
                console.log(`📝 CHI TIẾT: ${prediction.cauInfo?.moTa || 'N/A'}`);
                console.log(`🔮 DỰ ĐOÁN ${session ? session + 1 : '?'}: **${prediction.prediction.toUpperCase()}**`);
                console.log(`💯 ĐỘ TIN CẬY: ${(prediction.confidence * 100).toFixed(0)}%`);
                console.log(`🤖 SUB ALGOS: ${prediction.activeSubAlgos}/10`);
                console.log(`📊 PATTERN: ${patternStr}`);
            }

            if (payload.htr && Array.isArray(payload.htr)) {
                const history = payload.htr.map(i => ({
                    session: i.sid, dice: [i.d1, i.d2, i.d3], total: i.d1 + i.d2 + i.d3,
                })).filter(i => i.dice.every(d => d > 0));
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
// --- API ENDPOINTS ---
// ============================================================
app.get('/sunlon', (req, res) => res.json(apiResponseData));
app.get('/', (req, res) => res.json(apiResponseData));

app.get('/api/taixiu/history', (req, res) => {
    if (!rikResults.length) return res.json({ message: "chưa có dữ liệu" });
    res.json(rikResults.slice(0, 30).map(r => ({
        session: r.session, dice: r.dice, total: r.total,
        ket_qua: r.total >= 11 ? 'Tài' : 'Xỉu'
    })));
});

app.get('/api/taixiu/ai-stats', (req, res) => {
    const prediction = ai.predict();
    res.json({
        status: "online",
        ai_version: "CauAnalysis v2.0 + 10 SubAlgos",
        current_prediction: prediction.prediction,
        confidence: `${(prediction.confidence * 100).toFixed(1)}%`,
        loai_cau: prediction.cauInfo?.loaiCau || "N/A",
        mo_ta_cau: prediction.cauInfo?.moTa || "N/A",
        sub_algos_active: prediction.activeSubAlgos,
        sub_algo_stats: ai.getStats()
    });
});

app.get('/api/taixiu/cau-analysis', (req, res) => {
    const tx = ai.history.map(h => h.tx);
    if (tx.length < 10) return res.json({ message: "chưa đủ dữ liệu" });
    const result = phanTichCau(tx);
    res.json({
        loai_cau: result.loaiCau,
        mo_ta: result.moTa,
        du_doan: result.duDoan === 'T' ? 'Tài' : (result.duDoan === 'X' ? 'Xỉu' : 'Chưa rõ'),
        do_tin_cay: `${(result.doTinCay * 100).toFixed(0)}%`,
        chi_tiet: result,
        pattern_25: ai.getPatternString(25)
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
    console.log(`🚀 SUN AI Server v2.0 - Port: ${PORT}`);
    console.log(`   Tài khoản  : ${ACCOUNT.username}`);
    console.log(`   Cầu phân tích: 10 loại cầu`);
    console.log(`   Sub Algos  : 10 thuật toán`);
    console.log(`   Auto Token : ✅ BẬT`);
    console.log(`   Endpoints  : /sunlon | /api/taixiu/cau-analysis`);
    console.log(`====================================`);
    startTokenWatcher();
    connectWebSocket();
});
