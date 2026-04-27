// ======= State =======
let gpioState    = {};
let gpioOrder    = []; // ลำดับ pin จาก server
let gpioLabels   = {};
let deviceRole   = 'owner';
let currentFilter = 'all';
let countdownVal  = 2;

const MODE_LABEL  = ['INPUT', 'OUTPUT', 'PULLUP'];
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
  const isOwner    = deviceRole === 'owner';
  const canControl = deviceRole !== 'viewer';

  const navName = document.getElementById('nav-devname');
  if (navName && d.name) navName.textContent = d.name;

  document.getElementById('nav-settings-btn')?.classList.toggle('hidden', !canControl);
  document.getElementById('nav-local-badge')?.classList.toggle('hidden', !isLocalMode);
  document.getElementById('nav-user')?.classList.toggle('hidden', isLocalMode);
  document.getElementById('nav-logout-btn')?.classList.toggle('hidden', isLocalMode);

  const nameInput = document.getElementById('s-devname');
  if (nameInput && d.name) nameInput.value = d.name;
  const pcodeEl = document.getElementById('s-pcode');
  if (pcodeEl) pcodeEl.textContent = d.pairing_code || '------';
  const devidEl = document.getElementById('s-devid');
  if (devidEl) devidEl.textContent = d.device_id || '-';

  document.querySelector('.btn-save')?.classList.toggle('hidden', !isOwner);
  document.getElementById('invite-section')?.classList.toggle('hidden', !isOwner);
  document.getElementById('tab-users-btn')?.classList.toggle('hidden', !isOwner);
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

// ======= Toast =======
function showToast(msg, type = 'ok') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 2800);
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
    showToast(label ? `บันทึกชื่อ "${label}" แล้ว` : 'ลบชื่อแล้ว');
  } catch { showToast('บันทึกไม่ได้', 'err'); }
}

// ======= GPIO Filter =======
function setFilter(f) {
  currentFilter = f;
  const tabs   = document.querySelectorAll('#filter-tabs .ftab');
  const keys   = ['all', 'output', 'input', 'high'];
  tabs.forEach((t, i) => t.classList.toggle('active', keys[i] === f));
  applyFilter();
}

function getFilteredPins() {
  const all = gpioOrder.map(n => gpioState[n]).filter(Boolean);
  switch (currentFilter) {
    case 'output': return all.filter(p => p.mode === 1);
    case 'input':  return all.filter(p => p.mode !== 1);
    case 'high':   return all.filter(p => p.mode === 1 && p.value === 1);
    default:       return all;
  }
}

function applyFilter() {
  const visible = new Set(getFilteredPins().map(p => p.name));
  let shownCount = 0;

  document.querySelectorAll('.pin-card').forEach(card => {
    const show = visible.has(card.dataset.pin);
    card.style.display = show ? '' : 'none';
    if (show) shownCount++;
  });

  // Empty state
  let empty = document.getElementById('gpio-empty-msg');
  if (!empty) {
    empty = document.createElement('div');
    empty.id        = 'gpio-empty-msg';
    empty.className = 'gpio-empty hidden';
    empty.textContent = 'ไม่มีขาในโหมดนี้';
    document.getElementById('gpio-grid').appendChild(empty);
  }
  empty.classList.toggle('hidden', shownCount > 0);
}

// ======= GPIO Stats =======
function updateGpioStats() {
  const pins     = Object.values(gpioState);
  const outCount = pins.filter(p => p.mode === 1).length;
  const hiCount  = pins.filter(p => p.mode === 1 && p.value === 1).length;
  const el       = document.getElementById('gpio-stats');
  if (!el) return;
  el.textContent = outCount ? `${outCount} OUT · ${hiCount} HIGH` : '';
}

// ======= GPIO Skeleton =======
function renderSkeletonGrid() {
  const grid = document.getElementById('gpio-grid');
  grid.innerHTML = Array(12).fill(`
    <div class="pin-card">
      <div class="pin-header">
        <div class="pin-names">
          <div class="skel skel-name"></div>
          <div class="skel skel-hint"></div>
        </div>
        <div class="skel skel-gpio"></div>
      </div>
      <div class="pin-modes">
        <div class="skel skel-btn"></div>
        <div class="skel skel-btn"></div>
        <div class="skel skel-btn"></div>
      </div>
      <div class="skel skel-val"></div>
    </div>`).join('');
}

