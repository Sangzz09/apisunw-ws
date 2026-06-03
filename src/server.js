const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const os = require('os');
const https = require('https');
const http = require('http');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

// ===== CONFIGURATION =====
const MONGODB_URI = process.env.MONGODB_URI;
const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const MAX_HISTORY = 50; // Giới hạn đúng 50 phiên

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
        const docs = await historyCollection.find({}).sort({ session: -1 }).limit(MAX_HISTORY).toArray();
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
        // Clean up data cũ (giữ lại tối đa 50)
        const count = await historyCollection.countDocuments();
        if (count > MAX_HISTORY) {
            const oldest = await historyCollection.find({}).sort({ session: 1 }).limit(count - MAX_HISTORY).toArray();
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
    "Tong": null, "Ket_qua": "", "id": "@sewdangcap", "server_time": new Date().toISOString(), "update_count": 0
};

let ws = null;
let currentSessionId = null;
let lastKnownSessionId = null;
let lastCommittedSessionId = null;
let sessionCounter = 0;
let missedSessionCount = 0;

const seenSessions = new Set();
const committedSessions = new Set();
let pendingDiceResult = null;
let pendingDiceTimer = null;

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

// Gửi khởi tạo cơ bản
const initialMessages = [
    [1, "MiniGame", "GM_apivopnhaan", "WangLin", {
        "info": "{\"ipAddress\":\"113.185.45.88\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJwbGFtYW1hIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzMxNDgxMTYyLCJhZmZJZCI6IkdFTVdJTiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzY2NDc0NzgwMDA2LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjExMy4xODUuNDUuODgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE4LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjZhOGI0ZDM4LTFlYzEtNDUxYi1hYTA1LWYyZDkwYWFhNGM1MCIsInJlZ1RpbWUiOjE3NjY0NzQ3NTEzOTEsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fYXBpdm9wbmhhYW4ifQ.YFOscbeojWNlRo7490BtlzkDGYmwVpnlgOoh04oCJy4\",\"locale\":\"vi\",\"userId\":\"6a8b4d38-1ec1-451b-aa05-f2d90aaa4c50\",\"username\":\"GM_apivopnhaan\",\"timestamp\":1766474780007,\"refreshToken\":\"63d5c9be0c494b74b53ba150d69039fd.7592f06d63974473b4aaa1ea849b2940\"}",
        "signature": "66772A1641AA8B18BD99207CE448EA00ECA6D8A4D457C1FF13AB092C22C8DECF0C0014971639A0FBA9984701A91FCCBE3056ABC1BE1541D1C198AA18AF3C45595AF6601F8B048947ADF8F48A9E3E074162F9BA3E6C0F7543D38BD54FD4C0A2C56D19716CC5353BBC73D12C3A92F78C833F4EFFDC4AB99E55C77AD2CDFA91E296"
    }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1007 }] // Join room không có sid để lấy luồng ban đầu
];

const heartbeatMessage = [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }];

// ===== CORE LOGIC =====

function safeSend(msg, label) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(msg));
            // Tắt console.log gửi ping/heartbeat để đỡ rác log
            if (!label.includes('1005')) {
                console.log(`[📤] Đã gửi: ${label}`);
            }
        } catch (err) {
            console.error(`[❌] Lỗi gửi ${label}:`, err.message);
        }
    }
}

function detectMissedSessions(newSid) {
    if (!lastCommittedSessionId || !newSid) return;
    const diff = newSid - lastCommittedSessionId;
    if (diff > 1) {
        missedSessionCount += (diff - 1);
        const missed = [];
        for (let i = lastCommittedSessionId + 1; i < newSid; i++) missed.push(i);
        console.log(`[🚨 CẢNH BÁO MẤT PHIÊN] Nhảy từ ${lastCommittedSessionId} → ${newSid} | Lọt khe: [${missed.join(', ')}]`);
    }
}

function commitResult(sessionId, d1, d2, d3, timestamp, source) {
    if (sessionId && committedSessions.has(sessionId)) return; // Bỏ qua trùng lặp

    const total = d1 + d2 + d3;
    const result = (total >= 11) ? "Tài" : "Xỉu";

    detectMissedSessions(sessionId);

    if (sessionId) {
        lastKnownSessionId = sessionId;
        lastCommittedSessionId = sessionId;
        seenSessions.add(sessionId);
        committedSessions.add(sessionId);
        if (committedSessions.size > MAX_HISTORY) committedSessions.delete([...committedSessions][0]);
    }

    apiResponseData = {
        "Phien": sessionId, "Xuc_xac_1": d1, "Xuc_xac_2": d2, "Xuc_xac_3": d3,
        "Tong": total, "Ket_qua": result, "id": "@sewdangcap", "server_time": timestamp,
        "update_count": (apiResponseData.update_count || 0) + 1
    };

    console.log(`[🎲 WIN] Phiên ${sessionId} | ${d1}-${d2}-${d3} = ${total} (${result}) | Nguồn: ${source}`);

    const entry = { session: sessionId, dice: [d1, d2, d3], total, result, timestamp, source };
    patternHistory.push(entry);
    if (patternHistory.length > MAX_HISTORY) patternHistory.shift();
    saveHistoryToDB(entry);
}

