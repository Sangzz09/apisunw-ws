const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const os = require('os');
const fs = require('fs');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;
const HISTORY_FILE = './history.json';

// ===== LOAD HISTORY TỪ FILE =====
let patternHistory = [];
try {
    if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        patternHistory = JSON.parse(raw);
        console.log(`[📂] Đã load ${patternHistory.length} phiên từ file`);
    }
} catch (e) {
    console.error('[❌] Lỗi load history:', e.message);
    patternHistory = [];
}

let apiResponseData = {
    "Phien": null,
    "Xuc_xac_1": null,
    "Xuc_xac_2": null,
    "Xuc_xac_3": null,
    "Tong": null,
    "Ket_qua": "",
    "id": "@sewdangcap",
    "server_time": new Date().toISOString(),
    "update_count": 0
};

// ===== SESSION MANAGEMENT =====
let currentSessionId = null;
let lastKnownSessionId = null;
let lastCommittedSessionId = null;
let sessionCounter = 0;

// Buffer chứa kết quả dice đang chờ sid
let pendingDiceResult = null;
const PENDING_DICE_TIMEOUT = 5000;

// ===== THEO DÕI PHIÊN BỊ MẤT =====
const seenSessions = new Set();
let missedSessionCount = 0;

// ===== CHỐNG TRÙNG: lưu các sid đã commit =====
const committedSessions = new Set();

// ===== WATCHDOG: phát hiện sid bị stuck =====
let sameSessionCount = 0;
let lastCheckedSid = null;

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";

const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://play.sun.win",
    "Accept-Language": "vi-VN,vi;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
};

const RECONNECT_DELAY = 2000;
const PING_INTERVAL = 25000;
const HEARTBEAT_INTERVAL = 5000;
const WATCHDOG_INTERVAL = 30000;   // kiểm tra mỗi 30 giây
const WATCHDOG_MAX_SAME = 4;       // sau 4 lần (2 phút) → reconnect

const KNOWN_CMDS = [1003, 1005, 1007, 1008, 1011, 10000, 10001];

const initialMessages = [
    [
        1,
        "MiniGame",
        "GM_apivopnhaan",
        "WangLin",
        {
            "info": "{\"ipAddress\":\"113.185.45.88\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJwbGFtYW1hIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzMxNDgxMTYyLCJhZmZJZCI6IkdFTVdJTiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzY2NDc0NzgwMDA2LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjExMy4xODUuNDUuODgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE4LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjZhOGI0ZDM4LTFlYzEtNDUxYi1hYTA1LWYyZDkwYWFhNGM1MCIsInJlZ1RpbWUiOjE3NjY0NzQ3NTEzOTEsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fYXBpdm9wbmhhYW4ifQ.YFOscbeojWNlRo7490BtlzkDGYmwVpnlgOoh04oCJy4\",\"locale\":\"vi\",\"userId\":\"6a8b4d38-1ec1-451b-aa05-f2d90aaa4c50\",\"username\":\"GM_apivopnhaan\",\"timestamp\":1766474780007,\"refreshToken\":\"63d5c9be0c494b74b53ba150d69039fd.7592f06d63974473b4aaa1ea849b2940\"}",
            "signature": "66772A1641AA8B18BD99207CE448EA00ECA6D8A4D457C1FF13AB092C22C8DECF0C0014971639A0FBA9984701A91FCCBE3056ABC1BE1541D1C198AA18AF3C45595AF6601F8B048947ADF8F48A9E3E074162F9BA3E6C0F7543D38BD54FD4C0A2C56D19716CC5353BBC73D12C3A92F78C833F4EFFDC4AB99E55C77AD2CDFA91E296"
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

const heartbeatMessage = [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }];

let ws = null;
let pingInterval = null;
let heartbeatInterval = null;
let watchdogInterval = null;
let reconnectTimeout = null;
let pendingDiceTimer = null;
let wsConnectedAt = null;
let messageCount = 0;
let lastMessageTime = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;

const reconnectLog = [];

const getNetworkInfo = () => {
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    for (const ifaceName in interfaces) {
        for (const iface of interfaces[ifaceName]) {
            if (!iface.internal && iface.family === 'IPv4') {
                localIP = iface.address;
                break;
            }
        }
    }
    return { localIP };
};

// ===== LƯU HISTORY ASYNC =====
function saveHistory() {
    fs.writeFile(HISTORY_FILE, JSON.stringify(patternHistory), 'utf8', (err) => {
        if (err) console.error('[❌] Lỗi lưu history:', err.message);
    });
}

// ===== GỬI MESSAGE AN TOÀN =====
function safeSend(msg, label) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(msg));
            console.log(`[📤] Gửi: ${label}`);
        } catch (err) {
            console.error(`[❌] Lỗi gửi ${label}:`, err.message);
        }
    } else {
        console.warn(`[⚠️] Không thể gửi ${label} — WS chưa OPEN`);
    }
}

