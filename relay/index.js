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

function dashboardPage(user) {
    return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — ESP32 Relay</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column}

/* ── Navbar ── */
.navbar{background:#1e293b;border-bottom:1px solid #334155;padding:0 24px;height:56px;
  display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;gap:12px}
.nav-brand{display:flex;align-items:center;gap:6px;text-decoration:none;flex-shrink:0}
.nav-logo{color:#3b82f6;font-size:1.1rem}
.nav-title{color:#f1f5f9;font-weight:700;font-size:.95rem}
.nav-right{display:flex;align-items:center;gap:10px}
.nav-user{font-size:.78rem;color:#64748b;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav-btn{background:none;border:1px solid #334155;color:#94a3b8;padding:6px 14px;
  border-radius:7px;cursor:pointer;font-size:.8rem;white-space:nowrap;transition:all .15s;min-height:36px}
.nav-btn:hover{border-color:#3b82f6;color:#3b82f6}
.nav-btn.danger:hover{border-color:#ef4444;color:#ef4444}

/* ── Main ── */
main{flex:1;padding:28px;max-width:680px;margin:0 auto;width:100%}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.page-title{font-size:.85rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.btn-pair{background:#3b82f6;color:#fff;border:none;padding:9px 20px;border-radius:8px;
  font-size:.85rem;cursor:pointer;transition:background .15s;min-height:40px}
.btn-pair:hover{background:#2563eb}

/* ── Summary Bar ── */
.summary-bar{display:flex;align-items:center;gap:16px;margin-bottom:20px;
  padding:12px 16px;background:#1e293b;border:1px solid #334155;border-radius:10px}
.summary-stat{display:flex;align-items:center;gap:7px;font-size:.82rem;color:#94a3b8}
.summary-count{font-weight:700;font-size:1rem}
.summary-count.c-on{color:#22c55e}
.summary-count.c-off{color:#475569}
.summary-sep{color:#334155;font-size:1rem}
.summary-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.sd-on{background:#22c55e}
.sd-off{background:#475569}

/* ── Device Cards ── */
@keyframes online-pulse{
  0%,100%{box-shadow:0 0 0 0 #22c55e55}
  60%{box-shadow:0 0 0 5px #22c55e00}
}
.device-card{display:flex;align-items:center;gap:14px;background:#1e293b;
  border:1px solid #334155;border-radius:12px;padding:16px 18px;
  cursor:pointer;margin-bottom:10px;transition:border-color .15s,background .15s;
  position:relative}
.device-card:hover{border-color:#3b82f6;background:#1e3a5f22}
.status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.dot-on{background:#22c55e;animation:online-pulse 2.5s infinite}
.dot-off{background:#334155}
.dev-info{flex:1;min-width:0}
.dev-top{display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap}
.dev-name{font-weight:600;font-size:.95rem;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.role-badge{font-size:.62rem;padding:2px 7px;border-radius:99px;font-weight:600;flex-shrink:0}
.role-owner{background:#172554;color:#93c5fd}
.role-editor{background:#1a2e05;color:#86efac}
.role-viewer{background:#1c1917;color:#a8a29e}
.dev-id{font-family:monospace;font-size:.7rem;color:#475569}
.dev-status{font-size:.75rem;margin-top:4px}
.on{color:#22c55e}.off{color:#475569}
.dev-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
.btn-del{background:none;border:1px solid transparent;color:#334155;
  width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:.85rem;
  display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
.btn-del:hover{border-color:#ef4444;color:#ef4444;background:#450a0a22}
.arrow{color:#475569;font-size:1.1rem;transition:color .15s}
.device-card:hover .arrow{color:#3b82f6}

/* ── Empty State ── */
.empty{text-align:center;padding:48px 24px;background:#1e293b;
  border-radius:12px;border:1px dashed #334155}
.empty-icon{font-size:2.5rem;margin-bottom:12px;opacity:.4}
.empty-title{color:#e2e8f0;font-weight:600;margin-bottom:6px}
.empty-desc{color:#475569;font-size:.85rem;line-height:1.7}

/* ── Modal ── */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);
  z-index:100;align-items:center;justify-content:center;padding:16px}
.overlay.show{display:flex}
.modal{background:#1e293b;border:1px solid #334155;border-radius:14px;
  padding:28px;width:100%;max-width:380px}
.modal-title{color:#3b82f6;font-size:1.05rem;font-weight:700;margin-bottom:6px}
.modal-desc{color:#64748b;font-size:.82rem;margin-bottom:20px;line-height:1.65}
.field-label{display:block;font-size:.72rem;color:#64748b;text-transform:uppercase;
  letter-spacing:.04em;margin-bottom:6px}
input{width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;
  padding:11px 14px;border-radius:8px;font-size:1.1rem;outline:none;
  letter-spacing:.15em;text-align:center;min-height:48px}
input:focus{border-color:#3b82f6}
.modal-actions{display:flex;gap:10px;margin-top:20px}
.btn-primary{flex:1;background:#3b82f6;color:#fff;border:none;padding:11px;
  border-radius:8px;cursor:pointer;font-weight:600;font-size:.9rem;min-height:44px}
.btn-primary:hover{background:#2563eb}
.btn-secondary{background:#334155;color:#94a3b8;border:none;padding:11px 16px;
  border-radius:8px;cursor:pointer;font-size:.9rem;min-height:44px}
.msg-box{padding:8px 12px;border-radius:7px;font-size:.82rem;margin-top:12px;display:none}
.msg-err{background:#450a0a;color:#f87171;display:block}
.msg-ok{background:#052e16;color:#4ade80;display:block}
.msg-inf{background:#172554;color:#93c5fd;display:block}

footer{text-align:center;padding:20px;color:#334155;font-size:.75rem;border-top:1px solid #1e293b}

@media(max-width:768px){.nav-user{display:none}}
@media(max-width:480px){
  .navbar{padding:0 12px;height:52px}
  .nav-title{display:none}
  main{padding:12px}
  .summary-bar{padding:10px 14px;gap:12px}
  .device-card{padding:14px}
  .overlay{align-items:flex-end;padding:0;padding-top:20px}
  .modal{border-radius:16px 16px 0 0;max-width:100%;border-bottom:none}
}
</style></head>
<body>

<nav class="navbar">
  <a class="nav-brand" href="/">
    <span class="nav-logo">⚡</span>
    <span class="nav-title">ESP32 Relay</span>
  </a>
  <div class="nav-right">
    <span class="nav-user">${user.email}</span>
    <button class="nav-btn danger" onclick="logout()">ออกจากระบบ</button>
  </div>
</nav>

<main>
  <div class="page-header">
    <span class="page-title">อุปกรณ์ของฉัน</span>
    <button class="btn-pair" onclick="openModal()">+ เพิ่มอุปกรณ์</button>
  </div>

  <div class="summary-bar" id="summary-bar" style="display:none">
    <div class="summary-stat">
      <span class="summary-dot sd-on"></span>
      <span class="summary-count c-on" id="sum-online">0</span>
      <span>Online</span>
    </div>
    <span class="summary-sep">·</span>
    <div class="summary-stat">
      <span class="summary-dot sd-off"></span>
      <span class="summary-count c-off" id="sum-offline">0</span>
      <span>Offline</span>
    </div>
  </div>

  <div id="device-list"><div class="empty"><div class="empty-icon">📡</div><div class="empty-title">กำลังโหลด...</div></div></div>
</main>

<div class="overlay" id="modal">
  <div class="modal">
    <div class="modal-title">เพิ่มอุปกรณ์ใหม่</div>
    <div class="modal-desc">
      ดู Pairing Code ได้จากหน้า Setup ของ ESP32<br>
      เชื่อมต่อ WiFi ชื่อ <strong>ESP32-XXXX</strong> → เปิด 192.168.4.1
    </div>
    <label class="field-label">Pairing Code (6 หลัก)</label>
    <input type="text" id="pcode" inputmode="numeric" maxlength="6" placeholder="000000" />
    <div id="pair-msg" class="msg-box"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="btn-primary" onclick="pair()">ผูกอุปกรณ์</button>
    </div>
  </div>
</div>

<footer>ESP32 Relay</footer>
<script src="/dash.js"></script>
</body></html>`;
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
            deviceId = msg.deviceId;
            if (devices.has(deviceId)) devices.get(deviceId).terminate();
            devices.set(deviceId, ws);
            await db.upsertDevice(deviceId, msg.name, msg.pairingCode);
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

const DASH_JS = `
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function showMsg(t,c){var e=document.getElementById('pair-msg');e.textContent=t;e.className='msg-box '+(c?'msg-'+c:'');}
function openModal(){document.getElementById('modal').classList.add('show');document.getElementById('pcode').focus();}
function closeModal(){document.getElementById('modal').classList.remove('show');showMsg('','');document.getElementById('pcode').value='';}
document.getElementById('modal').addEventListener('click',function(e){if(e.target===this)closeModal();});
function logout(){fetch('/api/auth/logout',{method:'POST'}).then(function(){location.href='/login';});}
function relTime(ts){
  if(!ts)return'ไม่ทราบ';
  var s=Math.floor((Date.now()-ts)/1000);
  if(s<60)return'เมื่อสักครู่';
  if(s<3600)return Math.floor(s/60)+' นาทีที่แล้ว';
  if(s<86400)return Math.floor(s/3600)+' ชั่วโมงที่แล้ว';
  return Math.floor(s/86400)+' วันที่แล้ว';
}
function renderDevices(list){
  var el=document.getElementById('device-list');
  var bar=document.getElementById('summary-bar');
  if(!list.length){
    bar.style.display='none';
    el.innerHTML='<div class="empty"><div class="empty-icon">📡</div><div class="empty-title">ยังไม่มีอุปกรณ์</div><div class="empty-desc">กด <strong>+ เพิ่มอุปกรณ์</strong> แล้วใส่ Pairing Code</div></div>';
    return;
  }
  var online=list.filter(function(d){return d.online;}).length;
  document.getElementById('sum-online').textContent=online;
  document.getElementById('sum-offline').textContent=list.length-online;
  bar.style.display='flex';
  el.innerHTML=list.map(function(d){
    var on=d.online;
    var role=d.role||'viewer';
    var status=on?'● Online':'○ Last seen '+relTime(d.last_seen);
    return '<div class="device-card" onclick="location.href=\\'/d/'+d.device_id+'/\\'">'
      +'<span class="status-dot '+(on?'dot-on':'dot-off')+'"></span>'
      +'<div class="dev-info"><div class="dev-top"><span class="dev-name">'+esc(d.name)+'</span>'
      +'<span class="role-badge role-'+esc(role)+'">'+esc(role)+'</span></div>'
      +'<div class="dev-id">'+esc(d.device_id)+'</div>'
      +'<div class="dev-status '+(on?'on':'off')+'">'+status+'</div></div>'
      +'<div class="dev-actions">'
      +'<button class="btn-del" onclick="event.stopPropagation();delDevice(\\''+d.device_id+'\\')" title="ลบ">✕</button>'
      +'<span class="arrow">›</span></div></div>';
  }).join('');
}
function loadDevices(){
  fetch('/api/devices').then(function(r){
    if(r.status===401){location.href='/login';return null;}
    return r.json();
  }).then(function(d){if(d)renderDevices(d);});
}
function delDevice(id){
  if(!confirm('ลบอุปกรณ์นี้ออกจาก dashboard?'))return;
  fetch('/api/devices/'+id,{method:'DELETE'}).then(function(){loadDevices();});
}
function pair(){
  var code=document.getElementById('pcode').value.trim();
  if(!/^\\d{6}$/.test(code)){showMsg('Pairing Code ต้องเป็นตัวเลข 6 หลัก','err');return;}
  showMsg('กำลังผูกอุปกรณ์...','inf');
  fetch('/api/devices/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pairingCode:code})})
  .then(function(r){return r.json();}).then(function(d){
    if(d.ok){showMsg('ผูกอุปกรณ์สำเร็จ!','ok');loadDevices();setTimeout(closeModal,1500);}
    else showMsg(d.error||'เกิดข้อผิดพลาด','err');
  }).catch(function(){showMsg('เชื่อมต่อไม่ได้','err');});
}
document.getElementById('pcode').addEventListener('keydown',function(e){if(e.key==='Enter')pair();});
loadDevices();
setInterval(loadDevices,10000);
`;

app.get('/dash.js', (req, res) => res.type('application/javascript').send(DASH_JS));

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
// รวมทั้ง access check และ proxy ใน handler เดียวเพื่อให้ wrap() ครอบได้ถูกต้อง
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