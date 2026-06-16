const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

// ===== CONFIGURATION =====
const MONGODB_URI = process.env.MONGODB_URI;

let WEBSOCKET_URL = process.env.WS_TOKEN
    ? `wss://websocket.azhkthg1.net/websocket?token=${process.env.WS_TOKEN}`
    : "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ0b29sc2V3c2l0ZSIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOmZhbHNlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjM1MTk0ODY5MSwiYWZmSWQiOiIiLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJlbWFpbCI6IiIsInRpbWVzdGFtcCI6MTc4MTU5Mjk1MTQ0NywibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjE0LjI0MC4yMS4xNTkiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzEyLnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6IjNiZTU2ZjRjLTQwMjctNDg4ZS1hYzk0LTcxNDgxNDAyNzFkMyIsImVtYWlsVmVyaWZpZWQiOm51bGwsInJlZ1RpbWUiOjE3ODA2NzAxNjM2MDgsInBob25lIjoiODQ4ODYwMjc3NjciLCJkZXBvc2l0Ijp0cnVlLCJ1c2VybmFtZSI6IlNDX3Rvb2xzZXdwcm8ifQ.JIDdueIG2bm70biBz_9yKHWpLXWF8CSfSs_0MOEWjzU";

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// ===== DATABASE =====
let db = null;
let historyCollection = null;
let patternHistory = [];

async function connectMongoDB() {
    if (!MONGODB_URI) {
        console.warn('[❌] MONGODB_URI chưa được set! Lịch sử sẽ chỉ lưu trên RAM.');
        return;
    }
    try {
        const client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        db = client.db('sunwin');
        historyCollection = db.collection('history');
        await historyCollection.createIndex({ session: -1 }, { unique: true });
        console.log('[✅ MongoDB] Kết nối thành công!');
        await loadHistoryFromDB();
    } catch (err) {
        console.error('[❌ MongoDB] Lỗi kết nối:', err.message);
    }
}

async function loadHistoryFromDB() {
    if (!historyCollection) return;
    try {
        const docs = await historyCollection.find({}).sort({ session: -1 }).limit(50).toArray();
        patternHistory = docs.reverse().map(d => ({
            session: d.session,
            dice: d.dice,
            total: d.total,
            result: d.result,
            timestamp: d.timestamp,
            source: d.source
        }));
        console.log(`[📂 MongoDB] Đã load ${patternHistory.length} phiên từ DB.`);
        if (patternHistory.length > 0) {
            const last = patternHistory[patternHistory.length - 1];
            lastKnownSessionId = last.session;
            lastCommittedSessionId = last.session;
        }
    } catch (err) {
        console.error('[❌ MongoDB] Lỗi load history:', err.message);
    }
}

async function saveHistoryToDB(entry) {
    if (!historyCollection) return;
    try {
        await historyCollection.updateOne(
            { session: entry.session },
            { $set: entry },
            { upsert: true }
        );
        const count = await historyCollection.countDocuments();
        if (count > 50) {
            const oldest = await historyCollection.find({}).sort({ session: 1 }).limit(count - 50).toArray();
            const ids = oldest.map(d => d._id);
            await historyCollection.deleteMany({ _id: { $in: ids } });
        }
    } catch (err) {
        console.error('[❌ MongoDB] Lỗi lưu history:', err.message);
    }
}

// ===== STATE MANAGEMENT =====
let apiResponseData = {
    "Phien": null, "Xuc_xac_1": null, "Xuc_xac_2": null, "Xuc_xac_3": null,
    "Tong": null, "Ket_qua": "", "id": "@sewdangcap",
    "server_time": new Date().toISOString(), "update_count": 0
};

let ws = null;
let currentSessionId = null;
let lastKnownSessionId = null;
let lastCommittedSessionId = null;
let lastJoinedSid = null;
let sessionCounter = 0;

const seenSessions = new Set();
const committedSessions = new Set();

// WS Connection States
let wsConnectedAt = null;
let messageCount = 0;
let lastMessageTime = null;
let reconnectAttempts = 0;
let isIntentionalClose = false;