// ===== PHÁT HIỆN PHIÊN BỊ MẤT =====
function detectMissedSessions(newSid) {
    if (!lastCommittedSessionId || !newSid) return;
    const diff = newSid - lastCommittedSessionId;
    if (diff > 1) {
        missedSessionCount += (diff - 1);
        const missed = [];
        for (let i = lastCommittedSessionId + 1; i < newSid; i++) missed.push(i);
        console.log(`[🚨 MẤT PHIÊN] Nhảy từ ${lastCommittedSessionId} → ${newSid}, bị mất ${diff - 1} phiên: [${missed.join(', ')}]`);
        console.log(`[📊] Tổng phiên bị mất từ đầu: ${missedSessionCount}`);
    }
}

// ===== COMMIT KẾT QUẢ VÀO STATE =====
function commitResult(sessionId, d1, d2, d3, timestamp, source) {
    const strictSources = ['1003-sid', 'pending-flush', 'pending-timeout'];
    if (sessionId && committedSessions.has(sessionId) && strictSources.includes(source)) {
        console.log(`[⚠️ SKIP] Phiên ${sessionId} đã commit, bỏ qua duplicate [${source}]`);
        return;
    }
    if (sessionId && committedSessions.has(sessionId) && !strictSources.includes(source)) {
        const last = patternHistory[patternHistory.length - 1];
        if (last && last.session === sessionId && last.dice[0] === d1 && last.dice[1] === d2 && last.dice[2] === d3) {
            console.log(`[⚠️ SKIP] Phiên ${sessionId} cùng dice đã commit, bỏ qua [${source}]`);
            return;
        }
    }

    const total = d1 + d2 + d3;
    const result = (total >= 11) ? "Tài" : "Xỉu";

    detectMissedSessions(sessionId);

    if (sessionId) {
        lastKnownSessionId = sessionId;
        lastCommittedSessionId = sessionId;
        seenSessions.add(sessionId);
        committedSessions.add(sessionId);
        if (committedSessions.size > 500) {
            const firstKey = committedSessions.values().next().value;
            committedSessions.delete(firstKey);
        }
    }

    apiResponseData = {
        "Phien": sessionId,
        "Xuc_xac_1": d1,
        "Xuc_xac_2": d2,
        "Xuc_xac_3": d3,
        "Tong": total,
        "Ket_qua": result,
        "id": "@sewdangcap",
        "server_time": timestamp,
        "update_count": (apiResponseData.update_count || 0) + 1
    };

    console.log(`[🎲✅] KẾT QUẢ [${source}]: Phiên ${sessionId}: ${d1}-${d2}-${d3} = ${total} (${result}) | ${timestamp}`);
    console.log(`[ℹ️] Tổng số lần cập nhật: ${apiResponseData.update_count}`);

    patternHistory.push({
        session: sessionId,
        dice: [d1, d2, d3],
        total,
        result,
        timestamp,
        source
    });

    if (patternHistory.length > 500) patternHistory.shift();

    // Lưu file async, không block event loop
    saveHistory();
}

// ===== XỬ LÝ PENDING DICE =====
function storePendingDice(d1, d2, d3, timestamp) {
    if (pendingDiceTimer) clearTimeout(pendingDiceTimer);

    pendingDiceResult = { d1, d2, d3, timestamp };
    console.log(`[⏳] Lưu pending dice: ${d1}-${d2}-${d3}, chờ sid tối đa ${PENDING_DICE_TIMEOUT / 1000}s...`);

    pendingDiceTimer = setTimeout(() => {
        if (pendingDiceResult) {
            const fallbackSession = lastKnownSessionId || 'UNKNOWN';
            console.log(`[⚠️] Hết thời gian chờ sid, commit với phiên fallback: ${fallbackSession}`);
            const { d1, d2, d3, timestamp } = pendingDiceResult;
            commitResult(fallbackSession, d1, d2, d3, timestamp, 'pending-timeout');
            pendingDiceResult = null;
        }
    }, PENDING_DICE_TIMEOUT);
}

