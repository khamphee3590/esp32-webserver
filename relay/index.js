require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const { WebSocketServer, WebSocket } = require('ws');
const http         = require('http');
const path         = require('path');
const fs           = require('fs');
const db           = require('./db');
const { router: authRouter, JWT_SECRET } = require('./auth');

// ESP32 dashboard HTML served by the relay.
const ESP32_DASHBOARD_PATH = path.resolve(__dirname, '..', 'data', 'index.html');
console.log('[Relay] ESP32 dashboard path:', ESP32_DASHBOARD_PATH);

const app        = express();
const httpServer = http.createServer(app);
const wss        = new WebSocketServer({ server: httpServer, path: '/tunnel' });

const TIMEOUT_MS = 10000;

// deviceId → WebSocket
const devices = new Map();
const pending = new Map();

app.use(express.json());
app.use(cookieParser());
app.use(authRouter); // login / register / forgot / reset pages + /api/auth/*

// ======= Async wrapper — catch unhandled rejections in routes =======
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// Express error handler
process.on('unhandledRejection', (err) => console.error('[UnhandledRejection]', err));

// ======= Auth Middleware =======
function authRequired(req, res, next) {
    try {
        req.user = jwt.verify(req.cookies?.token, JWT_SECRET);
        next();
    } catch {
        res.clearCookie('token');
        const isNavigation = req.headers['sec-fetch-mode'] === 'navigate';
        return isNavigation
            ? res.redirect('/login?next=' + encodeURIComponent(req.originalUrl))
            : res.status(401).json({ error: 'Unauthorized' });
    }
}