// Intervals
let pingInterval = null;
let heartbeatInterval = null;
let watchdogInterval = null;
let keepAliveInterval = null;
let reconnectTimeout = null;

const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://play.sun.win"
};

let initialMessages = [
    [1, "MiniGame", "Simms", "info", {
        "info": "{\"ipAddress\":\"14.240.21.213\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJzYW5nZGVwemFpMDlubyIsImJvdCI6MCwiaXNNZXJjaGFudCI6ZmFsc2UsInZlcmlmaWVkQmFua0FjY291bnQiOmZhbHNlLCJwbGF5RXZlbnRMb2JieSI6ZmFsc2UsImN1c3RvbWVySWQiOjIyMTY0MDY3MiwiYWZmSWQiOiJTdW53aW4iLCJiYW5uZWQiOmZhbHNlLCJicmFuZCI6InN1bi53aW4iLCJlbWFpbCI6IiIsInRpbWVzdGFtcCI6MTc4MDY0ODQ4MzI2MiwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6dHJ1ZSwicGhvbmVWZXJpZmllZCI6dHJ1ZSwiaXBBZGRyZXNzIjoiMTQuMjQwLjIxLjIxMyIsIm11dGUiOnRydWUsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8xNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI3ODRmNGU0Mi1iZWExLTRiZTUtYjgwNS03MmJlZjY5N2UwMTIiLCJlbWFpbFZlcmlmaWVkIjpudWxsLCJyZWdUaW1lIjoxNzQyMjMyMzQ1MTkxLCJwaG9uZSI6Ijg0ODg2MDI3NzY3IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19tc2FuZ3p6MDkifQ.BKEp2lTltayLlD39-_wtYhQSNvBmOOExJ7uEtv7hxac\",\"locale\":\"vi\",\"userId\":\"784f4e42-bea1-4be5-b805-72bef697e012\",\"username\":\"SC_msangzz09\",\"timestamp\":1780648483262,\"refreshToken\":\"\"}",
        "signature": ""
    }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

const heartbeatMessage = [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }];

// Inject refreshToken từ env nếu có
if (process.env.REFRESH_TOKEN) {
    try {
        const info = JSON.parse(initialMessages[0][4].info);
        info.refreshToken = process.env.REFRESH_TOKEN;
        initialMessages[0][4].info = JSON.stringify(info);
        console.log('[✅] Đã load REFRESH_TOKEN từ env.');
    } catch (e) {
        console.warn('[⚠️] Lỗi inject REFRESH_TOKEN từ env:', e.message);
    }
}

// ===== CORE LOGIC =====
function safeSend(msg, label) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(msg));
            if (!label.includes('1005')) {
                console.log(`[📤] Đã gửi: ${label}`);
            }
        } catch (err) {
            console.error(`[❌] Lỗi gửi ${label}:`, err.message);
        }
    }
}

function commitResult(sessionId, d1, d2, d3, timestamp, source) {
    if (sessionId && committedSessions.has(sessionId)) return;

    const total = d1 + d2 + d3;
    const result = (total >= 11) ? "Tài" : "Xỉu";

    if (sessionId) {
        lastKnownSessionId = sessionId;
        lastCommittedSessionId = sessionId;
        seenSessions.add(sessionId);
        committedSessions.add(sessionId);
        if (committedSessions.size > 50) committedSessions.delete([...committedSessions][0]);
    }

    apiResponseData = {
        "Phien": sessionId, "Xuc_xac_1": d1, "Xuc_xac_2": d2, "Xuc_xac_3": d3,
        "Tong": total, "Ket_qua": result, "id": "@sewdangcap",
        "server_time": timestamp,
        "update_count": (apiResponseData.update_count || 0) + 1
    };

    console.log(`[🎲 WIN] Phiên ${sessionId} | ${d1}-${d2}-${d3} = ${total} (${result}) | Nguồn: ${source}`);

    const entry = { session: sessionId, dice: [d1, d2, d3], total, result, timestamp, source };
    patternHistory.push(entry);
    if (patternHistory.length > 50) patternHistory.shift();
    saveHistoryToDB(entry);
}