// ===== XỬ LÝ PHIÊN MỚI — FIX: bỏ qua join room trùng sid =====
function handleNewSession(sid, rawData) {
    const isNewSession = currentSessionId !== sid;
    currentSessionId = sid;
    lastKnownSessionId = sid;
    seenSessions.add(sid);

    // FIX: không gửi join room lại nếu sid không đổi
    if (!isNewSession) {
        console.log(`[⏭️] Bỏ qua join room trùng sid=${sid}`);
        return;
    }

    sessionCounter++;
    console.log(`[🎮] Phiên mới bắt đầu: ${sid} (tổng phiên nhận: ${sessionCounter})`);
    console.log(`[1008 RAW] sid=${sid}`, JSON.stringify(rawData));

    // Gửi join room
    const joinRoomMsg = [6, "MiniGame", "taixiuPlugin", { cmd: 1007, sid: sid }];
    safeSend(joinRoomMsg, `join room (cmd=1007, sid=${sid})`);

    // Flush pending dice nếu có
    if (pendingDiceResult) {
        if (pendingDiceTimer) clearTimeout(pendingDiceTimer);
        pendingDiceTimer = null;
        const { d1, d2, d3, timestamp } = pendingDiceResult;
        pendingDiceResult = null;
        console.log(`[🔗] Flush pending dice với sid mới ${sid}`);
        commitResult(sid, d1, d2, d3, timestamp, 'pending-flush');
    }
}

// ===== XỬ LÝ cmd=1003 =====
function handle1003(data1) {
    const { d1, d2, d3, sid, gBB } = data1;

    console.log(`[🎲] cmd=1003: d1=${d1}, d2=${d2}, d3=${d3}, gBB=${gBB}, sid=${sid || 'N/A'}`);

    if (!d1 || !d2 || !d3) {
        console.log('[⚠️] Thiếu d1/d2/d3, bỏ qua. raw=', JSON.stringify(data1));
        return;
    }

    if (sid) seenSessions.add(sid);

    const resolvedSid = sid || currentSessionId || lastKnownSessionId;
    const receiveTime = new Date().toISOString();

    if (resolvedSid) {
        commitResult(resolvedSid, d1, d2, d3, receiveTime,
            sid ? '1003-sid' : (currentSessionId ? '1003-current' : '1003-last'));
    } else {
        console.log('[⚠️] Không có sid nào, lưu pending...');
        storePendingDice(d1, d2, d3, receiveTime);
    }
}

// ===== WATCHDOG: phát hiện và xử lý sid bị stuck =====
function startWatchdog() {
    clearInterval(watchdogInterval);
    watchdogInterval = setInterval(() => {
        if (currentSessionId && currentSessionId === lastCheckedSid) {
            sameSessionCount++;
            console.log(`[⚠️ WATCHDOG] Sid ${currentSessionId} không đổi (${sameSessionCount * (WATCHDOG_INTERVAL / 1000)}s)`);
            if (sameSessionCount >= WATCHDOG_MAX_SAME) {
                console.log(`[🔄 WATCHDOG] Force reconnect do sid bị stuck quá ${WATCHDOG_MAX_SAME * (WATCHDOG_INTERVAL / 1000)}s!`);
                sameSessionCount = 0;
                lastCheckedSid = null;
                if (ws) ws.terminate();
            }
        } else {
            sameSessionCount = 0;
            lastCheckedSid = currentSessionId;
        }
    }, WATCHDOG_INTERVAL);
}

