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

// 🔴 1. THAY TOKEN MỚI VÀO ĐÂY (NHỚ GIỮ NGUYÊN CHỮ wss://.../websocket?token=)
const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJib3RydW1zdW53aW5zZXciLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMzMzOTY2NzYsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsImVtYWlsIjoiIiwidGltZXN0YW1wIjoxNzgwNTA5NTgxMjY0LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6dHJ1ZSwiaXBBZGRyZXNzIjoiMTQuMjQwLjIxLjIxMyIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMDUucG5nIiwicGxhdGZvcm1JZCI6NCwidXNlcklkIjoiOTJmOTJlODAtZWM2Zi00NDk4LTkzMjQtMTE5NWIxZTg2NTE0IiwiZW1haWxWZXJpZmllZCI6bnVsbCwicmVnVGltZSI6MTc2NzgwMDQ0ODcxNywicGhvbmUiOiI4NDg4NjAyNzc2NyIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0Nfc2FuZ3p6MjAwOSJ9.EZL5SMU3Xno6BF0FuK5Ds7Jq-z2V-TH63hoqbdoMfTc";

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
        // GIỚI HẠN LOAD 50 PHIÊN
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
        // GIỚI HẠN XÓA NẾU VƯỢT QUÁ 50 PHIÊN
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
    "Tong": null, "Ket_qua": "", "id": "@sewdangcap", "server_time": new Date().toISOString(), "update_count": 0
};

let ws = null;
let currentSessionId = null;
let lastKnownSessionId = null;
let lastCommittedSessionId = null;
let lastJoinedSid = null;
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

// 🔴 2. THAY PHẦN INFO VÀ SIGNATURE MỚI VÀO ĐÂY
const initialMessages = [
    [1, "MiniGame", "Simms", "info", {
        "info": "{\"ipAddress\":\"14.240.21.213\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJib3RydW1zdW53aW5zZXciLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMzMzOTY2NzYsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsImVtYWlsIjoiIiwidGltZXN0YW1wIjoxNzgwNTA5NTgxMjY0LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6dHJ1ZSwiaXBBZGRyZXNzIjoiMTQuMjQwLjIxLjIxMyIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMDUucG5nIiwicGxhdGZvcm1JZCI6NCwidXNlcklkIjoiOTJmOTJlODAtZWM2Zi00NDk4LTkzMjQtMTE5NWIxZTg2NTE0IiwiZW1haWxWZXJpZmllZCI6bnVsbCwicmVnVGltZSI6MTc2NzgwMDQ0ODcxNywicGhvbmUiOiI4NDg4NjAyNzc2NyIsImRlcG9zaXQiOnRydWUsInVzZXJuYW1lIjoiU0Nfc2FuZ3p6MjAwOSJ9.EZL5SMU3Xno6BF0FuK5Ds7Jq-z2V-TH63hoqbdoMfTc\",\"locale\":\"vi\",\"userId\":\"92f92e80-ec6f-4498-9324-1195b1e86514\",\"username\":\"SC_sangzz2009\",\"timestamp\":1780509581278,\"refreshToken\":\"2eb51d64427c4693a59fc1d4bf6539c1.6fc1fe677c3d4732b009207f1495872a\"}",
        "signature": "6B98B907B61E934AA200C1396D2104F379B3DE931F22B1FDB0051D237CCB7DB1DF5BDB03FA447A0C03090B591FDD4B9505B750EEBDABCE6C5B013F220A26AC36F03BF0A582CFAA06811F03EEE5C012259823BB64252B8B8F98CF10B3836B98872C209FC12AAA9BB045E2F835547891420A6F6FBFF757C6AFDC1C83FDF94A3253"
    }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

const heartbeatMessage = [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }];

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

function detectMissedSessions(newSid) {
    if (!lastCommittedSessionId || !newSid) return;
    const diff = newSid - lastCommittedSessionId;
    if (diff > 1) {
        missedSessionCount += (diff - 1);
        const missed = [];
        for (let i = lastCommittedSessionId + 1; i < newSid; i++) missed.push(i);
        console.log(`[🚨 CẢNH BÁO] Nhảy từ ${lastCommittedSessionId} → ${newSid} | Lọt khe: [${missed.join(', ')}]`);
    }
}

function commitResult(sessionId, d1, d2, d3, timestamp, source) {
    if (sessionId && committedSessions.has(sessionId)) return;

    const total = d1 + d2 + d3;
    const result = (total >= 11) ? "Tài" : "Xỉu";

    detectMissedSessions(sessionId);

    if (sessionId) {
        lastKnownSessionId = sessionId;
        lastCommittedSessionId = sessionId;
        seenSessions.add(sessionId);
        committedSessions.add(sessionId);
        // GIỚI HẠN SET XUỐNG 50
        if (committedSessions.size > 50) committedSessions.delete([...committedSessions][0]);
    }

    apiResponseData = {
        "Phien": sessionId, "Xuc_xac_1": d1, "Xuc_xac_2": d2, "Xuc_xac_3": d3,
        "Tong": total, "Ket_qua": result, "id": "@sewdangcap", "server_time": timestamp,
        "update_count": (apiResponseData.update_count || 0) + 1
    };

    console.log(`[🎲 WIN] Phiên ${sessionId} | ${d1}-${d2}-${d3} = ${total} (${result}) | Nguồn: ${source}`);

    const entry = { session: sessionId, dice: [d1, d2, d3], total, result, timestamp, source };
    patternHistory.push(entry);
    // GIỚI HẠN MẢNG XUỐNG 50
    if (patternHistory.length > 50) patternHistory.shift();
    saveHistoryToDB(entry);
}

// 🛠️ BẢN VÁ: Join Phòng Chủ Động (Aggressive Join)
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
            console.log(`[🔄 UPDATE] Chuyển sang phiên: ${data.sid}`);
        }
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
            if (lastMessageTime && (now - lastMessageTime > 25000)) { 
                console.log(`[🚨 WATCHDOG] Bị kẹt dữ liệu (25s im lặng). Force Reconnect!`);
                isIntentionalClose = true;
                ws.terminate();
                scheduleReconnect();
            }
        }, 5000);
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

            // SỬA LỖI LOGIC: Tìm đúng vị trí mảng/object đầu tiên
            if (rawData && !rawData.startsWith('[') && !rawData.startsWith('{')) {
                const firstBracketIndex = rawData.search(/[[{]/);
                if (firstBracketIndex !== -1) {
                    rawData = rawData.substring(firstBracketIndex);
                } else {
                    return; 
                }
            }

            const data = JSON.parse(rawData);

            if (!Array.isArray(data) || typeof data[1] !== 'object' || data[1] === null) return;
            
            const payload = data[1];
            const cmd = payload.cmd;

            handleSessionTracking(payload);

            // Bắt kết quả
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

app.get('/api/taixiu/history', (req, res) => {
    // SỬA GIỚI HẠN TRẢ VỀ MẶC ĐỊNH LÀ 50
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
    ws_state: ws ? ws.readyState : null,
    uptime: process.uptime().toFixed(1),
    messages_received: messageCount,
    missed_sessions: missedSessionCount,
    last_known_session: lastKnownSessionId
}));

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n=== 🚀 KHỞI ĐỘNG CỖ MÁY CRAWL TÀI XỈU (BẢN TỐI ƯU CHỐNG LỌT KHE) ===`);
    console.log(`[Port] ${PORT}`);
    
    await connectMongoDB();
    startKeepAlive();
    connectWebSocket();
});

process.on('SIGINT', () => {
    console.log('\n[🛑] Tắt máy...');
    if (ws) ws.terminate();
    process.exit(0);
});
