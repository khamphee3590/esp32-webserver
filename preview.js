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
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
header{background:#1e293b;padding:16px 28px;border-bottom:2px solid #3b82f6;
display:flex;align-items:center;justify-content:space-between}
h1{color:#3b82f6;font-size:1.3rem}
.badge{background:#1e3a5f;color:#93c5fd;padding:4px 10px;border-radius:99px;font-size:.72rem}
main{padding:28px;max-width:680px;margin:0 auto}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
h2{font-size:.85rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.device-card{display:flex;align-items:center;gap:16px;background:#1e293b;
border:1px solid #334155;border-radius:12px;padding:16px 20px;text-decoration:none;
color:inherit;margin-bottom:12px;transition:border-color .15s}
.device-card:hover{border-color:#3b82f6}
.dot{width:10px;height:10px;border-radius:50%;background:#22c55e;flex-shrink:0}
.dev-info{flex:1}
.dev-name{font-weight:600;font-size:1rem;color:#f1f5f9}
.dev-id{font-family:monospace;font-size:.72rem;color:#475569;margin-top:2px}
.dev-on{font-size:.75rem;color:#22c55e;margin-top:2px}
.arrow{color:#334155;font-size:1.2rem}
.info-box{background:#172554;border:1px solid #1d4ed8;border-radius:10px;
padding:14px 18px;margin-bottom:20px;font-size:.82rem;color:#93c5fd;line-height:1.6}
.info-box code{background:#0f172a;padding:2px 7px;border-radius:4px;font-size:.8rem}
footer{text-align:center;padding:20px;color:#334155;font-size:.75rem}
</style></head>
<body>
<header>
  <h1>ESP32 Relay</h1>
  <span class="badge">Preview Mode — ${MOCK_USER.email}</span>
</header>
<main>
  <div class="info-box">
    🛠 <strong>Preview Mode</strong> — Auth ถูก bypass อัตโนมัติ<br>
    กดที่การ์ดด้านล่างเพื่อเข้าสู่หน้าควบคุม GPIO<br>
    หรือเข้าตรงที่ <code>http://localhost:${PORT}/d/${MOCK_DEVICE_ID}/</code>
  </div>
  <div class="toolbar">
    <h2>อุปกรณ์จำลอง (1)</h2>
  </div>
  <a class="device-card" href="/d/${MOCK_DEVICE_ID}/">
    <span class="dot"></span>
    <div class="dev-info">
      <div class="dev-name">Mock ESP32 Device</div>
      <div class="dev-id">${MOCK_DEVICE_ID}</div>
      <div class="dev-on">Online (จำลอง)</div>
    </div>
    <span class="arrow">→</span>
  </a>
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

    // --- Static files from data/ ---
    const filePath = path.join(DATA_DIR, subPath === '/' ? 'index.html' : subPath);
    serveFile(res, filePath);
}
