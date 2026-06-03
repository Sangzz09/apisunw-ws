// get.js - Sun.Win Tài Xỉu Data Stream (Node.js)
import WebSocket from 'ws';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import https from 'https';

const app = express();
app.use(cors());
const PORT = parseInt(process.env.PORT || '1234');

// Global variables
let currentResult = {
  phien: null,
  xuc_xac_1: null,
  xuc_xac_2: null,
  xuc_xac_3: null,
  tong: null,
  ket_qua: '',
  thoi_gian: ''
};

let currentSessionId = null;
let wsConnection = null;
const reconnectDelay = 2500; // milliseconds
const startTime = Date.now();

// Hàm lấy thời gian Việt Nam (UTC+7)
function getVietnamTime() {
  const now = new Date();
  const utc7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(utc7.getUTCDate())}-${pad(utc7.getUTCMonth() + 1)}-${utc7.getUTCFullYear()} ${pad(utc7.getUTCHours())}:${pad(utc7.getUTCMinutes())}:${pad(utc7.getUTCSeconds())} UTC+7`;
}

function parseTokenData(tokenText) {
  try {
    // Tìm và trích xuất info JSON
    const infoMatch = tokenText.match(/"info"\x07([^"]+?)"?/);
    if (infoMatch) {
      let infoStr = infoMatch[1];
      infoStr = infoStr.replace(/[\x04\x05\x06\x07]/g, '');
      return JSON.parse(infoStr);
    }

    // Nếu không tìm thấy info, tìm trực tiếp JSON
    const jsonMatch = tokenText.match(/\{[^{}]*"ipAddress"[^{}]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return null;
  } catch (e) {
    console.log(`[❌] Lỗi parse token: ${e.message}`);
    return null;
  }
}

function loadToken() {
  try {
    const tokenData = fs.readFileSync('token.txt', 'utf-8').trim();

    if (!tokenData) {
      console.log('[❌] File token.txt trống');
      return null;
    }

    const parsed = parseTokenData(tokenData);
    if (parsed) {
      console.log('[✅] Đã load token từ token.txt');
      return parsed;
    } else {
      console.log('[❌] Không thể parse token từ token.txt');
      return null;
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('[❌] Không tìm thấy file token.txt');
    } else {
      console.log(`[❌] Lỗi đọc token.txt: ${e.message}`);
    }
    return null;
  }
}

// Load token data
const TOKEN_DATA = loadToken();

let WEBSOCKET_URL;
const WS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Origin': 'https://play.sun.pw'
};
let initialMessages;

if (TOKEN_DATA) {
  WEBSOCKET_URL = `wss://websocket.azhkthg1.net/websocket?token=${TOKEN_DATA.wsToken || ''}`;

  initialMessages = [
    [
      1,
      'MiniGame',
      TOKEN_DATA.username || 'GM_quapotjz',
      'quapit',
      {
        signature: '05915B436159B8F4E4DFF537639BD014D54EBEFA18CF62A8EB205B4074010AD72AEA9A780D5A8A4E1BD59BBBAFE03902C594B5DA56FD60D099F1FDDCCD48385FCC2760B5B0B4B8E75D39B8E40DF8CB7C01EA58DBEDA32805927473AB71FA9B798B0C2EDC445C3E36E47EF0AAFAD45601D99AAD1EC642FD2B63573A0401D6EC69',
        expireIn: TOKEN_DATA.timestamp || 1774138177205,
        wsToken: TOKEN_DATA.wsToken || '',
        accessToken: '7e9a9ecbff1b4a6393b48346f6d8b709',
        message: 'Thành công',
        refreshToken: TOKEN_DATA.refreshToken || '',
        info: TOKEN_DATA
      }
    ],
    [6, 'MiniGame', 'taixiuPlugin', { cmd: 1005 }],
    [6, 'MiniGame', 'lobbyPlugin', { cmd: 10001 }]
  ];
} else {
  console.log('[❌] Không thể load token, sử dụng token mặc định (có thể không hoạt động)');
  WEBSOCKET_URL = 'wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJsb2xtYW1heXN1MTIiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMzkxMDEyNTEsImFmZklkIjoiR0VNV0lOIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJnZW0iLCJlbWFpbCI6IiIsInRpbWVzdGFtcCI6MTc3NDEzODE3NzIwNCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDA1OjQ4MDI6NGU0Mjo0MTcwOjcxMDQ6YjY0Njo2Nzg5Ojg2NDgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzA5LnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6ImEyOGEwZjA2LWU4OGYtNDRiNy1hMjY4LTVmNmRhZDk0OWZiZiIsImVtYWlsVmVyaWZpZWQiOm51bGwsInJlZ1RpbWUiOjE3NzMxMDY2NDkxOTksInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fcXVhcG90anoifQ.3ycgvK1-PwRpBqANZJ3li00kpuzV6Ike6ZjYPthf3X0';

  initialMessages = [
    [
      1,
      'MiniGame',
      'GM_quapotjz',
      'quapit',
      {
        signature: '05915B436159B8F4E4DFF537639BD014D54EBEFA18CF62A8EB205B4074010AD72AEA9A780D5A8A4E1BD59BBBAFE03902C594B5DA56FD60D099F1FDDCCD48385FCC2760B5B0B4B8E75D39B8E40DF8CB7C01EA58DBEDA32805927473AB71FA9B798B0C2EDC445C3E36E47EF0AAFAD45601D99AAD1EC642FD2B63573A0401D6EC69',
        expireIn: 1774138177205,
        wsToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJsb2xtYW1heXN1MTIiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMzkxMDEyNTEsImFmZklkIjoiR0VNV0lOIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJnZW0iLCJlbWFpbCI6IiIsInRpbWVzdGFtcCI6MTc3NDEzODE3NzIwNCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDA1OjQ4MDI6NGU0Mjo0MTcwOjcxMDQ6YjY0Njo2Nzg5Ojg2NDgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzA5LnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6ImEyOGEwZjA2LWU4OGYtNDRiNy1hMjY4LTVmNmRhZDk0OWZiZiIsImVtYWlsVmVyaWZpZWQiOm51bGwsInJlZ1RpbWUiOjE3NzMxMDY2NDkxOTksInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fcXVhcG90anoifQ.3ycgvK1-PwRpBqANZJ3li00kpuzV6Ike6ZjYPthf3X0',
        accessToken: '7e9a9ecbff1b4a6393b48346f6d8b709',
        message: 'Thành công',
        refreshToken: '950f5b9974dd4f4c982a3681af9acbc7.f0d252e72ee64f07bd5819d6ca54bba1',
        info: {
          ipAddress: '2405:4802:4e42:4170:7104:b646:6789:8648',
          wsToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJsb2xtYW1heXN1MTIiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMzkxMDEyNTEsImFmZklkIjoiR0VNV0lOIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJnZW0iLCJlbWFpbCI6IiIsInRpbWVzdGFtcCI6MTc3NDEzODE3NzIwNCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOmZhbHNlLCJpcEFkZHJlc3MiOiIyNDA1OjQ4MDI6NGU0Mjo0MTcwOjcxMDQ6YjY0Njo2Nzg5Ojg2NDgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzA5LnBuZyIsInBsYXRmb3JtSWQiOjQsInVzZXJJZCI6ImEyOGEwZjA2LWU4OGYtNDRiNy1hMjY4LTVmNmRhZDk0OWZiZiIsImVtYWlsVmVyaWZpZWQiOm51bGwsInJlZ1RpbWUiOjE3NzMxMDY2NDkxOTksInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fcXVhcG90anoifQ.3ycgvK1-PwRpBqANZJ3li00kpuzV6Ike6ZjYPthf3X0',
          locale: 'vi',
          userId: 'a28a0f06-e88f-44b7-a268-5f6dad949fbf',
          username: 'GM_quapotjz',
          timestamp: 1774138177205,
          refreshToken: '950f5b9974dd4f4c982a3681af9acbc7.f0d252e72ee64f07bd5819d6ca54bba1'
        }
      }
    ],
    [6, 'MiniGame', 'taixiuPlugin', { cmd: 1005 }],
    [6, 'MiniGame', 'lobbyPlugin', { cmd: 10001 }]
  ];
}

