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

// ======= GPIO =======
let gpioState = {};      // name → {mode, value, analog}
let countdownVal = 2;

const MODE_LABEL = ['INPUT', 'OUTPUT', 'PULLUP'];
const MODE_CLASS = ['mode-input', 'mode-output', 'mode-pullup'];

async function fetchGpio() {
  try {
    const data = await fetch('api/gpio').then(r => r.json());
    const isFirst = Object.keys(gpioState).length === 0;
    data.pins.forEach(p => { gpioState[p.name] = p; });
    if (isFirst) renderGpioGrid(data.pins);
    else updateGpioValues(data.pins);
  } catch { /* silent — ESP32 offline */ }
}

async function setGpio(pin, mode, value) {
  await fetch('api/gpio/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, mode, value }),
  });
  gpioState[pin].mode  = mode;
  gpioState[pin].value = value;
  renderPinCard(document.querySelector(`[data-pin="${pin}"]`), gpioState[pin]);
}

// ---- Render full grid (first load) ----
function renderGpioGrid(pins) {
  const grid = document.getElementById('gpio-grid');
  grid.innerHTML = '';
  pins.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pin-card';
    card.dataset.pin = p.name;
    renderPinCard(card, p);
    grid.appendChild(card);
  });
}

// ---- Update only values (subsequent polls) ----
function updateGpioValues(pins) {
  pins.forEach(p => {
    const card = document.querySelector(`[data-pin="${p.name}"]`);
    if (!card) return;
    const prev = gpioState[p.name];
    // only re-render if value changed (mode change triggers full re-render already)
    if (prev.value !== p.value) {
      gpioState[p.name] = p;
      renderPinCard(card, p);
    }
  });
}

// ---- Render one pin card ----
function renderPinCard(card, p) {
  card.innerHTML = `
    <div class="pin-header">
      <span class="pin-name">${p.name}</span>
      <span class="pin-gpio">GPIO${p.gpio}</span>
    </div>
    <div class="pin-modes">
      ${[0,1,2].map(m => `
        <button class="mode-btn ${p.mode===m?'active-mode-'+m:''}"
                onclick="setGpio('${p.name}',${m},${p.mode===1?p.value:0})">
          ${MODE_LABEL[m]}
        </button>`).join('')}
    </div>
    <div class="pin-value">
      ${p.mode === 1 ? renderOutput(p) : renderInput(p)}
    </div>`;
}

function renderOutput(p) {
  return `
    <div class="output-row">
      <button class="toggle-btn ${p.value ? 'high' : 'low'}"
              onclick="setGpio('${p.name}',1,${p.value?0:1})">
        ${p.value ? 'HIGH' : 'LOW'}
      </button>
    </div>`;
}

function renderInput(p) {
  if (p.analog && p.mode !== 1) {
    const pct = Math.round(p.value / 4095 * 100);
    return `
      <div class="analog-row">
        <span class="analog-val">${p.value}</span>
        <div class="analog-bar"><div class="analog-fill" style="width:${pct}%"></div></div>
      </div>`;
  }
  return `<div class="digital-dot ${p.value ? 'dot-high' : 'dot-low'}">${p.value ? 'HIGH' : 'LOW'}</div>`;
}

// ---- Countdown badge ----
function startCountdown() {
  countdownVal = 2;
  const badge = document.getElementById('gpio-countdown');
  const tick = setInterval(() => {
    countdownVal--;
    badge.textContent = countdownVal > 0 ? `รีเฟรชใน ${countdownVal}s` : 'กำลังโหลด...';
    if (countdownVal <= 0) clearInterval(tick);
  }, 1000);
}

// ======= Init =======
fetchStatus();
fetchGpio();
setInterval(fetchStatus, 10000);
setInterval(() => { fetchGpio(); startCountdown(); }, 2000);