// ======= Helper Pages =======
function offlinePage(deviceId) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Device Offline</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center}.icon{font-size:4rem}
.id{font-family:monospace;font-size:.9rem;color:#475569;margin-top:8px}
h2{color:#f59e0b;margin-top:16px}p{color:#94a3b8;margin-top:8px}
a{color:#3b82f6;text-decoration:none;display:inline-block;margin-top:20px;
padding:10px 24px;border:1px solid #3b82f6;border-radius:8px}
a:hover{background:#172554}</style>
</head><body><div class="box">
<div class="icon">📡</div>
<div class="id">${deviceId}</div>
<h2>Device Offline</h2>
<p>อุปกรณ์ยังไม่ได้เชื่อมต่อ หรือกำลังรีสตาร์ท</p>
<a href="/">← รายการอุปกรณ์</a>
</div></body></html>`;
}

// Dashboard page — serves React-based static file
function dashboardPage() {
    return path.join(__dirname, 'public', 'dashboard.html');
}

function sendEsp32Dashboard(res) {
    let html;
    try {
        html = fs.readFileSync(ESP32_DASHBOARD_PATH, 'utf8');
    } catch (e) {
        console.error('[Relay] Cannot load ESP32 dashboard:', e.message);
        return res.status(503).send('Dashboard file not found');
    }

    res.set('Cache-Control', 'no-store');
    return res.type('html').send(html);
}

// ======= WebSocket: รับการเชื่อมต่อจาก ESP32 =======
wss.on('connection', (ws, req) => {
    let deviceId = null;

    ws.on('message', async (raw) => {
        const text     = raw.toString();
        const nl       = text.indexOf('\n');
        const jsonPart = nl >= 0 ? text.slice(0, nl) : text;
        const body     = nl >= 0 ? text.slice(nl + 1) : '';

        let msg;
        try { msg = JSON.parse(jsonPart); } catch { return; }

        if (msg.type === 'hello') {
            const nextDeviceId = String(msg.deviceId || '').trim();
            const pairingCode  = String(msg.pairingCode || '').trim();
            if (!/^[A-Fa-f0-9]{12}$/.test(nextDeviceId) || !/^\d{6}$/.test(pairingCode)) {
                ws.close(1008, 'Invalid device identity');
                return;
            }

            const existing = await db.getDeviceById(nextDeviceId);
            if (existing?.pairing_code && existing.pairing_code !== pairingCode) {
                ws.close(1008, 'Invalid pairing code');
                return;
            }

            deviceId = nextDeviceId;
            await db.upsertDevice(deviceId, msg.name, pairingCode);
            if (devices.has(deviceId)) devices.get(deviceId).terminate();
            devices.set(deviceId, ws);
            console.log(`[Device] ${deviceId} "${msg.name || ''}" connected (total: ${devices.size})`);
            return;
        }

        if (msg.type === 'response' && pending.has(msg.id)) {
            const { res, timer } = pending.get(msg.id);
            clearTimeout(timer);
            pending.delete(msg.id);
            res.status(msg.status).type(msg.contentType || 'text/plain').send(body);
        }
    });

    ws.on('close', async () => {
        if (deviceId && devices.get(deviceId) === ws) {
            devices.delete(deviceId);
            await db.touchDevice(deviceId);
            for (const [pid, entry] of pending) {
                if (entry.deviceId === deviceId) {
                    clearTimeout(entry.timer);
                    pending.delete(pid);
                    try { entry.res.status(503).send(offlinePage(deviceId)); } catch {}
                }
            }
            console.log(`[Device] ${deviceId} disconnected (total: ${devices.size})`);
        }
    });

    ws.on('error', (err) => console.error('[WS]', err.message));
});

// ======= HTTP Routes =======

// Favicon
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1e293b"/><polygon points="18,4 10,18 16,18 14,28 22,14 16,14" fill="#3b82f6"/></svg>`;
app.get('/favicon.svg', (req, res) => res.type('image/svg+xml').send(FAVICON_SVG));

// Dashboard (ต้อง login)
app.get('/', authRequired, (req, res) => res.sendFile(dashboardPage()));

// Health check (public)
app.get('/healthz', (req, res) => {
    res.json({
        relay:   'ok',
        devices: Array.from(devices.keys()).map(id => ({ id, online: true })),
    });
});

// Devices API
app.get('/api/devices', authRequired, wrap(async (req, res) => {
    const rows = await db.getDevicesByUser(req.user.userId);
    const result = rows.map(d => ({
        ...d,
        online: devices.has(d.device_id) && devices.get(d.device_id).readyState === WebSocket.OPEN,
    }));
    res.json(result);
}));

app.post('/api/devices/pair', authRequired, wrap(async (req, res) => {
    const { pairingCode } = req.body || {};
    if (!pairingCode) return res.status(400).json({ error: 'กรุณาใส่ Pairing Code' });

    const device = await db.getDeviceByPairingCode(pairingCode);
    if (!device) return res.status(404).json({ error: 'Pairing Code ไม่ถูกต้องหรือ ESP32 ยังไม่ได้เชื่อมต่อ' });

    if (await db.getDeviceAccess(req.user.userId, device.device_id))
        return res.status(409).json({ error: 'อุปกรณ์นี้ผูกกับบัญชีของคุณอยู่แล้ว' });

    await db.pairDevice(req.user.userId, device.device_id, 'owner');
    res.json({ ok: true, device: { device_id: device.device_id, name: device.name } });
}));

app.delete('/api/devices/:deviceId', authRequired, wrap(async (req, res) => {
    await db.unpairDevice(req.user.userId, req.params.deviceId);
    res.json({ ok: true });
}));

// Device proxy (ต้อง login + มีสิทธิ์เข้าถึง device)
app.use('/d/:deviceId', authRequired, wrap(async (req, res) => {
    const { deviceId } = req.params;

    // ตรวจสิทธิ์
    const access = await db.getDeviceAccess(req.user.userId, deviceId);
    if (!access) {
        const isNavigation = req.headers['sec-fetch-mode'] === 'navigate';
        return isNavigation
            ? res.status(403).send(`<h1 style="font-family:sans-serif;color:#ef4444;padding:40px">403 — ไม่มีสิทธิ์เข้าถึงอุปกรณ์นี้</h1>`)
            : res.status(403).json({ error: 'Access denied' });
    }

    const subPath    = req.path;
    const isOwner    = access.role === 'owner';
    const canControl = access.role !== 'viewer';

    // ======= Serve ESP32 dashboard HTML directly from relay =======
    if ((subPath === '/' || subPath === '' || subPath === '/index.html') && req.method === 'GET') {
        console.log('[Device]', deviceId, 'serving dashboard HTML, role:', access.role);
        return sendEsp32Dashboard(res);
    }

    // ======= Relay-managed routes =======

    if (subPath === '/api/gpio/labels') {
        if (req.method === 'GET')
            return res.json(await db.getGpioLabels(deviceId));
        if (req.method === 'PUT') {
            if (!canControl) return res.status(403).json({ error: 'Viewer ไม่มีสิทธิ์แก้ไข label' });
            const { pin, label } = req.body || {};
            if (!pin) return res.status(400).json({ error: 'pin required' });
            await db.setGpioLabel(deviceId, pin, label ?? '');
            return res.json({ ok: true });
        }
    }

    if (subPath === '/api/device/info') {
        if (req.method === 'GET') {
            const d = await db.getDeviceById(deviceId);
            return res.json({ ...d?.toObject?.() ?? d, role: access.role });
        }
        if (req.method === 'PUT' && isOwner) {
            const { name } = req.body || {};
            if (name?.trim()) await db.updateDeviceName(deviceId, name.trim());
            return res.json({ ok: true });
        }
    }

    if (subPath === '/api/device/users') {
        if (!isOwner) return res.status(403).json({ error: 'Owner only' });
        if (req.method === 'GET')
            return res.json(await db.getDeviceUsers(deviceId));
        if (req.method === 'POST') {
            const { email, role } = req.body || {};
            if (!email) return res.status(400).json({ error: 'email required' });
            const result = await db.inviteUserByEmail(deviceId, email, role || 'editor');
            return result.ok ? res.json({ ok: true }) : res.status(400).json({ error: result.error });
        }
    }

    const removeMatch = subPath.match(/^\/api\/device\/users\/([a-f0-9]{24})$/i);
    if (removeMatch && req.method === 'DELETE') {
        if (!isOwner) return res.status(403).json({ error: 'Owner only' });
        const targetId = removeMatch[1];
        if (String(targetId) === String(req.user.userId))
            return res.status(400).json({ error: 'ไม่สามารถลบตัวเองได้' });
        await db.unpairDevice(targetId, deviceId);
        return res.json({ ok: true });
    }

    // ======= Forward ไป ESP32 =======
    if (req.method !== 'GET' && !canControl)
        return res.status(403).json({ error: 'Viewer ไม่มีสิทธิ์สั่งการ' });

    const ws = devices.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return res.status(503).send(offlinePage(deviceId));

    const id    = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); res.status(504).send('Gateway Timeout'); }
    }, TIMEOUT_MS);

    pending.set(id, { res, timer, deviceId });
    ws.send(JSON.stringify({
        type:   'request',
        id,
        method: req.method,
        path:   req.path || '/',
        query:  req.query,
        body:   req.body ? JSON.stringify(req.body) : '',
    }));
}));

// Express error handler สำหรับ async errors
app.use((err, req, res, _next) => {
    console.error('[Error]', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ======= Start — รอ MongoDB ก่อน listen =======
const PORT = process.env.PORT || 3000;
db.connect()
    .then(() => {
        httpServer.listen(PORT, () => {
            console.log(`Relay on port ${PORT}`);
            console.log(`Dashboard: http://localhost:${PORT}/`);
        });
    })
    .catch(err => {
        console.error('❌ Cannot connect to MongoDB:', err.message);
        process.exit(1);
    });