function extractResultsFromPayload(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.sid && obj.d1 !== undefined && obj.d2 !== undefined && obj.d3 !== undefined) {
        if (!committedSessions.has(obj.sid)) {
            commitResult(obj.sid, obj.d1, obj.d2, obj.d3, new Date().toISOString(), 'auto-recovery');
        }
    }

    if (obj.sid && obj.dices && Array.isArray(obj.dices) && obj.dices.length === 3) {
        if (!committedSessions.has(obj.sid)) {
            commitResult(obj.sid, obj.dices[0], obj.dices[1], obj.dices[2], new Date().toISOString(), 'auto-recovery-history');
        }
    }

    for (let key in obj) {
        if (typeof obj[key] === 'object') {
            extractResultsFromPayload(obj[key]);
        }
    }
}

function handleSessionTracking(data) {
    if (data && data.sid) {
        if (data.sid !== lastJoinedSid) {
            console.log(`[🎮] Phát hiện phiên mới: ${data.sid}, Lập tức xin Join...`);
            safeSend([6, "MiniGame", "taixiuPlugin", { cmd: 1007, sid: data.sid }], `Join Room (1007) sid=${data.sid}`);
            lastJoinedSid = data.sid;
        }

        if (data.sid !== currentSessionId) {
            currentSessionId = data.sid;
            lastKnownSessionId = data.sid;
            seenSessions.add(data.sid);
            sessionCounter++;
            console.log(`[🔄 UPDATE] Đang theo dõi phiên: ${data.sid}`);
        }
    }
}

// ===== AUTO REFRESH TOKEN =====
let tokenRefreshFailCount = 0;
let isRefreshing = false;
let totalRefreshAttempts = 0;

function getCurrentRefreshToken() {
    try {
        const info = JSON.parse(initialMessages[0][4].info);
        return info.refreshToken || null;
    } catch (e) { return null; }
}

function getCurrentInfoObj() {
    try {
        return JSON.parse(initialMessages[0][4].info);
    } catch (e) { return null; }
}

// Dùng https built-in thay vì fetch (tương thích mọi phiên bản Node)
function httpsPost(url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const bodyStr = JSON.stringify(body);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + (parsed.search || ''),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'User-Agent': WS_HEADERS['User-Agent'],
                'Origin': 'https://play.sun.win',
                'Referer': 'https://play.sun.win/',
            },
            timeout: 12000,
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON parse failed: ' + data.slice(0, 100))); }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout 12s'));
        });

        req.write(bodyStr);
        req.end();
    });
}