function getNetworkInfo() {
  try {
    const hostname = os.hostname();
    const ifaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    for (const iface of Object.values(ifaces)) {
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          localIP = addr.address;
          break;
        }
      }
    }

    return new Promise((resolve) => {
      https.get('https://api.ipify.org?format=json', { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const publicIP = JSON.parse(data).ip;
            resolve({ localIP, publicIP });
          } catch {
            resolve({ localIP, publicIP: null });
          }
        });
      }).on('error', () => resolve({ localIP, publicIP: null }));
    });
  } catch (e) {
    console.log(`Lỗi lấy network info: ${e.message}`);
    return Promise.resolve({ localIP: '127.0.0.1', publicIP: null });
  }
}

function handleError(context, error) {
  const msg = `Lỗi - ${context}: ${error.message || error}`;
  console.log(`[❌] ${msg}`);
  return msg;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWebSocket() {
  while (true) {
    try {
      console.log('[🔄] Đang kết nối WebSocket...');

      wsConnection = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

      await new Promise((resolve, reject) => {
        wsConnection.on('open', resolve);
        wsConnection.on('error', reject);
      });

      console.log('[✅] WebSocket connected to Sun.Win');

      // Gửi initial messages với delay
      for (let i = 0; i < initialMessages.length; i++) {
        await sleep(i * 600);
        wsConnection.send(JSON.stringify(initialMessages[i]));
      }

      // Nhận messages
      await new Promise((resolve, reject) => {
        wsConnection.on('message', (raw) => {
          try {
            const data = JSON.parse(raw.toString());

            if (!Array.isArray(data) || data.length < 2) return;

            if (data[1] && typeof data[1] === 'object') {
              const { cmd, sid, d1, d2, d3, gBB } = data[1];

              if (cmd === 1008 && sid) {
                currentSessionId = sid;
                console.log(`[🎮] Phiên mới: ${sid}`);
              }

              if (cmd === 1003 && gBB) {
                if (d1 == null || d2 == null || d3 == null) return;

                const total = d1 + d2 + d3;
                const result = total > 10 ? 'Tài' : 'Xỉu';

                currentResult = {
                  phien: currentSessionId,
                  xuc_xac_1: d1,
                  xuc_xac_2: d2,
                  xuc_xac_3: d3,
                  tong: total,
                  ket_qua: result,
                  thoi_gian: getVietnamTime()
                };

                console.log(`[🎲] Phiên ${currentResult.phien}: ${d1}-${d2}-${d3} = ${total} (${result}) - ${currentResult.thoi_gian}`);
                currentSessionId = null;
              }
            }
          } catch (e) {
            handleError('Parse JSON', e);
          }
        });

        wsConnection.on('close', resolve);
        wsConnection.on('error', reject);
      });

      handleError('WebSocket đóng', new Error('Connection closed'));
    } catch (e) {
      handleError('Kết nối WebSocket', e);
    }

    await sleep(reconnectDelay);
  }
}

// Flask routes -> Express routes
app.get('/api/tx', (req, res) => {
  res.json(currentResult);
});

app.get('/', (req, res) => {
  res.json({
    name: 'Sun.Win Tài Xỉu Data Stream',
    version: '1.0',
    endpoints: {
      '/api/tx': 'Lấy kết quả tài xỉu mới nhất'
    },
    thoi_gian: getVietnamTime(),
    current_user: TOKEN_DATA ? TOKEN_DATA.username : 'Unknown'
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint không tồn tại. Chỉ có /api/tx' });
});

async function main() {
  const networkInfo = await getNetworkInfo();

  console.log('\n' + '='.repeat(60));
  console.log('🎲 Sun.Win Tài Xỉu Data Stream');
  console.log('='.repeat(60));
  if (TOKEN_DATA) {
    console.log(`👤 Đang dùng token của: ${TOKEN_DATA.username || 'Unknown'}`);
    console.log(`🆔 User ID: ${TOKEN_DATA.userId || 'Unknown'}`);
    console.log(`🌐 IP: ${TOKEN_DATA.ipAddress || 'Unknown'}`);
  }
  console.log(`📡 Server running on:`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Network: http://${networkInfo.localIP}:${PORT}`);
  console.log('='.repeat(60));
  console.log('🔌 Connecting to Sun.Win WebSocket...');
  console.log('='.repeat(60) + '\n');
  console.log('📊 API Endpoint:');
  console.log(`   🎯 /api/tx - Lấy kết quả tài xỉu mới nhất`);
  console.log('='.repeat(60) + '\n');

  // Chạy Express server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[✅] Express server running on port ${PORT}`);
  });

  // Kết nối WebSocket
  await connectWebSocket();
}

process.on('SIGINT', () => {
  console.log('\n[👋] Đang tắt server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[👋] Đang tắt server...');
  process.exit(0);
});

main().catch((e) => handleError('Main', e));