function connectWebSocket() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('[🛑] Đã đạt số lần reconnect tối đa, dừng kết nối');
        return;
    }

    if (ws) {
        ws.removeAllListeners();
        try { ws.terminate(); } catch (_) {}
    }

    reconnectAttempts++;
    console.log(`[🔄] Đang kết nối WebSocket... (lần thứ ${reconnectAttempts}) | Phiên cuối: ${lastKnownSessionId || 'chưa có'}`);

    try {
        ws = new WebSocket(WEBSOCKET_URL, {
            headers: WS_HEADERS,
            handshakeTimeout: 10000,
            maxPayload: 104857600
        });
    } catch (error) {
        console.error('[❌] Lỗi tạo WebSocket:', error.message);
        scheduleReconnect();
        return;
    }

    ws.on('open', () => {
        wsConnectedAt = Date.now();
        reconnectAttempts = 0;
        messageCount = 0;
        lastMessageTime = Date.now();

        reconnectLog.push({ time: new Date().toISOString(), type: 'connect', lastSession: lastKnownSessionId });
        if (reconnectLog.length > 20) reconnectLog.shift();

        console.log('[✅] WebSocket đã kết nối đến Sun.Win');
        console.log('[ℹ️] Đang gửi messages khởi tạo...');

        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                safeSend(msg, `initialMessage[${i + 1}/${initialMessages.length}]`);
            }, i * 500);
        });

        clearInterval(pingInterval);
        clearInterval(heartbeatInterval);

        pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.ping();
                    console.log('[📶] Gửi ping...');
                } catch (error) {
                    console.error('[❌] Lỗi gửi ping:', error.message);
                }
            }
        }, PING_INTERVAL);

        heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const now = Date.now();
                if (lastMessageTime && (now - lastMessageTime) > 10000) {
                    safeSend(heartbeatMessage, 'heartbeat (cmd=1005)');
                }
            }
        }, HEARTBEAT_INTERVAL);

        // Khởi động watchdog
        startWatchdog();
    });

    ws.on('pong', () => {
        console.log('[📶] Pong nhận được - Kết nối OK');
    });

    ws.on('message', (message) => {
        try {
            const rawData = message.toString();
            const data = JSON.parse(rawData);

            messageCount++;
            lastMessageTime = Date.now();

            if (Array.isArray(data) && data.length > 1) {
                const cmdVal = (typeof data[1] === 'object' && data[1] !== null) ? data[1].cmd : 'N/A';
                console.log(`[📥] Message #${messageCount}: type=${data[0]}, cmd=${cmdVal}`);
            }

            if (!Array.isArray(data) || typeof data[1] !== 'object' || data[1] === null) return;

            const { cmd } = data[1];

            if (cmd !== undefined && !KNOWN_CMDS.includes(cmd)) {
                console.log(`[❓ CMD LẠ] cmd=${cmd}`, JSON.stringify(data[1]).slice(0, 400));
            }

            if (cmd === 1008 && data[1].sid) {
                handleNewSession(data[1].sid, data[1]);
            }

            if (cmd === 1003) {
                handle1003(data[1]);
            }

            if (cmd === 1011) {
                console.log(`[1011 RAW]`, JSON.stringify(data[1]).slice(0, 400));
            }

        } catch (e) {
            console.error('[❌] Lỗi xử lý message:', e.message);
        }
    });

    ws.on('close', (code, reason) => {
        const uptime = wsConnectedAt ? ((Date.now() - wsConnectedAt) / 1000).toFixed(1) + 's' : 'N/A';
        const reasonStr = reason ? reason.toString() : '';
        console.log(`[🔌] WebSocket đóng. Code: ${code}, Reason: ${reasonStr}, Uptime: ${uptime}`);
        console.log(`[ℹ️] Tổng messages đã nhận: ${messageCount} | Phiên cuối commit: ${lastCommittedSessionId || 'N/A'}`);

        reconnectLog.push({ time: new Date().toISOString(), type: 'disconnect', code, uptime, lastSession: lastCommittedSessionId });
        if (reconnectLog.length > 20) reconnectLog.shift();

        clearInterval(pingInterval);
        clearInterval(heartbeatInterval);
        clearInterval(watchdogInterval);

        scheduleReconnect();
    });

    ws.on('error', (err) => {
        console.error('[❌] WebSocket lỗi:', err.message);
        try { ws.terminate(); } catch (_) {}
    });

    ws.on('unexpected-response', (req, res) => {
        console.error(`[❌] Unexpected response: ${res.statusCode}`);
    });
}

function scheduleReconnect() {
    clearTimeout(reconnectTimeout);
    const delay = RECONNECT_DELAY * Math.min(reconnectAttempts + 1, 10);
    console.log(`[⏳] Sẽ reconnect sau ${delay / 1000}s... (phiên cuối: ${lastKnownSessionId || 'N/A'})`);
    reconnectTimeout = setTimeout(connectWebSocket, delay);
}

// ========== API ENDPOINTS ==========

app.get('/', (req, res) => {
    res.json(apiResponseData);
});

app.get('/api/ket-qua', (req, res) => {
    res.json({
        "Phien": apiResponseData.Phien,
        "Xuc_xac_1": apiResponseData.Xuc_xac_1,
        "Xuc_xac_2": apiResponseData.Xuc_xac_2,
        "Xuc_xac_3": apiResponseData.Xuc_xac_3,
        "Tong": apiResponseData.Tong,
        "Ket_qua": apiResponseData.Ket_qua,
        "id": apiResponseData.id,
        "server_time": apiResponseData.server_time,
        "update_count": apiResponseData.update_count
    });
});