async function autoRefreshToken() {
    if (isRefreshing) {
        console.log('[⏳ Token] Đang refresh, bỏ qua lần gọi trùng...');
        return false;
    }
    isRefreshing = true;
    totalRefreshAttempts++;

    const refreshToken = getCurrentRefreshToken();
    if (!refreshToken) {
        console.warn('[⚠️ Token] Không tìm thấy refreshToken (trống). Set env REFRESH_TOKEN hoặc điền vào initialMessages.');
        isRefreshing = false;
        return false;
    }

    console.log(`[🔑 Token] Đang lấy WS Token mới (lần thứ ${totalRefreshAttempts})...`);

    const endpoints = [
        'https://api.sunwin.qa/api/auth/token',
        'https://api2.sunwin.qa/api/auth/token',
        'https://api3.sunwin.qa/api/auth/token',
        'https://web.sunwin.qa/api/auth/token',
        'https://play.sun.win/api/auth/token',
    ];

    const infoObj = getCurrentInfoObj();

    for (const url of endpoints) {
        try {
            const json = await httpsPost(url, {
                refreshToken,
                userId: infoObj?.userId,
                platform: 4,
            });

            const tokenData = json?.data?.data || json?.data || json;

            if (!tokenData?.wsToken) {
                console.warn(`[⚠️ Token] ${url} → Không có wsToken. Res: ${JSON.stringify(json).slice(0, 150)}`);
                continue;
            }

            const newToken = tokenData.wsToken;
            const oldToken = (WEBSOCKET_URL.split('token=')[1] || '').split('&')[0];

            // Cập nhật WEBSOCKET_URL
            WEBSOCKET_URL = `wss://websocket.azhkthg1.net/websocket?token=${newToken}`;

            // Cập nhật initialMessages
            try {
                const info = getCurrentInfoObj();
                info.wsToken = newToken;
                if (tokenData.refreshToken) info.refreshToken = tokenData.refreshToken;
                if (tokenData.timestamp)    info.timestamp    = tokenData.timestamp;
                initialMessages[0][4].info = JSON.stringify(info);
                if (tokenData.signature) initialMessages[0][4].signature = tokenData.signature;
            } catch (e) {
                console.warn('[⚠️ Token] Lỗi cập nhật info:', e.message);
            }

            tokenRefreshFailCount = 0;
            isRefreshing = false;

            if (newToken === oldToken) {
                console.log('[ℹ️ Token] Token chưa đổi, vẫn còn hiệu lực.');
                return true;
            }

            console.log(`[✅ Token] Token mới thành công! ...${newToken.slice(-20)}`);

            // Force reconnect WS với token mới
            console.log('[🔄 Token] Reconnect WS với token mới...');
            isIntentionalClose = true;
            if (ws) {
                ws.removeAllListeners();
                try { ws.terminate(); } catch (_) {}
            }
            clearInterval(pingInterval);
            clearInterval(heartbeatInterval);
            clearInterval(watchdogInterval);
            clearTimeout(reconnectTimeout);
            setTimeout(connectWebSocket, 1500);

            return true;

        } catch (err) {
            console.warn(`[⚠️ Token] ${url} → ${err.message}`);
        }
    }

    tokenRefreshFailCount++;
    isRefreshing = false;
    console.error(`[❌ Token] Tất cả endpoint thất bại (lần ${tokenRefreshFailCount}).`);
    if (tokenRefreshFailCount >= 3) {
        console.error('[🚨 Token] Token có thể đã chết! Hãy cập nhật env WS_TOKEN + REFRESH_TOKEN mới.');
    }
    return false;
}

// Định kỳ refresh token mỗi 25 phút
setInterval(async () => {
    console.log('[⏰ Token] Định kỳ refresh token...');
    await autoRefreshToken();
}, 25 * 60 * 1000);

