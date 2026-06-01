const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

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

let currentSessionId = null;
const patternHistory = [];

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
let reconnectTimeout = null;
let wsConnectedAt = null;
let messageCount = 0;
let lastMessageTime = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;

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
    console.log(`[🔄] Đang kết nối WebSocket... (lần thứ ${reconnectAttempts})`);
    
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
        
        console.log('[✅] WebSocket đã kết nối đến Sun.Win');
        console.log('[ℹ️] Đang gửi messages khởi tạo...');

        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify(msg));
                        console.log(`[📤] Gửi message ${i + 1}/${initialMessages.length}`);
                    } catch (error) {
                        console.error(`[❌] Lỗi gửi message ${i + 1}:`, error.message);
                    }
                }
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
                    try {
                        ws.send(JSON.stringify(heartbeatMessage));
                        console.log('[💓] Gửi heartbeat...');
                    } catch (error) {
                        console.error('[❌] Lỗi gửi heartbeat:', error.message);
                    }
                }
            }
        }, HEARTBEAT_INTERVAL);
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
                console.log(`[📥] Message #${messageCount}: type=${data[0]}, cmd=${data[1]?.cmd || 'N/A'}`);
            }

            if (!Array.isArray(data) || typeof data[1] !== 'object') return;

            const { cmd, sid, d1, d2, d3, gBB } = data[1];

            if (cmd === 1003) {
                console.log(`[🎲] Nhận cmd=1003: d1=${d1}, d2=${d2}, d3=${d3}, gBB=${gBB}`);
            }

            if (cmd === 1008 && sid) {
                currentSessionId = sid;
                console.log(`[🎮] Phiên mới bắt đầu: ${sid}`);
            }

            if (cmd === 1003 && gBB) {
                if (!d1 || !d2 || !d3) {
                    console.log('[⚠️] Thiếu dữ liệu xúc xắc, bỏ qua');
                    return;
                }

                const total = d1 + d2 + d3;
                const result = (total >= 11) ? "Tài" : "Xỉu";
                const receiveTime = new Date().toISOString();

                const sessionToUse = currentSessionId || apiResponseData.Phien;

                apiResponseData = {
                    "Phien": sessionToUse,
                    "Xuc_xac_1": d1,
                    "Xuc_xac_2": d2,
                    "Xuc_xac_3": d3,
                    "Tong": total,
                    "Ket_qua": result,
                    "id": "@sewdangcap",
                    "server_time": receiveTime,
                    "update_count": (apiResponseData.update_count || 0) + 1
                };

                console.log(`[🎲✅] KẾT QUẢ: Phiên ${sessionToUse}: ${d1}-${d2}-${d3} = ${total} (${result}) | ${receiveTime}`);
                console.log(`[ℹ️] Tổng số lần cập nhật: ${apiResponseData.update_count}`);

                patternHistory.push({
                    session: sessionToUse,
                    dice: [d1, d2, d3],
                    total: total,
                    result: result,
                    timestamp: receiveTime
                });

                if (patternHistory.length > 100) {
                    patternHistory.shift();
                }
            }
        } catch (e) {
            console.error('[❌] Lỗi xử lý message:', e.message);
        }
    });

    ws.on('close', (code, reason) => {
        const uptime = wsConnectedAt ? ((Date.now() - wsConnectedAt) / 1000).toFixed(1) + 's' : 'N/A';
        console.log(`[🔌] WebSocket đóng. Code: ${code}, Reason: ${reason.toString()}, Uptime: ${uptime}`);
        console.log(`[ℹ️] Tổng messages đã nhận: ${messageCount}`);
        
        clearInterval(pingInterval);
        clearInterval(heartbeatInterval);
        
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
    console.log(`[⏳] Sẽ reconnect sau ${delay/1000}s...`);
    reconnectTimeout = setTimeout(connectWebSocket, delay);
}

// ========== API ENDPOINTS ==========

// 1. API chính trả về dữ liệu giống ảnh (endpoint gốc)
app.get('/', (req, res) => {
    res.json(apiResponseData);
});

// 2. API trả về dữ liệu đẹp, có format giống ảnh
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

// 3. API trả về JSON đẹp (có indent)
app.get('/api/print', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(apiResponseData, null, 2));
});

// 4. API lấy lịch sử kết quả
app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const recentHistory = patternHistory.slice(-limit);
    
    res.json({
        total: patternHistory.length,
        limit: limit,
        data: recentHistory,
        latest: apiResponseData
    });
});

// 5. API health check
app.get('/api/health', (req, res) => {
    const now = Date.now();
    const timeSinceLastMessage = lastMessageTime ? Math.floor((now - lastMessageTime) / 1000) : null;
    
    res.json({
        status: 'online',
        websocket_state: ws ? ['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState] : 'NULL',
        websocket_connected: ws ? ws.readyState === WebSocket.OPEN : false,
        uptime_seconds: process.uptime().toFixed(2),
        memory: process.memoryUsage(),
        total_received: apiResponseData.update_count || 0,
        message_count: messageCount,
        last_message_seconds_ago: timeSinceLastMessage,
        reconnect_attempts: reconnectAttempts,
        connection_uptime: wsConnectedAt ? Math.floor((now - wsConnectedAt) / 1000) : null
    });
});

// 6. API debug chi tiết
app.get('/api/debug', (req, res) => {
    res.json({
        apiData: apiResponseData,
        currentSessionId,
        historyCount: patternHistory.length,
        lastHistoryItem: patternHistory[patternHistory.length - 1] || null,
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
    console.log(`   ✅ /           - Kết quả hiện tại (giống ảnh)`);
    console.log(`   ✅ /api/ket-qua - Kết quả hiện tại (giống ảnh)`);
    console.log(`   ✅ /api/print   - Kết quả đẹp (có indent)`);
    console.log(`   ✅ /api/history - Lịch sử kết quả`);
    console.log(`   ✅ /api/health  - Kiểm tra trạng thái`);
    console.log(`   ✅ /api/debug   - Thông tin debug`);
    console.log(`=========================================\n`);
    
    connectWebSocket();
});

process.on('SIGINT', () => {
    console.log('\n[🛑] Đang tắt server...');
    if (ws) {
        ws.terminate();
    }
    process.exit(0);
});
