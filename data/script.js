// ======= State =======
let gpioState  = {};
let gpioLabels = {};
let deviceRole = 'owner'; // default owner สำหรับ local mode
let countdownVal = 2;

const MODE_LABEL = ['INPUT', 'OUTPUT', 'PULLUP'];
const isLocalMode = !window.location.pathname.startsWith('/d/');

// ======= Role Init =======
async function initRole() {
  if (isLocalMode) { deviceRole = 'owner'; return; }
  try {
    const d = await fetch('api/device/info').then(r => r.json());
    deviceRole = d.role || 'viewer';
    applyRoleUI(d);
  } catch { deviceRole = 'viewer'; }
}

function applyRoleUI(d = {}) {
  const isOwner   = deviceRole === 'owner';
  const canControl = deviceRole !== 'viewer';

  // Navbar: device name
  const navName = document.getElementById('nav-devname');
  if (navName && d.name) navName.textContent = d.name;

  // Navbar: settings button (editor + owner)
  const navSettings = document.getElementById('nav-settings-btn');
  if (navSettings) navSettings.classList.toggle('hidden', !canControl);

  // Navbar: local badge vs user/logout (relay mode)
  document.getElementById('nav-local-badge')?.classList.toggle('hidden', !isLocalMode);
  document.getElementById('nav-user')?.classList.toggle('hidden', isLocalMode);
  document.getElementById('nav-logout-btn')?.classList.toggle('hidden', isLocalMode);

  // Settings modal pre-fill
  const nameInput = document.getElementById('s-devname');
  if (nameInput && d.name) nameInput.value = d.name;
  const pcodeEl = document.getElementById('s-pcode');
  if (pcodeEl) pcodeEl.textContent = d.pairing_code || '------';
  const devidEl = document.getElementById('s-devid');
  if (devidEl) devidEl.textContent = d.device_id || '-';

  // Save name + invite: owner เท่านั้น
  const saveBtn = document.querySelector('.btn-save');
  if (saveBtn) saveBtn.classList.toggle('hidden', !isOwner);
  const invSec = document.getElementById('invite-section');
  if (invSec) invSec.classList.toggle('hidden', !isOwner);
  const usersTab = document.getElementById('tab-users-btn');
  if (usersTab) usersTab.classList.toggle('hidden', !isOwner);
}

async function fetchNavUser() {
  if (isLocalMode) return;
  try {
    const u  = await fetch('/api/auth/me').then(r => r.json());
    const el = document.getElementById('nav-user');
    if (el) el.textContent = u.email;
  } catch { /* silent */ }
}

function logout() {
  fetch('/api/auth/logout', { method: 'POST' }).then(() => { location.href = '/login'; });
}

// ======= Status =======
async function fetchStatus() {
  try {
    const data = await fetch('api/status').then(r => r.json());
    document.getElementById('ip').textContent     = data.ip;
    document.getElementById('rssi').textContent   = data.rssi + ' dBm';
    document.getElementById('uptime').textContent = formatUptime(data.uptime);
    updateOtaLink(data.ip);
    const el = document.getElementById('status');
    el.textContent = data.status === 'ok' ? 'Online' : 'Error';
    el.className   = 'value ' + (data.status === 'ok' ? 'status-ok' : 'status-err');
  } catch {
    document.getElementById('status').textContent = 'Error';
    document.getElementById('status').className   = 'value status-err';
  }
}

