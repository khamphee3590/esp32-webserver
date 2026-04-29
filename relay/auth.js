require('dotenv').config();
const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const path       = require('path');
const db = require('./db');

const router     = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const BASE_URL   = process.env.BASE_URL   || 'http://localhost:3000';
const COOKIE_OPT = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };
const wrap       = fn => (req, res, next) => fn(req, res, next).catch(next);

// ======= Email =======
function createTransport() {
    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
}

async function sendResetEmail(email, token) {
    if (!process.env.EMAIL_HOST) {
        console.log(`[Email] Reset link: ${BASE_URL}/reset-password?token=${token}`);
        return;
    }
    const url = `${BASE_URL}/reset-password?token=${token}`;
    await createTransport().sendMail({
        from: `"ESP32 Relay" <${process.env.EMAIL_USER}>`,
        to:   email,
        subject: 'รีเซ็ตรหัสผ่าน ESP32 Relay',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
<h2 style="color:#3b82f6">รีเซ็ตรหัสผ่าน</h2>
<p style="margin-top:12px;color:#94a3b8">คลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง</p>
<a href="${url}" style="display:inline-block;margin-top:24px;padding:12px 28px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">ตั้งรหัสผ่านใหม่</a>
<p style="margin-top:24px;font-size:.8rem;color:#475569">ถ้าคุณไม่ได้ขอรีเซ็ต สามารถเพิกเฉยอีเมลนี้ได้เลย</p>
</div>`,
    });
}

// ======= HTML Pages =======
const LIGHT_STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#f7f7f7;color:#111;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.wrap{width:100%;max-width:380px}
.brand{text-align:center;margin-bottom:32px}
.brand-mark{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1.5px solid #e4e4e4;border-radius:9px;font-size:1.1rem;margin-bottom:12px;background:#fff}
.brand-name{font-size:.875rem;font-weight:600}
.brand-sub{font-size:.75rem;color:#888;margin-top:2px}
.card{background:#fff;border:1px solid #e4e4e4;border-radius:12px;padding:28px 24px}
h2{font-size:.95rem;font-weight:600;margin-bottom:4px}
.sub{font-size:.78rem;color:#888;margin-bottom:20px}
label{display:block;font-size:.72rem;font-weight:500;margin:13px 0 4px}
input{width:100%;background:#f7f7f7;border:1px solid #e4e4e4;color:#111;padding:10px 12px;border-radius:7px;font-size:.875rem;outline:none}
input:focus{border-color:#111;background:#fff}
.btn{width:100%;background:#111;color:#fff;border:none;padding:11px;border-radius:7px;font-size:.875rem;cursor:pointer;margin-top:16px;font-weight:600}
.btn:hover{opacity:.85}
.msg{padding:10px 12px;border-radius:7px;font-size:.78rem;margin-top:10px;display:none}
.err{background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;display:block}
.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d;display:block}
.inf{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;display:block}
.links{display:flex;justify-content:space-between;margin-top:14px;font-size:.75rem}
.links a{color:#888;text-decoration:none}.links a:hover{color:#111}
footer{text-align:center;font-size:.7rem;color:#ccc;margin-top:20px}`;

function lightPage(title, body) {
    return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ESP32 Relay</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>${LIGHT_STYLE}</style></head><body>${body}<footer>ESP32 Relay — 2026</footer></body></html>`;
}

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

router.get('/register', (req, res) => {
    res.redirect('/login');
});

router.get('/forgot-password', (req, res) => res.send(lightPage('ลืมรหัสผ่าน', `
<div class="wrap">
<div class="brand"><div class="brand-mark">⚡</div><div class="brand-name">ESP32 Relay</div></div>
<div class="card">
  <h2>ลืมรหัสผ่าน</h2><div class="sub">ใส่อีเมลเพื่อรับลิงก์รีเซ็ตรหัสผ่าน</div>
  <label>อีเมล</label><input id="email" type="email" placeholder="your@email.com" />
  <div id="msg" class="msg"></div>
  <button class="btn" onclick="send()">ส่งลิงก์รีเซ็ต</button>
  <div class="links"><a href="/login">← กลับ</a></div>
</div></div>
<script>
function showMsg(t,c){var e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;}
function send(){
  var email=document.getElementById('email').value.trim();
  if(!email){showMsg('กรุณาใส่อีเมล','err');return;}
  showMsg('กำลังส่ง...','inf');
  fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email})})
  .then(function(r){return r.json();}).then(function(){
    showMsg('ส่งอีเมลแล้ว! ตรวจสอบ inbox ของคุณ (รวมถึง spam)','ok');
  }).catch(function(){showMsg('เชื่อมต่อไม่ได้','err');});
}
</script>`)));

router.get('/reset-password', (req, res) => {
    const { token } = req.query;
    if (!token) return res.redirect('/forgot-password');
    res.send(lightPage('ตั้งรหัสผ่านใหม่', `