function handleSessionTracking(data) {
    if (data && data.sid && data.sid !== currentSessionId) {
        currentSessionId = data.sid;
        lastKnownSessionId = data.sid;
        seenSessions.add(data.sid);
        sessionCounter++;
        console.log(`[🔄 UPDATE] Nhận diện ID phiên hiện tại: ${data.sid}`);
    }
}

// ===== WEBSOCKET MANAGER =====

function connectWebSocket() {
    isIntentionalClose = false;
    clearTimeout(reconnectTimeout);
    
    if (ws) {
        ws.removeAllListeners();
        try { ws.terminate(); } catch (_) {}
    }

    reconnectAttempts++;
    console.log(`[🔌] Đang kết nối WS (Lần ${reconnectAttempts})...`);

    try {
        ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS, handshakeTimeout: 10000 });
    } catch (error) {
        console.error('[❌] Lỗi khởi tạo WS:', error.message);
        scheduleReconnect();
        return;
    }

    ws.on('open', () => {
        console.log('[✅] Kết nối thành công!');
        wsConnectedAt = Date.now();
        lastMessageTime = Date.now();
        reconnectAttempts = 0;
        messageCount = 0;

        // Gửi chuỗi khởi tạo
        initialMessages.forEach((msg, i) => {
            setTimeout(() => safeSend(msg, `Init[${i}]`), i * 300);
        });

        // Ping chuẩn
        pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) ws.ping();
        }, 20000);

        // Heartbeat Game
        heartbeatInterval = setInterval(() => {
            safeSend(heartbeatMessage, 'Heartbeat (1005)');
        }, 6000);

        // Nới Watchdog lên 25s
        watchdogInterval = setInterval(() => {
            const now = Date.now();
            if (lastMessageTime && (now - lastMessageTime > 25000)) { 
                console.log(`[🚨 WATCHDOG] Bị kẹt dữ liệu (25s im lặng). Force Reconnect!`);
                isIntentionalClose = true;
                ws.terminate();
                scheduleReconnect();
            }
        }, 5000);
    });

    ws.on('message', (message) => {
        try {
            lastMessageTime = Date.now();
            messageCount++;
            
            const rawData = message.toString();
            const data = JSON.parse(rawData);

            if (!Array.isArray(data) || typeof data[1] !== 'object' || data[1] === null) return;
            
            const payload = data[1];
            const cmd = payload.cmd;

            handleSessionTracking(payload);

            // Gói 1008 báo phiên mới
            if (cmd === 1008 && payload.sid) {
                console.log(`[🎮] Server báo phiên mới: ${payload.sid}, đang xin Join...`);
                safeSend([6, "MiniGame", "taixiuPlugin", { cmd: 1007, sid: payload.sid }], `Join Room (1007) sid=${payload.sid}`);
            }

            // Gói 1003 trả kết quả
            if (cmd === 1003) {
                const { d1, d2, d3, sid } = payload;
                if (!d1 || !d2 || !d3) return;
                
                const resolvedSid = sid || currentSessionId || lastKnownSessionId;
                const receiveTime = new Date().toISOString();
                
                if (resolvedSid) {
                    commitResult(resolvedSid, d1, d2, d3, receiveTime, '1003');
                } else {
                    pendingDiceResult = { d1, d2, d3, timestamp: receiveTime };
                    clearTimeout(pendingDiceTimer);
                    pendingDiceTimer = setTimeout(() => {
                        if (pendingDiceResult) {
                            commitResult("UNKNOWN", d1, d2, d3, receiveTime, 'timeout');
                            pendingDiceResult = null;
                        }
                    }, 3000);
                }
            }
        } catch (e) {
            // Bỏ qua lỗi parse
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
    scheduleReconnect();
}

function scheduleReconnect() {
    clearTimeout(reconnectTimeout);
    const delay = reconnectAttempts < 5 ? 1000 : 3000;
    console.log(`[⏳] Reconnect sau ${delay}ms...`);
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

// ===== API LỊCH SỬ MỚI =====
app.
