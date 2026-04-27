require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const { WebSocketServer, WebSocket } = require('ws');
const http         = require('http');
const db           = require('./db');
const { router: authRouter, JWT_SECRET } = require('./auth');

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

function dashboardPage(user) {
    return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — ESP32 Relay</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
header{background:#1e293b;padding:16px 28px;border-bottom:2px solid #3b82f6;
display:flex;align-items:center;justify-content:space-between}
h1{color:#3b82f6;font-size:1.3rem}
.user{font-size:.8rem;color:#64748b}
.logout{background:none;border:1px solid #334155;color:#94a3b8;padding:6px 14px;
border-radius:7px;cursor:pointer;font-size:.8rem}
.logout:hover{border-color:#ef4444;color:#ef4444}
main{padding:28px;max-width:680px;margin:0 auto}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
h2{font-size:.9rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.btn-pair{background:#3b82f6;color:#fff;border:none;padding:9px 20px;border-radius:8px;
font-size:.85rem;cursor:pointer}
.btn-pair:hover{background:#2563eb}
.device-card{display:flex;align-items:center;gap:16px;background:#1e293b;
border:1px solid #334155;border-radius:12px;padding:16px 20px;text-decoration:none;
color:inherit;margin-bottom:12px;transition:border-color .15s}
.device-card:hover{border-color:#3b82f6}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.dot-on{background:#22c55e}.dot-off{background:#475569}
.dev-info{flex:1}
.dev-name{font-weight:600;font-size:1rem;color:#f1f5f9}
.dev-id{font-family:monospace;font-size:.72rem;color:#475569;margin-top:2px}
.dev-status{font-size:.75rem;margin-top:2px}
.on{color:#22c55e}.off{color:#475569}
.arrow{color:#334155;font-size:1.2rem}
.empty{color:#475569;text-align:center;padding:48px;background:#1e293b;border-radius:12px}

/* Modal */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10;
align-items:center;justify-content:center}
.overlay.show{display:flex}
.modal{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:28px;
width:100%;max-width:380px}
.modal h3{color:#3b82f6;font-size:1.1rem;margin-bottom:6px}
.modal p{color:#64748b;font-size:.82rem;margin-bottom:20px}
label{display:block;font-size:.72rem;color:#64748b;text-transform:uppercase;margin-bottom:4px}
input{width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;
padding:10px 12px;border-radius:8px;font-size:.9rem;outline:none;letter-spacing:.15em}
input:focus{border-color:#3b82f6}
.modal-btns{display:flex;gap:10px;margin-top:16px}
.btn-ok{flex:1;background:#3b82f6;color:#fff;border:none;padding:10px;border-radius:8px;cursor:pointer;font-weight:600}
.btn-ok:hover{background:#2563eb}
.btn-cancel{flex:0;background:#334155;color:#94a3b8;border:none;padding:10px 16px;border-radius:8px;cursor:pointer}
.msg{padding:8px 12px;border-radius:7px;font-size:.82rem;margin-top:10px;display:none}
.err{background:#450a0a;color:#f87171;display:block}
.ok{background:#052e16;color:#4ade80;display:block}
footer{text-align:center;padding:20px;color:#334155;font-size:.75rem}
</style></head>
<body>
<header>
  <h1>ESP32 Relay</h1>
  <div style="display:flex;align-items:center;gap:12px">
    <span class="user">${user.email}</span>
    <button class="logout" onclick="logout()">ออกจากระบบ</button>
  </div>
</header>
<main>
  <div class="toolbar">
    <h2>อุปกรณ์ของฉัน (<span id="count">0</span>)</h2>
    <button class="btn-pair" onclick="openModal()">+ เพิ่มอุปกรณ์</button>
  </div>
  <div id="device-list"><div class="empty">กำลังโหลด...</div></div>
</main>

<div class="overlay" id="modal">
  <div class="modal">
    <h3>เพิ่มอุปกรณ์ใหม่</h3>
    <p>ดู Pairing Code ได้จากหน้า Setup ของ ESP32 (192.168.4.1)</p>
    <label>Pairing Code</label>
    <input type="text" id="pcode" maxlength="6" placeholder="6 หลัก" />
    <div id="pair-msg" class="msg"></div>
    <div class="modal-btns">
      <button class="btn-cancel" onclick="closeModal()">ยกเลิก</button>
      <button class="btn-ok" onclick="pair()">ผูกอุปกรณ์</button>
    </div>
  </div>
</div>

<footer>ESP32 Relay — Phase 3</footer>
<script>
function showPairMsg(t,c){var e=document.getElementById('pair-msg');e.textContent=t;e.className='msg '+c;}
function openModal(){document.getElementById('modal').classList.add('show');document.getElementById('pcode').focus();}
function closeModal(){document.getElementById('modal').classList.remove('show');showPairMsg('','');}
document.getElementById('modal').addEventListener('click',function(e){if(e.target===this)closeModal();});

function logout(){
  fetch('/api/auth/logout',{method:'POST'}).then(function(){location.href='/login';});
}

function renderDevices(list){
  var el=document.getElementById('device-list');
  document.getElementById('count').textContent=list.length;
  if(!list.length){el.innerHTML='<div class="empty">ยังไม่มีอุปกรณ์ เพิ่มอุปกรณ์แรกของคุณ →</div>';return;}
  el.innerHTML=list.map(function(d){
    var on=d.online;
    return '<a class="device-card" href="/d/'+d.device_id+'/">'
      +'<span class="status-dot '+(on?'dot-on':'dot-off')+'"></span>'
      +'<div class="dev-info"><div class="dev-name">'+d.name+'</div>'
      +'<div class="dev-id">'+d.device_id+'</div>'
      +'<div class="dev-status '+(on?'on':'off')+'">'+(on?'Online':'Offline')+'</div></div>'
      +'<span class="arrow">→</span></a>';
  }).join('');
}

function loadDevices(){
  fetch('/api/devices').then(function(r){
    if(r.status===401){location.href='/login';return null;}
    return r.json();
  }).then(function(d){if(d)renderDevices(d);});
}

function pair(){
  var code=document.getElementById('pcode').value.trim();
  if(code.length!==6){showPairMsg('Pairing Code ต้องมี 6 หลัก','err');return;}
  showPairMsg('กำลังผูก...','inf');
  fetch('/api/devices/pair',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pairingCode:code})})
  .then(function(r){return r.json();}).then(function(d){
    if(d.ok){showPairMsg('ผูกอุปกรณ์สำเร็จ!','ok');loadDevices();setTimeout(closeModal,1500);}
    else showPairMsg(d.error||'เกิดข้อผิดพลาด','err');
  }).catch(function(){showPairMsg('เชื่อมต่อไม่ได้','err');});
}

document.getElementById('pcode').addEventListener('keydown',function(e){if(e.key==='Enter')pair();});
loadDevices();
setInterval(loadDevices, 10000);

// pair-msg ใช้ inf style ด้วย
var s=document.createElement('style');
s.textContent='.inf{background:#172554;color:#93c5fd;display:block}';
document.head.appendChild(s);
</script>
</body></html>`;
}

// ======= WebSocket: รับการเชื่อมต่อจาก ESP32 =======
wss.on('connection', (ws, req) => {
    let deviceId = null;

    ws.on('message', (raw) => {
        const text     = raw.toString();
        const nl       = text.indexOf('\n');
        const jsonPart = nl >= 0 ? text.slice(0, nl) : text;
        const body     = nl >= 0 ? text.slice(nl + 1) : '';

        let msg;
        try { msg = JSON.parse(jsonPart); } catch { return; }

        if (msg.type === 'hello') {
            deviceId = msg.deviceId;
            if (devices.has(deviceId)) devices.get(deviceId).terminate();
            devices.set(deviceId, ws);
            db.upsertDevice(deviceId, msg.name, msg.pairingCode);
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

    ws.on('close', () => {
        if (deviceId && devices.get(deviceId) === ws) {
            devices.delete(deviceId);
            db.touchDevice(deviceId);
            console.log(`[Device] ${deviceId} disconnected (total: ${devices.size})`);
        }
    });

    ws.on('error', (err) => console.error('[WS]', err.message));
});

// ======= HTTP Routes =======

// Dashboard (ต้อง login)
app.get('/', authRequired, (req, res) => res.send(dashboardPage(req.user)));

// Health check (public)
app.get('/healthz', (req, res) => {
    res.json({
        relay:   'ok',
        devices: Array.from(devices.keys()).map(id => ({ id, online: true })),
    });
});

// Devices API
app.get('/api/devices', authRequired, (req, res) => {
    const rows = db.getDevicesByUser(req.user.userId);
    const result = rows.map(d => ({
        ...d,
        online: devices.has(d.device_id) && devices.get(d.device_id).readyState === WebSocket.OPEN,
    }));
    res.json(result);
});

app.post('/api/devices/pair', authRequired, (req, res) => {
    const { pairingCode } = req.body || {};
    if (!pairingCode) return res.status(400).json({ error: 'กรุณาใส่ Pairing Code' });

    const device = db.getDeviceByPairingCode(pairingCode);
    if (!device) return res.status(404).json({ error: 'Pairing Code ไม่ถูกต้องหรือ ESP32 ยังไม่ได้เชื่อมต่อ' });

    if (db.getDeviceAccess(req.user.userId, device.device_id))
        return res.status(409).json({ error: 'อุปกรณ์นี้ผูกกับบัญชีของคุณอยู่แล้ว' });

    db.pairDevice(req.user.userId, device.device_id, 'owner');
    res.json({ ok: true, device: { device_id: device.device_id, name: device.name } });
});

app.delete('/api/devices/:deviceId', authRequired, (req, res) => {
    db.unpairDevice(req.user.userId, req.params.deviceId);
    res.json({ ok: true });
});

// Device proxy (ต้อง login + มีสิทธิ์เข้าถึง device)
app.use('/d/:deviceId', authRequired, (req, res, next) => {
    const access = db.getDeviceAccess(req.user.userId, req.params.deviceId);
    if (!access) {
        const isNavigation = req.headers['sec-fetch-mode'] === 'navigate';
        return isNavigation
            ? res.status(403).send(`<h1 style="font-family:sans-serif;color:#ef4444;padding:40px">403 — ไม่มีสิทธิ์เข้าถึงอุปกรณ์นี้</h1>`)
            : res.status(403).json({ error: 'Access denied' });
    }
    req.deviceRole = access.role;
    next();
}, (req, res) => {
    const { deviceId } = req.params;
    const subPath = req.path;
    const isOwner = req.deviceRole === 'owner';

    // ======= Relay-managed routes (ไม่ forward ไป ESP32) =======

    // GPIO Labels
    if (subPath === '/api/gpio/labels') {
        if (req.method === 'GET')
            return res.json(db.getGpioLabels(deviceId));
        if (req.method === 'PUT') {
            const { pin, label } = req.body || {};
            if (!pin) return res.status(400).json({ error: 'pin required' });
            db.setGpioLabel(deviceId, pin, label ?? '');
            return res.json({ ok: true });
        }
    }

    // Device Info
    if (subPath === '/api/device/info') {
        if (req.method === 'GET') {
            const d = db.getDeviceById(deviceId);
            return res.json({ ...d, role: req.deviceRole });
        }
        if (req.method === 'PUT' && isOwner) {
            const { name } = req.body || {};
            if (name?.trim()) db.updateDeviceName(deviceId, name.trim());
            return res.json({ ok: true });
        }
    }

    // User Management (owner only)
    if (subPath === '/api/device/users') {
        if (!isOwner) return res.status(403).json({ error: 'Owner only' });
        if (req.method === 'GET')
            return res.json(db.getDeviceUsers(deviceId));
        if (req.method === 'POST') {
            const { email, role } = req.body || {};
            if (!email) return res.status(400).json({ error: 'email required' });
            const result = db.inviteUserByEmail(deviceId, email, role || 'editor');
            return result.ok ? res.json({ ok: true }) : res.status(400).json({ error: result.error });
        }
    }

    // Remove user (owner only, ไม่ให้ลบตัวเอง)
    const removeMatch = subPath.match(/^\/api\/device\/users\/(\d+)$/);
    if (removeMatch && req.method === 'DELETE') {
        if (!isOwner) return res.status(403).json({ error: 'Owner only' });
        const targetId = Number(removeMatch[1]);
        if (targetId === req.user.userId) return res.status(400).json({ error: 'ไม่สามารถลบตัวเองได้' });
        db.unpairDevice(targetId, deviceId);
        return res.json({ ok: true });
    }

    // ======= Forward ไป ESP32 =======
    const ws = devices.get(deviceId);

    if (!ws || ws.readyState !== WebSocket.OPEN)
        return res.status(503).send(offlinePage(deviceId));

    const id    = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); res.status(504).send('Gateway Timeout'); }
    }, TIMEOUT_MS);

    pending.set(id, { res, timer });
    ws.send(JSON.stringify({
        type:   'request',
        id,
        method: req.method,
        path:   req.path || '/',
        query:  req.query,
        body:   req.body ? JSON.stringify(req.body) : '',
    }));
});

// ======= Start =======
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Relay on port ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}/`);
});