<div class="wrap">
<div class="brand"><div class="brand-mark">⚡</div><div class="brand-name">ESP32 Relay</div></div>
<div class="card">
  <h2>ตั้งรหัสผ่านใหม่</h2><div class="sub">ใส่รหัสผ่านใหม่ของคุณ</div>
  <label>รหัสผ่านใหม่</label><input id="pass" type="password" placeholder="อย่างน้อย 8 ตัวอักษร" />
  <label>ยืนยันรหัสผ่าน</label><input id="pass2" type="password" placeholder="กรอกอีกครั้ง" />
  <div id="msg" class="msg"></div>
  <button class="btn" onclick="reset()">ตั้งรหัสผ่านใหม่</button>
</div></div>
<script>
function showMsg(t,c){var e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;}
function reset(){
  var pass=document.getElementById('pass').value;
  var pass2=document.getElementById('pass2').value;
  if(pass.length<8){showMsg('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร','err');return;}
  if(pass!==pass2){showMsg('รหัสผ่านไม่ตรงกัน','err');return;}
  showMsg('กำลังบันทึก...','inf');
  fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:${JSON.stringify(token)},password:pass})})
  .then(function(r){return r.json();}).then(function(d){
    if(d.ok){showMsg('เปลี่ยนรหัสผ่านสำเร็จ! กำลังพาไปหน้า Login...','ok');
      setTimeout(function(){location.href='/login';},1500);}
    else showMsg(d.error||'ลิงก์หมดอายุหรือไม่ถูกต้อง','err');
  }).catch(function(){showMsg('เชื่อมต่อไม่ได้','err');});
}
</script>`));
});

// ======= Auth API =======
router.post('/api/auth/register', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    if (password.length < 8)  return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });

    // ต้องใส่ await ตรงนี้
    if (await db.getUserByEmail(email)) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });

    // ต้องใส่ await ตรงนี้
    await db.createUser(email, bcrypt.hashSync(password, 10));
    res.json({ ok: true });
}));

router.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await db.getUserByEmail(email); // ตัวนี้คุณใส่ไว้ถูกแล้ว
    if (!user || !bcrypt.compareSync(password, user.password_hash))
        return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    // MongoDB ใช้ _id (หรือ .id ถ้าเราตั้งไว้) 
    const token = jwt.sign({ userId: user._id || user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, COOKIE_OPT);
    res.json({ ok: true });
}));

router.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ ok: true });
});

router.get('/api/auth/me', (req, res) => {
    try {
        const user = jwt.verify(req.cookies?.token, JWT_SECRET);
        res.json({ userId: user.userId, email: user.email });
    } catch {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

router.post('/api/auth/forgot-password', wrap(async (req, res) => {
    const { email } = req.body || {};
    const user = await db.getUserByEmail(email);
    if (user) {
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 60 * 60 * 1000;
        // ต้องใส่ await ตรงนี้
        await db.setResetToken(user._id || user.id, token, expires);
        try { await sendResetEmail(email, token); } catch (e) { console.error('[Email]', e.message); }
    }
    res.json({ ok: true });
}));

router.post('/api/auth/reset-password', wrap(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password || password.length < 8)
        return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });

    const user = await db.getUserByResetToken(token);
    if (!user) return res.status(400).json({ error: 'ลิงก์หมดอายุหรือไม่ถูกต้อง' });

    // ต้องใส่ await ตรงนี้
    await db.updatePassword(user._id || user.id, bcrypt.hashSync(password, 10));
    res.json({ ok: true });
}));

module.exports = { router, JWT_SECRET };