function formatUptime(s) {
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s`;
}

// ======= GPIO Labels =======
async function fetchGpioLabels() {
  try {
    const rows = await fetch('api/gpio/labels').then(r => r.json());
    gpioLabels = {};
    rows.forEach(r => { gpioLabels[r.pin_name] = r.label; });
  } catch { /* labels optional */ }
}

async function saveLabel(pin, label) {
  gpioLabels[pin] = label;
  try {
    await fetch('api/gpio/labels', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin, label }),
    });
  } catch { /* silent */ }
}

function editLabel(pin) {
  const span = document.getElementById('lbl-' + pin);
  if (!span) return;
  const current = gpioLabels[pin] || '';
  const input   = document.createElement('input');
  input.type      = 'text';
  input.value     = current;
  input.className = 'label-input';
  input.maxLength = 32;
  span.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    saveLabel(pin, val);
    input.replaceWith(makeLabelSpan(pin, val));
  };
  const cancel = () => { input.replaceWith(makeLabelSpan(pin, current)); };

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

function makeLabelSpan(pin, label) {
  const canEdit = deviceRole !== 'viewer';
  const span    = document.createElement('span');
  span.id        = 'lbl-' + pin;
  span.className = label ? 'pin-label has-label' : 'pin-label';
  span.textContent = label || (canEdit ? '+ ตั้งชื่อ' : '');
  if (canEdit) {
    span.title   = 'คลิกเพื่อแก้ไขชื่อ';
    span.onclick = () => editLabel(pin);
  }
  return span;
}

// ======= GPIO =======
async function fetchGpio() {
  try {
    const data = await fetch('api/gpio').then(r => r.json());
    const isFirst = Object.keys(gpioState).length === 0;
    data.pins.forEach(p => { gpioState[p.name] = p; });
    if (isFirst) renderGpioGrid(data.pins);
    else         updateGpioValues(data.pins);
  } catch { /* silent */ }
}

async function setGpio(pin, mode, value) {
  await fetch('api/gpio/set', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ pin, mode, value }),
  });
  gpioState[pin].mode  = mode;
  gpioState[pin].value = value;
  renderPinCard(document.querySelector(`[data-pin="${pin}"]`), gpioState[pin]);
}

function renderGpioGrid(pins) {
  const grid = document.getElementById('gpio-grid');
  grid.innerHTML = '';
  pins.forEach(p => {
    const card = document.createElement('div');
    card.className   = 'pin-card';
    card.dataset.pin = p.name;
    renderPinCard(card, p);
    grid.appendChild(card);
  });
}

function updateGpioValues(pins) {
  pins.forEach(p => {
    const card = document.querySelector(`[data-pin="${p.name}"]`);
    if (!card) return;
    if (gpioState[p.name].value !== p.value) {
      gpioState[p.name] = p;
      renderPinCard(card, p);
    }
  });
}

function renderPinCard(card, p) {
  const label      = gpioLabels[p.name] || '';
  const canControl = deviceRole !== 'viewer';

  card.innerHTML = `
    <div class="pin-header">
      <div class="pin-names">
        <span class="pin-name">${p.name}</span>
      </div>
      <span class="pin-gpio">GPIO${p.gpio}</span>
    </div>
    <div class="pin-modes">
      ${[0,1,2].map(m => `
        <button type="button"
          class="mode-btn ${p.mode===m ? 'active-mode-'+m : ''}"
          ${canControl ? `onclick="setGpio('${p.name}',${m},${p.mode===1?p.value:0})"` : 'disabled'}
          title="${canControl ? MODE_LABEL[m] : 'Viewer ไม่มีสิทธิ์เปลี่ยน mode'}">
          ${MODE_LABEL[m]}
        </button>`).join('')}
    </div>
    <div class="pin-value">
      ${p.mode === 1 ? renderOutput(p, canControl) : renderInput(p)}
    </div>`;

  card.querySelector('.pin-names').appendChild(makeLabelSpan(p.name, label));
}

function renderOutput(p, canControl = true) {
  if (canControl) {
    return `<div class="output-row">
      <button type="button" class="toggle-btn ${p.value ? 'high' : 'low'}"
              onclick="setGpio('${p.name}',1,${p.value?0:1})">
        ${p.value ? 'HIGH' : 'LOW'}
      </button></div>`;
  }
  // Viewer: แสดงเป็น indicator อ่านอย่างเดียว
  return `<div class="digital-dot ${p.value ? 'dot-high' : 'dot-low'}">${p.value ? 'HIGH' : 'LOW'}</div>`;
}

function renderInput(p) {
  if (p.analog && p.mode !== 1) {
    const pct = Math.round(p.value / 4095 * 100);
    return `<div class="analog-row">
      <span class="analog-val">${p.value}</span>
      <div class="analog-bar"><div class="analog-fill" style="width:${pct}%"></div></div>
    </div>`;
  }
  return `<div class="digital-dot ${p.value ? 'dot-high' : 'dot-low'}">${p.value ? 'HIGH' : 'LOW'}</div>`;
}

// ======= Countdown Badge =======
function startCountdown() {
  countdownVal = 2;
  const badge = document.getElementById('gpio-countdown');
  const tick = setInterval(() => {
    countdownVal--;
    badge.textContent = countdownVal > 0 ? `รีเฟรชใน ${countdownVal}s` : 'กำลังโหลด...';
    if (countdownVal <= 0) clearInterval(tick);
  }, 1000);
}

// ======= Settings Modal =======
function openSettings() {
  document.getElementById('settings-overlay').classList.add('show');
  loadDeviceInfo();
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('show');
}

function switchTab(tab) {
  document.getElementById('tab-device').classList.toggle('hidden', tab !== 'device');
  document.getElementById('tab-users').classList.toggle('hidden',  tab !== 'users');
  document.getElementById('tab-device-btn').classList.toggle('active', tab === 'device');
  document.getElementById('tab-users-btn').classList.toggle('active',  tab === 'users');
  if (tab === 'users') loadDeviceUsers();
}

function showSettingsMsg(text, type) {
  const el = document.getElementById('settings-msg');
  el.textContent = text;
  el.className   = 'settings-msg ' + (type || '');
  if (text) setTimeout(() => { el.textContent = ''; el.className = 'settings-msg'; }, 3000);
}

async function loadDeviceInfo() {
  try {
    const d = await fetch('api/device/info').then(r => r.json());
    deviceRole = d.role || 'viewer';
    applyRoleUI(d);
  } catch { /* local mode */ }
}

async function saveName() {
  const name = document.getElementById('s-devname').value.trim();
  if (!name) return;
  try {
    await fetch('api/device/info', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    });
    const navName = document.getElementById('nav-devname');
    if (navName) navName.textContent = name;
    showSettingsMsg('บันทึกแล้ว', 'msg-ok');
  } catch { showSettingsMsg('บันทึกไม่ได้', 'msg-err'); }
}

async function loadDeviceUsers() {
  const el = document.getElementById('user-list');
  try {
    const users = await fetch('api/device/users').then(r => r.json());
    if (!users.length) { el.innerHTML = '<div class="loading-text">ยังไม่มีผู้ใช้</div>'; return; }
    el.innerHTML = users.map(u => `
      <div class="user-row">
        <div class="user-info">
          <span class="user-email">${u.email}</span>
          <span class="role-badge role-${u.role}">${u.role}</span>
        </div>
        ${deviceRole === 'owner' ? `<button type="button" class="btn-remove" onclick="removeUser(${u.userId})">ลบ</button>` : ''}
      </div>`).join('');
  } catch {
    el.innerHTML = '<div class="loading-text">ไม่สามารถโหลดได้ (local mode)</div>';
  }
}

async function inviteUser() {
  const email = document.getElementById('s-email').value.trim();
  const role  = document.getElementById('s-role').value;
  const msg   = document.getElementById('invite-msg');
  if (!email) { msg.textContent = 'กรุณาใส่อีเมล'; msg.className = 'settings-msg msg-err'; return; }
  try {
    const d = await fetch('api/device/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, role }),
    }).then(r => r.json());
    if (d.ok) {
      msg.textContent = 'เชิญสำเร็จ!';
      msg.className   = 'settings-msg msg-ok';
      document.getElementById('s-email').value = '';
      loadDeviceUsers();
    } else {
      msg.textContent = d.error || 'เกิดข้อผิดพลาด';
      msg.className   = 'settings-msg msg-err';
    }
  } catch { msg.textContent = 'เชื่อมต่อไม่ได้'; msg.className = 'settings-msg msg-err'; }
}

async function removeUser(userId) {
  if (!confirm('ต้องการลบผู้ใช้นี้?')) return;
  try {
    await fetch(`api/device/users/${userId}`, { method: 'DELETE' });
    loadDeviceUsers();
  } catch { showSettingsMsg('ลบไม่ได้', 'msg-err'); }
}

// ======= OTA =======
function initOTA() {
  document.getElementById('ota-local').classList.toggle('hidden', !isLocalMode);
  document.getElementById('ota-relay').classList.toggle('hidden',  isLocalMode);
}

function otaFileChange(type) {
  const input = document.getElementById(`ota-${type}-input`);
  const fname = document.getElementById(`ota-${type}-fname`);
  const btn   = document.getElementById(`ota-${type}-btn`);
  if (input.files[0]) {
    fname.textContent = input.files[0].name;
    btn.disabled = false;
  }
}

function uploadOTA(type) {
  const file = document.getElementById(`ota-${type}-input`).files[0];
  if (!file) return;

  const fill   = document.getElementById(`ota-${type}-fill`);
  const btn    = document.getElementById(`ota-${type}-btn`);

  btn.disabled = true;
  fill.style.width = '0%';
  fill.className   = 'ota-progress-fill';
  setOtaStatus(type, 'กำลังอัพโหลด...', 'inf');

  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      const pct = Math.round(e.loaded / e.total * 100);
      fill.style.width = pct + '%';
      setOtaStatus(type, `กำลังส่ง... ${pct}%`, 'inf');
    }
  });

  xhr.addEventListener('load', () => {
    if (xhr.responseText === 'OK') {
      fill.style.width = '100%';
      fill.classList.add('fill-ok');
      setOtaStatus(type, 'อัพโหลดสำเร็จ! ESP32 กำลัง restart — หน้านี้จะโหลดใหม่ใน 12 วินาที', 'ok');
      setTimeout(() => location.reload(), 12000);
    } else {
      fill.classList.add('fill-err');
      setOtaStatus(type, 'ล้มเหลว: ' + xhr.responseText, 'err');
      btn.disabled = false;
    }
  });

  xhr.addEventListener('error', () => {
    setOtaStatus(type, 'เชื่อมต่อไม่ได้', 'err');
    btn.disabled = false;
  });

  xhr.open('POST', `ota?type=${type}`);
  xhr.send(formData);
}

function setOtaStatus(type, text, cls) {
  const el = document.getElementById(`ota-${type}-status`);
  el.textContent = text;
  el.className   = 'ota-status ota-' + cls;
}

function updateOtaLink(ip) {
  if (isLocalMode) return;
  const url  = `http://${ip}/`;
  const link = document.getElementById('ota-local-link');
  if (link) { link.textContent = url; link.href = url; }
}

// ======= Init =======
initOTA();
fetchStatus();
fetchNavUser();
// โหลด role ก่อนเสมอ เพื่อให้ GPIO grid แสดงสิทธิ์ถูกต้องตั้งแต่ต้น
initRole().then(() => fetchGpioLabels().then(fetchGpio));
setInterval(fetchStatus, 10000);
setInterval(() => { fetchGpio(); startCountdown(); }, 2000);