// ===== WEBSOCKET MANAGER =====
async function connectWebSocket() {
    isIntentionalClose = false;
    clearTimeout(reconnectTimeout);

    if (ws) {
        ws.removeAllListeners();
        try { ws.terminate(); } catch (_) {}
    }

    reconnectAttempts++;

    // Refresh token: lần đầu tiên, hoặc mỗi 3 lần reconnect liên tiếp
    if (reconnectAttempts === 1 || reconnectAttempts % 3 === 0) {
        await autoRefreshToken();
    }

    console.log(`[🔌] Đang kết nối WS (Lần ${reconnectAttempts})...`);

    try {
        ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS, handshakeTimeout: 10000 });
    } catch (error) {
        console.error('[❌] Lỗi khởi tạo WS:', error.message);
        scheduleReconnect();
        return;
    }

    ws.on('open', () => {
        console.log('[✅] Kết nối WS thành công!');
        wsConnectedAt = Date.now();
        lastMessageTime = Date.now();
        reconnectAttempts = 0;
        messageCount = 0;
        lastJoinedSid = null;

        initialMessages.forEach((msg, i) => {
            setTimeout(() => safeSend(msg, `Init[${i}]`), i * 300);
        });

        pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) ws.ping();
        }, 20000);

        heartbeatInterval = setInterval(() => {
            safeSend(heartbeatMessage, 'Heartbeat (1005)');
        }, 6000);

        watchdogInterval = setInterval(() => {
            const now = Date.now();
            const silentSecs = lastMessageTime ? Math.floor((now - lastMessageTime) / 1000) : 0;
            if (lastMessageTime && silentSecs > 90) {
                console.log(`[🚨 WATCHDOG] Im lặng ${silentSecs}s (${messageCount} msg). Reconnect!`);
                isIntentionalClose = true;
                ws.terminate();
                scheduleReconnect();
            }
        }, 10000);
    });

    ws.on('message', (message, isBinary) => {
        try {
            lastMessageTime = Date.now();
            messageCount++;

            let rawData;
            if (Buffer.isBuffer(message) || isBinary) {
                rawData = message.toString('utf8');
            } else {
                rawData = message.toString();
            }

            if (rawData && !rawData.startsWith('[') && !rawData.startsWith('{')) {
                const firstBracketIndex = rawData.search(/[[{]/);
                if (firstBracketIndex !== -1) {
                    rawData = rawData.substring(firstBracketIndex);
                } else {
                    return;
                }
            }

            const data = JSON.parse(rawData);

            extractResultsFromPayload(data);

            if (!Array.isArray(data) || typeof data[1] !== 'object' || data[1] === null) return;

            const payload = data[1];
            handleSessionTracking(payload);

        } catch (e) {
            // Im lặng bỏ qua lỗi parse
        }
    });

    ws.on('close', () => {
        if (!isIntentionalClose) console.log(`[⚠️] Máy chủ ngắt kết nối đột ngột.`);
        cleanupAndReconnect();
    });

    ws.on('error', (err) => {
        console.error('[❌] WS Lỗi mạng:', err.message);
        isIntentionalClose = true;
        cleanupAndReconnect();
    });
}

function cleanupAndReconnect() {
    clearInterval(pingInterval);
    clearInterval(heartbeatInterval);
    clearInterval(watchdogInterval);
    if (!isIntentionalClose || reconnectAttempts > 0) {
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    clearTimeout(reconnectTimeout);
    let delay;
    if (reconnectAttempts <= 1)      delay = 2000;
    else if (reconnectAttempts <= 3) delay = 5000;
    else if (reconnectAttempts <= 6) delay = 10000;
    else                             delay = 15000;
    console.log(`[⏳] Reconnect sau ${delay / 1000}s... (lần ${reconnectAttempts})`);
    reconnectTimeout = setTimeout(connectWebSocket, delay);
}

function startKeepAlive() {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
        const client = SELF_URL.startsWith('https') ? https : http;
        client.get(`${SELF_URL}/api/health`, () => {}).on('error', () => {});
    }, 4 * 60 * 1000);
}

// ===== APIs =====
app.get('/', (req, res) => res.json(apiResponseData));
app.get('/api/ket-qua', (req, res) => res.json(apiResponseData));

app.get('/api/taixiu/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        total: patternHistory.length,
        limit,
        data: patternHistory.slice(-limit),
        latest: apiResponseData
    });
});

app.get('/api/health', (req, res) => res.json({
    status: 'online',
    ws_state: ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] : 'null',
    uptime_secs: Math.floor(process.uptime()),
    messages_received: messageCount,
    reconnect_attempts: reconnectAttempts,
    total_refresh_attempts: totalRefreshAttempts,
    token_refresh_fails: tokenRefreshFailCount,
    last_known_session: lastKnownSessionId,
    silent_secs: lastMessageTime ? Math.floor((Date.now() - lastMessageTime) / 1000) : null,
}));

app.get('/api/refresh-token', async (req, res) => {
    console.log('[🔑] Force refresh token theo yêu cầu HTTP...');
    const ok = await autoRefreshToken();
    res.json({
        success: ok,
        message: ok ? '✅ Token mới đã cập nhật và WS sẽ reconnect!' : '❌ Refresh thất bại, xem log.'
    });
});

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n=== 🚀 KHỞI ĐỘNG CỖ MÁY CRAWL TÀI XỈU ===`);
    console.log(`[Port] ${PORT}`);
    console.log(`[Self URL] ${SELF_URL}`);

    await connectMongoDB();
    startKeepAlive();
    connectWebSocket();
});

process.on('SIGINT', () => {
    console.log('\n[🛑] Tắt máy...');
    isIntentionalClose = true;
    if (ws) ws.terminate();
    process.exit(0);
});