// ======= GPIO Fetch =======
async function fetchGpio() {
  try {
    const data   = await fetch('api/gpio').then(r => r.json());
    const isFirst = gpioOrder.length === 0;
    gpioOrder = data.pins.map(p => p.name);
    data.pins.forEach(p => { gpioState[p.name] = p; });
    if (isFirst) renderGpioGrid(data.pins);
    else         updateGpioValues(data.pins);
    updateGpioStats();
  } catch { /* silent */ }
}

async function setGpio(pin, mode, value) {
  const prev = { ...gpioState[pin] }; // บันทึก state เดิมไว้ก่อน
  try {
    const res = await fetch('api/gpio/set', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin, mode, value }),
    });
    if (!res.ok) throw new Error(res.status);
    gpioState[pin].mode  = mode;
    gpioState[pin].value = value;
  } catch {
    // คืน state เดิมถ้า request ล้มเหลว
    gpioState[pin] = prev;
    showToast('สั่งงาน GPIO ไม่ได้', 'err');
  }
  const card = document.querySelector(`[data-pin="${pin}"]`);
  if (card) renderPinCard(card, gpioState[pin]);
  updateGpioStats();
  applyFilter();
}

// ======= GPIO Render =======
function renderGpioGrid(pins) {
  const grid = document.getElementById('gpio-grid');
  grid.innerHTML = '';
  pins.forEach((p, i) => {
    const card       = document.createElement('div');
    card.className   = 'pin-card';
    card.dataset.pin = p.name;
    card.style.animationDelay = `${i * 18}ms`; // stagger 18ms ต่อการ์ด
    renderPinCard(card, p);
    grid.appendChild(card);
  });
  applyFilter();
}

function updateGpioValues(pins) {
  pins.forEach(p => {
    const prev = gpioState[p.name];
    if (prev && (prev.value !== p.value || prev.mode !== p.mode)) {
      const valueChanged = prev.value !== p.value;
      gpioState[p.name] = p;
      const card = document.querySelector(`[data-pin="${p.name}"]`);
      if (card) {
        renderPinCard(card, p);
        if (valueChanged) flashPinCard(card);
      }
    }
  });
  applyFilter();
}

function flashPinCard(card) {
  card.classList.remove('pin-flash');
  void card.offsetWidth; // force reflow เพื่อ restart animation
  card.classList.add('pin-flash');
  card.addEventListener('animationend', () => card.classList.remove('pin-flash'), { once: true });
}

function renderPinCard(card, p) {
  const label      = gpioLabels[p.name] || '';
  const canControl = deviceRole !== 'viewer';
  const isHigh     = p.mode === 1 && p.value === 1;
  const inputOnly  = !!p.inputOnly; // GPIO34/35/36/39 บน ESP32 ปกติ

  card.className   = 'pin-card' + (isHigh ? ' pin-high' : '');
  card.dataset.pin = p.name;

  card.innerHTML = `
    <div class="pin-header">
      <div class="pin-names">
        <span class="pin-primary${canControl ? ' pin-editable' : ''}"
              title="${canControl ? (label ? 'คลิกแก้ไขชื่อ' : 'คลิกตั้งชื่อ') : ''}">
          ${label || p.name}
        </span>
        ${label
          ? `<span class="pin-secondary">${p.name}</span>`
          : `<span class="pin-label-hint">${canControl ? '+ ตั้งชื่อ' : ''}</span>`}
        ${inputOnly ? `<span class="pin-badge-ro">Input only</span>` : ''}
      </div>
      <span class="pin-gpio">GPIO${p.gpio}</span>
    </div>
    <div class="pin-modes">
      ${[0,1,2].map(m => {
        const blocked = inputOnly && m !== 0; // input-only: OUTPUT/PULLUP ใช้ไม่ได้
        return `<button type="button"
          class="mode-btn ${p.mode===m ? 'active-mode-'+m : ''}"
          ${(canControl && !blocked) ? `onclick="setGpio('${p.name}',${m},${p.mode===1?p.value:0})"` : 'disabled'}
          title="${blocked ? 'Input only pin' : canControl ? MODE_LABEL[m] : 'Viewer ไม่มีสิทธิ์'}">
          ${MODE_LABEL[m]}
        </button>`;
      }).join('')}
    </div>
    <div class="pin-value">
      ${p.mode === 1 ? renderOutput(p, canControl) : renderInput(p)}
    </div>`;

  if (canControl) {
    const names = card.querySelector('.pin-names');
    names.style.cursor = 'text';
    names.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT') return; // กำลัง edit อยู่แล้ว
      editLabel(p.name);
    });
  }
}