app.get('/api/print', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(apiResponseData, null, 2));
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const recentHistory = patternHistory.slice(-limit);
    res.json({
        total: patternHistory.length,
        limit,
        data: recentHistory,
        latest: apiResponseData
    });
});

app.get('/api/health', (req, res) => {
    const now = Date.now();
    const timeSinceLastMessage = lastMessageTime ? Math.floor((now - lastMessageTime) / 1000) : null;
    res.json({
        status: 'online',
        websocket_state: ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] : 'NULL',
        websocket_connected: ws ? ws.readyState === WebSocket.OPEN : false,
        uptime_seconds: process.uptime().toFixed(2),
        memory: process.memoryUsage(),
        total_received: apiResponseData.update_count || 0,
        message_count: messageCount,
        last_message_seconds_ago: timeSinceLastMessage,
        reconnect_attempts: reconnectAttempts,
        connection_uptime: wsConnectedAt ? Math.floor((now - wsConnectedAt) / 1000) : null,
        current_session: currentSessionId,
        last_known_session: lastKnownSessionId,
        last_committed_session: lastCommittedSessionId,
        session_count: sessionCounter,
        missed_session_count: missedSessionCount,
        pending_dice: pendingDiceResult !== null,
        committed_sessions_tracked: committedSessions.size,
        watchdog_same_count: sameSessionCount
    });
});

app.get('/api/debug', (req, res) => {
    res.json({
        apiData: apiResponseData,
        currentSessionId,
        lastKnownSessionId,
        lastCommittedSessionId,
        sessionCounter,
        missedSessionCount,
        seenSessionsCount: seenSessions.size,
        recentSeenSessions: [...seenSessions].slice(-20),
        committedSessionsCount: committedSessions.size,
        recentCommittedSessions: [...committedSessions].slice(-20),
        pendingDiceResult,
        historyCount: patternHistory.length,
        lastHistoryItem: patternHistory[patternHistory.length - 1] || null,
        reconnectLog,
        wsStatus: {
            connected: ws ? ws.readyState === WebSocket.OPEN : false,
            state: ws ? ws.readyState : null,
            connectedAt: wsConnectedAt,
            messageCount,
            lastMessageTime,
            reconnectAttempts
        }
    });
});

app.get('/api/gaps', (req, res) => {
    const sessions = [...seenSessions].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < sessions.length; i++) {
        const diff = sessions[i] - sessions[i - 1];
        if (diff > 1) {
            const missing = [];
            for (let j = sessions[i - 1] + 1; j < sessions[i]; j++) missing.push(j);
            gaps.push({ from: sessions[i - 1], to: sessions[i], missing });
        }
    }
    res.json({
        total_seen: sessions.length,
        total_gaps: gaps.length,
        total_missed: missedSessionCount,
        gaps,
        all_sessions: sessions
    });
});

// Khởi động server
app.listen(PORT, '0.0.0.0', () => {
    const networkInfo = getNetworkInfo();
    console.log(`\n=========================================`);
    console.log(`🚀 Sun.Win Data Stream Server`);
    console.log(`=========================================`);
    console.log(`📡 Server:`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://${networkInfo.localIP}:${PORT}`);
    console.log(`\n📋 API Endpoints:`);
    console.log(`   ✅ /             - Kết quả hiện tại`);
    console.log(`   ✅ /api/ket-qua  - Kết quả hiện tại`);
    console.log(`   ✅ /api/print    - Kết quả đẹp (có indent)`);
    console.log(`   ✅ /api/history  - Lịch sử kết quả`);
    console.log(`   ✅ /api/health   - Kiểm tra trạng thái`);
    console.log(`   ✅ /api/debug    - Thông tin debug`);
    console.log(`   ✅ /api/gaps     - Phiên bị mất`);
    console.log(`=========================================`);
    console.log(`\n[🔧 FIX] Đã áp dụng:`);
    console.log(`   ✅ Bỏ lọc gBB (không bỏ qua gBB=false)`);
    console.log(`   ✅ Chống commit trùng phiên`);
    console.log(`   ✅ Ưu tiên sid trong message 1003`);
    console.log(`   ✅ Bỏ qua join room khi sid không đổi`);
    console.log(`   ✅ Watchdog tự reconnect khi sid bị stuck 2 phút`);
    console.log(`   ✅ Lưu history file async (không block event loop)`);
    console.log(`   ✅ Load history từ file khi khởi động`);
    console.log(`=========================================\n`);

    connectWebSocket();
});

process.on('SIGINT', () => {
    console.log('\n[🛑] Đang tắt server...');
    if (ws) ws.terminate();
    process.exit(0);
});
