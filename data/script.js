// ======= State =======
let gpioState  = {};
let gpioLabels = {}; // pin → label string
let deviceRole = 'viewer';
let countdownVal = 2;

const MODE_LABEL = ['INPUT', 'OUTPUT', 'PULLUP'];

// ======= Status =======
async function fetchStatus() {
  try {
    const data = await fetch('api/status').then(r => r.json());
    document.getElementById('ip').textContent     = data.ip;
    document.getElementById('rssi').textContent   = data.rssi + ' dBm';
    document.getElementById('uptime').textContent = formatUptime(data.uptime);
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
  } catch { /* labels optional — relay may not be available in local mode */ }
}

async function saveLabel(pin, label) {
  gpioLabels[pin] = label;
  try {
    await fetch('api/gpio/labels', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin, label }),
    });
  } catch { /* silent — works even without relay */ }
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
    const newSpan = makeLabelSpan(pin, val);
    input.replaceWith(newSpan);
  };
  const cancel = () => {
    const newSpan = makeLabelSpan(pin, current);
    input.replaceWith(newSpan);
  };

  input.addEventListener('blur',    commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

function makeLabelSpan(pin, label) {
  const span   = document.createElement('span');
  span.id        = 'lbl-' + pin;
  span.className = label ? 'pin-label has-label' : 'pin-label';
  span.title     = 'คลิกเพื่อแก้ไขชื่อ';
  span.textContent = label || '+ ตั้งชื่อ';
  span.onclick   = () => editLabel(pin);
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
    card.className  = 'pin-card';
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
  const label = gpioLabels[p.name] || '';
  card.innerHTML = `
    <div class="pin-header">
      <div class="pin-names">
        <span class="pin-name">${p.name}</span>
      </div>
      <span class="pin-gpio">GPIO${p.gpio}</span>
    </div>
    <div class="pin-modes">
      ${[0,1,2].map(m => `
        <button type="button" class="mode-btn ${p.mode===m?'active-mode-'+m:''}"
                onclick="setGpio('${p.name}',${m},${p.mode===1?p.value:0})">
          ${MODE_LABEL[m]}
        </button>`).join('')}
    </div>
    <div class="pin-value">
      ${p.mode === 1 ? renderOutput(p) : renderInput(p)}
    </div>`;

  // ใส่ label span หลัง render (เพื่อให้ event listener ทำงานได้)
  const namesDiv = card.querySelector('.pin-names');
  namesDiv.appendChild(makeLabelSpan(p.name, label));
}

function renderOutput(p) {
  return `<div class="output-row">
    <button type="button" class="toggle-btn ${p.value ? 'high' : 'low'}"
            onclick="setGpio('${p.name}',1,${p.value?0:1})">
      ${p.value ? 'HIGH' : 'LOW'}
    </button></div>`;
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
    document.getElementById('s-devname').value = d.name || '';
    document.getElementById('s-pcode').textContent  = d.pairing_code || '------';
    document.getElementById('s-devid').textContent  = d.device_id   || '-';
    deviceRole = d.role || 'viewer';
    // ซ่อน invite section ถ้าไม่ใช่ owner
    const inv = document.getElementById('invite-section');
    if (inv) inv.classList.toggle('hidden', deviceRole !== 'owner');
  } catch { /* local mode — relay not available */ }
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
    document.getElementById('dev-subtitle').textContent = name;
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

// ======= Init =======
fetchStatus();
fetchGpioLabels().then(fetchGpio);
setInterval(fetchStatus, 10000);
setInterval(() => { fetchGpio(); startCountdown(); }, 2000);
