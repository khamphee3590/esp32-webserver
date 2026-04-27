/**
 * preview.js — จำลอง relay + ESP32 ครบวงจรสำหรับ development
 *
 * URL structure (เหมือน production):
 *   /                       → Mock relay dashboard
 *   /login, /register       → Auth pages (bypass อัตโนมัติ)
 *   /d/MOCKDEVICE/          → ESP32 dashboard (data/index.html)
 *   /d/MOCKDEVICE/api/*     → Mock ESP32 APIs
 *   /api/auth/*             → Mock auth APIs
 *   /api/devices            → Mock device list
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const DATA_DIR       = path.join(__dirname, 'data');
const PORT           = 8080;
const MOCK_DEVICE_ID = 'AABBCCDDEEFF';
const MOCK_USER      = { email: 'dev@preview.local' };

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.svg':  'image/svg+xml',
};

// ======= Mock GPIO State =======
const PINS = [
    {name:'D2', gpio:5, analog:false},{name:'D3', gpio:6, analog:false},
    {name:'D4', gpio:7, analog:false},{name:'D5', gpio:8, analog:false},
    {name:'D6', gpio:9, analog:false},{name:'D7', gpio:10,analog:false},
    {name:'D8', gpio:17,analog:false},{name:'D9', gpio:18,analog:false},
    {name:'D10',gpio:21,analog:false},{name:'D11',gpio:38,analog:false},
    {name:'D12',gpio:47,analog:false},{name:'D13',gpio:48,analog:false},
    {name:'A0', gpio:1, analog:true}, {name:'A1', gpio:2, analog:true},
    {name:'A2', gpio:3, analog:true}, {name:'A3', gpio:4, analog:true},
    {name:'A4', gpio:11,analog:true}, {name:'A5', gpio:12,analog:true},
    {name:'A6', gpio:13,analog:true}, {name:'A7', gpio:14,analog:true},
];
const gpioState = {};
PINS.forEach(p => { gpioState[p.name] = { ...p, mode: 0, value: 0 }; });

// จำลอง analog noise
setInterval(() => {
    PINS.filter(p => p.analog).forEach(p => {
        if (gpioState[p.name].mode !== 1)
            gpioState[p.name].value = Math.floor(Math.random() * 4096);
    });
}, 1000);

// ======= Helpers =======
function readBody(req) {
    return new Promise(resolve => {
        let buf = '';
        req.on('data', c => buf += c);
        req.on('end', () => resolve(buf));
    });
}

function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function html(res, body, status = 200) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
}

function redirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function serveFile(res, filePath) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            fs.readFile(path.join(DATA_DIR, '404.html'), (e, d) => {
                html(res, e ? '404 Not Found' : d.toString(), 404);
            });
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
        res.end(data);
    });
}

// ======= Mock Relay Dashboard =======
function dashboardPage() {
    return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — ESP32 Preview</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column}
.navbar{background:#1e293b;border-bottom:1px solid #334155;padding:0 24px;height:56px;
  display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;gap:12px}
.nav-brand{display:flex;align-items:center;gap:6px;text-decoration:none;flex-shrink:0}
.nav-logo{color:#3b82f6;font-size:1.1rem}.nav-title{color:#f1f5f9;font-weight:700;font-size:.95rem}
.nav-right{display:flex;align-items:center;gap:10px}
.nav-user{font-size:.78rem;color:#64748b}
.nav-badge{font-size:.7rem;color:#475569;background:#0f172a;border:1px solid #334155;padding:2px 8px;border-radius:99px}
main{flex:1;padding:28px;max-width:680px;margin:0 auto;width:100%}
.info-box{background:#172554;border:1px solid #1d4ed8;border-radius:10px;
  padding:14px 18px;margin-bottom:16px;font-size:.82rem;color:#93c5fd;line-height:1.7}
.info-box code{background:#0f172a;padding:2px 7px;border-radius:4px;font-size:.8rem}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.page-title{font-size:.85rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.btn-pair{background:#3b82f6;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:.85rem;cursor:pointer}
.summary-bar{display:flex;align-items:center;gap:16px;margin-bottom:18px;
  padding:12px 16px;background:#1e293b;border:1px solid #334155;border-radius:10px}
.summary-stat{display:flex;align-items:center;gap:7px;font-size:.82rem;color:#94a3b8}
.summary-count{font-weight:700;font-size:1rem}
.c-on{color:#22c55e}.c-off{color:#475569}
.summary-sep{color:#334155;font-size:1rem}
.summary-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.sd-on{background:#22c55e}.sd-off{background:#475569}
@keyframes online-pulse{0%,100%{box-shadow:0 0 0 0 #22c55e55}60%{box-shadow:0 0 0 5px #22c55e00}}
.device-card{display:flex;align-items:center;gap:14px;background:#1e293b;
  border:1px solid #334155;border-radius:12px;padding:16px 18px;
  cursor:pointer;margin-bottom:10px;transition:border-color .15s,background .15s}
.device-card:hover{border-color:#3b82f6;background:#1e3a5f22}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.dot-on{background:#22c55e;animation:online-pulse 2.5s infinite}
.dev-info{flex:1;min-width:0}
.dev-top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
.dev-name{font-weight:600;font-size:.95rem;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.role-badge{font-size:.62rem;padding:2px 7px;border-radius:99px;font-weight:600;flex-shrink:0;background:#172554;color:#93c5fd}
.dev-id{font-family:monospace;font-size:.7rem;color:#475569}
.dev-status{font-size:.75rem;margin-top:4px;color:#22c55e}
.dev-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
.arrow{color:#475569;font-size:1.1rem;transition:color .15s}
.device-card:hover .arrow{color:#3b82f6}
footer{text-align:center;padding:16px;color:#334155;font-size:.75rem;border-top:1px solid #1e293b}
@media(max-width:768px){.nav-user{display:none}}
@media(max-width:480px){.navbar{padding:0 12px;height:52px}.nav-title{display:none}main{padding:12px}}
</style></head>
<body>
<nav class="navbar">
  <a class="nav-brand" href="/">
    <span class="nav-logo">⚡</span>
    <span class="nav-title">ESP32 Relay</span>
  </a>
  <div class="nav-right">
    <span class="nav-user">${MOCK_USER.email}</span>
    <span class="nav-badge">Preview Mode</span>
  </div>
</nav>
<main>
  <div class="info-box">
    🛠 <strong>Preview Mode</strong> — Auth bypass อัตโนมัติ<br>
    กดที่การ์ดด้านล่าง หรือเข้าตรงที่ <code>http://localhost:${PORT}/d/${MOCK_DEVICE_ID}/</code>
  </div>
  <div class="page-header">
    <span class="page-title">อุปกรณ์จำลอง</span>
    <button class="btn-pair" disabled>+ เพิ่มอุปกรณ์</button>
  </div>
  <div class="summary-bar">
    <div class="summary-stat">
      <span class="summary-dot sd-on"></span>
      <span class="summary-count c-on">1</span><span>Online</span>
    </div>
    <span class="summary-sep">·</span>
    <div class="summary-stat">
      <span class="summary-dot sd-off"></span>
      <span class="summary-count c-off">0</span><span>Offline</span>
    </div>
  </div>
  <div class="device-card" onclick="location.href='/d/${MOCK_DEVICE_ID}/'">
    <span class="status-dot dot-on"></span>
    <div class="dev-info">
      <div class="dev-top">
        <span class="dev-name">Mock ESP32 Device</span>
        <span class="role-badge">owner</span>
      </div>
      <div class="dev-id">${MOCK_DEVICE_ID}</div>
      <div class="dev-status">● Online (จำลอง)</div>
    </div>
    <div class="dev-actions">
      <span class="arrow">›</span>
    </div>
  </div>
</main>
<footer>ESP32 Preview Server — port ${PORT}</footer>
</body></html>`;
}

// ======= Mock Auth Pages =======
function authBypassPage(title, nextUrl = '/') {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="refresh" content="1;url=${nextUrl}">
<title>${title}</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh}
.box{text-align:center;background:#1e293b;padding:32px;border-radius:14px}
.badge{background:#172554;color:#93c5fd;padding:6px 14px;border-radius:99px;font-size:.8rem;display:inline-block;margin-bottom:16px}
p{color:#64748b;font-size:.85rem;margin-top:8px}</style></head>
<body><div class="box">
<div class="badge">🛠 Preview Mode</div>
<h2 style="color:#3b82f6">${title}</h2>
<p>Auth ถูก bypass — กำลังพาไปที่ <strong>${nextUrl}</strong>...</p>
</div></body></html>`;
}

// ======= Request Handler =======
http.createServer(async (req, res) => {
    const url    = req.url.split('?')[0];
    const method = req.method;

    // --- Relay Dashboard ---
    if (url === '/') return html(res, dashboardPage());

    // --- Auth pages (bypass) ---
    if (url === '/login')            return html(res, authBypassPage('เข้าสู่ระบบ', '/'));
    if (url === '/register')         return html(res, authBypassPage('สมัครสมาชิก', '/login'));
    if (url === '/forgot-password')  return html(res, authBypassPage('ลืมรหัสผ่าน', '/login'));
    if (url === '/reset-password')   return html(res, authBypassPage('ตั้งรหัสผ่านใหม่', '/login'));

    // --- Mock Auth APIs ---
    if (url === '/api/auth/me')
        return json(res, MOCK_USER);

    if (url === '/api/auth/login' || url === '/api/auth/register')
        return json(res, { ok: true });

    if (url === '/api/auth/logout')
        return redirect(res, '/login');

    if (url === '/api/auth/forgot-password' || url === '/api/auth/reset-password')
        return json(res, { ok: true });

    // --- Mock Devices API ---
    if (url === '/api/devices' && method === 'GET') {
        return json(res, [{
            device_id: MOCK_DEVICE_ID,
            name: 'Mock ESP32 Device',
            last_seen: Date.now(),
            online: true,
            role: 'owner',
        }]);
    }

    if (url === '/api/devices/pair' && method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (body.pairingCode === '123456')
            return json(res, { ok: true, device: { device_id: MOCK_DEVICE_ID, name: 'Mock ESP32 Device' } });
        return json(res, { error: 'Pairing Code ไม่ถูกต้อง (ใช้ 123456 ใน preview)' }, 404);
    }

    // --- OTA (local mode: POST /ota) ---
    if (url.startsWith('/ota') && method === 'POST') {
        let size = 0;
        req.on('data', chunk => { size += chunk.length; });
        req.on('end', () => {
            console.log(`[OTA Mock] Received ${size} bytes`);
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            }, 1500);
        });
        return;
    }

    // --- Device Proxy: /d/:deviceId/* ---
    const devMatch = url.match(/^\/d\/([^/]+)(\/.*)?$/);
    if (devMatch) {
        const subPath = devMatch[2] || '/';
        return handleDevice(req, res, subPath);
    }

    // --- 404 ---
    html(res, '<h1 style="font-family:sans-serif;padding:40px;color:#e2e8f0;background:#0f172a;min-height:100vh">404 Not Found</h1>', 404);

}).listen(PORT, () => {
    console.log(`Preview:  http://localhost:${PORT}/`);
    console.log(`Device:   http://localhost:${PORT}/d/${MOCK_DEVICE_ID}/`);
    console.log(`Pairing code จำลอง: 123456`);
});

// ======= Mock Relay DB =======
const mockLabels  = {}; // pin → label
const mockDevName = { name: 'Mock ESP32 Device' };
const mockUsers   = [
    { userId: 1, email: 'dev@preview.local', role: 'owner',  joined_at: Date.now() },
    { userId: 2, email: 'editor@example.com', role: 'editor', joined_at: Date.now() },
];

// ======= Device Request Handler =======
async function handleDevice(req, res, subPath) {
    const method = req.method;

    // --- ESP32 APIs (forwarded in production) ---
    if (subPath === '/api/status') {
        return json(res, {
            status:   'ok',
            ip:       '192.168.1.100',
            rssi:     -55,
            uptime:   Math.floor(Date.now() / 1000 % 86400),
            name:     mockDevName.name,
            deviceId: MOCK_DEVICE_ID,
        });
    }

    if (subPath === '/api/gpio' && method === 'GET')
        return json(res, { pins: PINS.map(p => ({ ...gpioState[p.name] })) });

    if (subPath === '/api/gpio/set' && method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (gpioState[body.pin]) {
            gpioState[body.pin].mode  = body.mode;
            gpioState[body.pin].value = body.mode === 1 ? body.value : gpioState[body.pin].value;
        }
        return json(res, { ok: true });
    }

    // --- Relay-managed APIs (intercepted in production) ---
    if (subPath === '/api/gpio/labels') {
        if (method === 'GET')
            return json(res, Object.entries(mockLabels).map(([pin_name, label]) => ({ device_id: MOCK_DEVICE_ID, pin_name, label })));
        if (method === 'PUT') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (body.pin) mockLabels[body.pin] = body.label ?? '';
            return json(res, { ok: true });
        }
    }

    if (subPath === '/api/device/info') {
        if (method === 'GET')
            return json(res, { device_id: MOCK_DEVICE_ID, name: mockDevName.name, pairing_code: '123456', role: 'owner' });
        if (method === 'PUT') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (body.name) mockDevName.name = body.name;
            return json(res, { ok: true });
        }
    }

    if (subPath === '/api/device/users') {
        if (method === 'GET')  return json(res, mockUsers);
        if (method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            if (!body.email) return json(res, { error: 'email required' }, 400);
            mockUsers.push({ userId: Date.now(), email: body.email, role: body.role || 'editor', joined_at: Date.now() });
            return json(res, { ok: true });
        }
    }

    const removeMatch = subPath.match(/^\/api\/device\/users\/(\d+)$/);
    if (removeMatch && method === 'DELETE') {
        const id = Number(removeMatch[1]);
        const idx = mockUsers.findIndex(u => u.userId === id);
        if (idx >= 0) mockUsers.splice(idx, 1);
        return json(res, { ok: true });
    }

    // --- OTA mock (local mode: /ota, relay mode: /d/:id/ota) ---
    if (subPath === '/ota' && method === 'POST') {
        let size = 0;
        req.on('data', chunk => { size += chunk.length; });
        req.on('end', () => {
            console.log(`[OTA Mock] Received ${size} bytes — type: ${req.url.includes('type=fs') ? 'filesystem' : 'firmware'}`);
            // จำลอง delay การ flash
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
                console.log('[OTA Mock] Upload successful (simulated)');
            }, 1500);
        });
        return;
    }

    // --- Static files from data/ ---
    const filePath = path.join(DATA_DIR, subPath === '/' ? 'index.html' : subPath);
    serveFile(res, filePath);
}
