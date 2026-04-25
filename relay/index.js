const express    = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http       = require('http');

const app        = express();
const httpServer = http.createServer(app);
const wss        = new WebSocketServer({ server: httpServer, path: '/tunnel' });

const TIMEOUT_MS = 10000;

// deviceId → WebSocket
const devices = new Map();
const pending = new Map(); // requestId → { res, timer }

app.use(express.json());

// ======= Helpers =======
function offlinePage(deviceId) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Device Offline</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center}.icon{font-size:4rem}.id{font-family:monospace;font-size:.9rem;
color:#475569;margin-top:8px}h2{color:#f59e0b;margin-top:16px}p{color:#94a3b8;margin-top:8px}
a{color:#3b82f6;text-decoration:none;display:inline-block;margin-top:20px;
padding:10px 24px;border:1px solid #3b82f6;border-radius:8px}
a:hover{background:#1e3a5f}</style>
</head><body><div class="box">
<div class="icon">📡</div>
<div class="id">${deviceId}</div>
<h2>Device Offline</h2>
<p>อุปกรณ์ยังไม่ได้เชื่อมต่อ หรือกำลังรีสตาร์ท</p>
<a href="/">← รายการอุปกรณ์</a>
</div></body></html>`;
}

function dashboardPage() {
    const list = Array.from(devices.keys());
    const items = list.length === 0
        ? '<p class="empty">ยังไม่มีอุปกรณ์เชื่อมต่อ</p>'
        : list.map(id => `
            <a class="card" href="/d/${id}/">
              <span class="dot"></span>
              <div class="info">
                <div class="dev-id">${id}</div>
                <div class="dev-status">Online</div>
              </div>
              <span class="arrow">→</span>
            </a>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Relay</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
header{background:#1e293b;padding:20px 32px;border-bottom:2px solid #3b82f6}
h1{color:#3b82f6;font-size:1.5rem}header p{color:#94a3b8;font-size:.85rem;margin-top:4px}
main{padding:32px;max-width:600px;margin:0 auto}
h2{font-size:1rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:16px}
.card{display:flex;align-items:center;gap:16px;background:#1e293b;border:1px solid #334155;
border-radius:12px;padding:16px 20px;text-decoration:none;color:inherit;margin-bottom:12px;transition:border-color .2s}
.card:hover{border-color:#3b82f6}
.dot{width:10px;height:10px;border-radius:50%;background:#22c55e;flex-shrink:0}
.info{flex:1}.dev-id{font-family:monospace;font-size:.95rem;font-weight:600;color:#f1f5f9}
.dev-status{font-size:.75rem;color:#22c55e;margin-top:2px}
.arrow{color:#475569;font-size:1.2rem}
.empty{color:#475569;text-align:center;padding:40px;background:#1e293b;border-radius:12px}
footer{text-align:center;padding:24px;color:#334155;font-size:.75rem}
</style></head>
<body>
<header><h1>ESP32 Relay</h1><p>Device Management Dashboard</p></header>
<main>
  <h2>อุปกรณ์ที่เชื่อมต่ออยู่ (${list.length})</h2>
  ${items}
</main>
<footer>ESP32 Relay Server</footer>
<script>setTimeout(()=>location.reload(), 10000);</script>
</body></html>`;
}

// ======= WebSocket: รับการเชื่อมต่อจาก ESP32 =======
wss.on('connection', (ws, req) => {
    let deviceId = null;
    console.log(`[WS] New connection from ${req.socket.remoteAddress}`);

    ws.on('message', (raw) => {
        const text = raw.toString();
        const nl   = text.indexOf('\n');
        const jsonPart = nl >= 0 ? text.slice(0, nl) : text;
        const body     = nl >= 0 ? text.slice(nl + 1) : '';

        let msg;
        try { msg = JSON.parse(jsonPart); } catch { return; }

        // ESP32 ลงทะเบียนด้วย deviceId
        if (msg.type === 'hello') {
            deviceId = msg.deviceId;
            // ถ้ามี connection เก่าอยู่ให้ปิดก่อน (reconnect กรณี)
            if (devices.has(deviceId)) {
                console.log(`[Device] ${deviceId} reconnected — closing old socket`);
                devices.get(deviceId).terminate();
            }
            devices.set(deviceId, ws);
            console.log(`[Device] ${deviceId} registered (total: ${devices.size})`);
            return;
        }

        // ESP32 ส่ง response กลับ
        if (msg.type === 'response' && pending.has(msg.id)) {
            const { res, timer } = pending.get(msg.id);
            clearTimeout(timer);
            pending.delete(msg.id);
            res.status(msg.status).type(msg.contentType || 'text/plain').send(body);
        }
    });

    ws.on('close', () => {
        if (deviceId && devices.get(deviceId) === ws) {
            devices.delete(deviceId);
            console.log(`[Device] ${deviceId} disconnected (total: ${devices.size})`);
        }
    });

    ws.on('error', (err) => console.error('[WS]', err.message));
});

// ======= HTTP Routes =======

// หน้าแรก: list อุปกรณ์ทั้งหมด
app.get('/', (req, res) => res.send(dashboardPage()));

// Health check
app.get('/healthz', (req, res) => {
    res.json({
        relay:   'ok',
        devices: Array.from(devices.keys()).map(id => ({ id, online: true })),
    });
});

// Route ไปยัง ESP32 ตัวที่ระบุ: /d/:deviceId/*
app.use('/d/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const ws = devices.get(deviceId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return res.status(503).send(offlinePage(deviceId));
    }

    // req.path คือ path หลังจาก /d/:deviceId เช่น /api/gpio
    const path = req.path || '/';
    const id   = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const timer = setTimeout(() => {
        if (pending.has(id)) {
            pending.delete(id);
            res.status(504).send('Gateway Timeout: ESP32 did not respond in time');
        }
    }, TIMEOUT_MS);

    pending.set(id, { res, timer });

    ws.send(JSON.stringify({
        type:   'request',
        id,
        method: req.method,
        path,
        query:  req.query,
        body:   req.body ? JSON.stringify(req.body) : '',
    }));
});

// ======= Start =======
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Relay server on port ${PORT}`);
    console.log(`Dashboard:    http://localhost:${PORT}/`);
    console.log(`Health check: http://localhost:${PORT}/healthz`);
});