function renderOutput(p, canControl = true) {
  if (canControl) {
    return `<div class="output-row">
      <button type="button" class="toggle-btn ${p.value ? 'high' : 'low'}"
              onclick="setGpio('${p.name}',1,${p.value?0:1})">
        ${p.value ? 'HIGH' : 'LOW'}
      </button></div>`;
  }
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

// ======= Label Inline Edit =======
function editLabel(pin) {
  if (deviceRole === 'viewer') return;
  const card    = document.querySelector(`[data-pin="${pin}"]`);
  if (!card) return;
  const primary = card.querySelector('.pin-primary');
  if (!primary || primary.tagName === 'INPUT') return;

  const current = gpioLabels[pin] || '';
  const input   = document.createElement('input');
  input.type        = 'text';
  input.value       = current;
  input.className   = 'pin-primary label-editing';
  input.maxLength   = 32;
  input.placeholder = pin;

  primary.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    saveLabel(pin, val);
    setTimeout(() => renderPinCard(card, gpioState[pin]), 0);
  };
  const cancel = () => {
    setTimeout(() => renderPinCard(card, gpioState[pin]), 0);
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.removeEventListener('blur', commit); commit(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

// ======= Countdown Badge =======
function startCountdown() {
  countdownVal = 2;
  const badge = document.getElementById('gpio-countdown');
  const tick = setInterval(() => {
    countdownVal--;
    badge.textContent = countdownVal > 0 ? `${countdownVal}s` : '...';
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
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ name }),
    });
    const navName = document.getElementById('nav-devname');
    if (navName) navName.textContent = name;
    showToast('บันทึกชื่ออุปกรณ์แล้ว');
    closeSettings();
  } catch { showToast('บันทึกไม่ได้', 'err'); }
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
  } catch { el.innerHTML = '<div class="loading-text">ไม่สามารถโหลดได้ (local mode)</div>'; }
}

async function inviteUser() {
  const email = document.getElementById('s-email').value.trim();
  const role  = document.getElementById('s-role').value;
  const msg   = document.getElementById('invite-msg');
  if (!email) { msg.textContent = 'กรุณาใส่อีเมล'; msg.className = 'settings-msg msg-err'; return; }
  try {
    const d = await fetch('api/device/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ email, role }),
    }).then(r => r.json());
    if (d.ok) {
      showToast('เชิญผู้ใช้สำเร็จ!');
      document.getElementById('s-email').value = '';
      msg.textContent = ''; msg.className = 'settings-msg';
      loadDeviceUsers();
    } else { msg.textContent = d.error || 'เกิดข้อผิดพลาด'; msg.className = 'settings-msg msg-err'; }
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
  if (input.files[0]) { fname.textContent = input.files[0].name; btn.disabled = false; }
}
function uploadOTA(type) {
  const file = document.getElementById(`ota-${type}-input`).files[0];
  if (!file) return;
  const fill = document.getElementById(`ota-${type}-fill`);
  const btn  = document.getElementById(`ota-${type}-btn`);
  btn.disabled     = true;
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
      fill.style.width = '100%'; fill.classList.add('fill-ok');
      setOtaStatus(type, 'อัพโหลดสำเร็จ! ESP32 กำลัง restart — หน้านี้จะโหลดใหม่ใน 12 วินาที', 'ok');
      setTimeout(() => location.reload(), 12000);
    } else { fill.classList.add('fill-err'); setOtaStatus(type, 'ล้มเหลว: ' + xhr.responseText, 'err'); btn.disabled = false; }
  });
  xhr.addEventListener('error', () => { setOtaStatus(type, 'เชื่อมต่อไม่ได้', 'err'); btn.disabled = false; });
  xhr.open('POST', `ota?type=${type}`);
  xhr.send(formData);
}
function setOtaStatus(type, text, cls) {
  const el = document.getElementById(`ota-${type}-status`);
  el.textContent = text; el.className = 'ota-status ota-' + cls;
}
function updateOtaLink(ip) {
  if (isLocalMode) return;
  const url = `http://${ip}/`;
  const link = document.getElementById('ota-local-link');
  if (link) { link.textContent = url; link.href = url; }
}

// ======= Init =======
initOTA();
fetchStatus();
fetchNavUser();
renderSkeletonGrid(); // แสดง skeleton ทันทีก่อนข้อมูลจริงมา
initRole().then(() => fetchGpioLabels().then(fetchGpio));
setInterval(fetchStatus, 10000);
setInterval(() => { fetchGpio(); startCountdown(); }, 2000);
