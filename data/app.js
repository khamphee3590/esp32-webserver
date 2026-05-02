const {
  useState,
  useEffect,
  useRef,
  useCallback
} = React;
const isLocalMode = !window.location.pathname.startsWith('/d/');
const ML = ['INPUT', 'OUTPUT', 'PULLUP'];
const GPIO_POLL_MS = isLocalMode ? 500 : 1000;
const STATUS_POLL_MS = 5000;
const LABEL_CACHE_MS = 30000;
const DEBUG_TIMING = new URLSearchParams(window.location.search).has('debugTiming');
async function timedJson(url, label) {
  const started = performance.now();
  const response = await fetch(url);
  const data = await response.json();
  const elapsed = Math.round(performance.now() - started);
  const relayMs = response.headers.get('x-relay-roundtrip-ms');
  if (DEBUG_TIMING || elapsed >= 750) {
    console.log('[Timing]', label || url, {
      browserMs: elapsed,
      relayMs
    });
  }
  return data;
}
function showToast(msg, type) {
  const c = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  const t = type || 'ok';
  const col = t === 'ok' ? 'var(--green)' : t === 'err' ? 'var(--red)' : 'var(--muted)';
  el.innerHTML = '<span style="color:' + col + ';font-size:.7rem">' + (t === 'ok' ? '✓' : t === 'err' ? '✕' : '·') + '</span><span>' + msg + '</span>';
  c.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => {
    el.classList.remove('show');
    el.addEventListener('transitionend', () => el.remove(), {
      once: true
    });
  }, 2500);
}
function sig(r) {
  if (r > -60) return 4;
  if (r > -70) return 3;
  if (r > -80) return 2;
  return 1;
}
function fmtUp(s) {
  return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm ' + s % 60 + 's';
}
function Signal({
  rssi
}) {
  const b = sig(rssi);
  return React.createElement("div", {
    className: "signal"
  }, [1, 2, 3, 4].map(i => React.createElement("div", {
    key: i,
    className: 'sb' + (i <= b ? ' on' : '')
  })));
}
function OtaSection({
  label,
  type
}) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [cls, setCls] = useState('');
  const upload = () => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    setMsg('กำลังอัพโหลด...');
    setCls('');
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const p = Math.round(e.loaded / e.total * 100);
        setPct(p);
        setMsg(p + '%');
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        setPct(100);
        setMsg('สำเร็จ! กำลัง restart...');
        setCls('ok');
        showToast('OTA อัพโหลดสำเร็จ');
      } else {
        setMsg('เกิดข้อผิดพลาด');
        setCls('err');
      }
    };
    xhr.onerror = () => {
      setMsg('เกิดข้อผิดพลาด');
      setCls('err');
    };
    xhr.open('POST', 'ota');
    xhr.send(form);
  };
  return React.createElement("div", {
    className: "ota-sec"
  }, React.createElement("div", {
    className: "ota-type"
  }, label), React.createElement("div", {
    className: "ota-file-row"
  }, React.createElement("label", {
    className: "btn-file",
    htmlFor: 'ota-' + type
  }, "\u0E40\u0E25\u0E37\u0E2D\u0E01"), React.createElement("input", {
    type: "file",
    id: 'ota-' + type,
    accept: ".bin",
    style: {
      display: 'none'
    },
    onChange: e => {
      const f = e.target.files[0];
      setFile(f);
      setName(f ? f.name : '');
    }
  }), React.createElement("span", {
    className: "ota-fname"
  }, name || 'ยังไม่ได้เลือก')), React.createElement("div", {
    className: "ota-bar"
  }, React.createElement("div", {
    className: 'ota-fill' + (cls ? ' ' + cls : ''),
    style: {
      width: pct + '%'
    }
  })), React.createElement("div", {
    className: "ota-status",
    style: {
      color: cls === 'ok' ? 'var(--green)' : cls === 'err' ? 'var(--red)' : 'var(--muted)'
    }
  }, msg), React.createElement("button", {
    className: "btn-ota",
    disabled: !file,
    onClick: upload
  }, "\u0E2D\u0E31\u0E1E\u0E42\u0E2B\u0E25\u0E14 ", label));
}
function PinCard({
  pin: p,
  onSet,
  canControl
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const inputRef = useRef();
  const mc = p.mode === 0 ? 'mi' : p.mode === 1 ? 'mo' : 'mp';
  const startEdit = () => {
    if (!canControl) return;
    setVal(p.label || '');
    setEditing(true);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 10);
  };
  const commit = () => {
    onSet(p.name, 'label', val.trim());
    setEditing(false);
  };
  const cancel = () => setEditing(false);
  const renderVal = () => {
    if (p.mode === 1) {
      if (canControl) return React.createElement("button", {
        className: 'toggle-btn ' + (p.value ? 'hi' : 'lo'),
        onClick: () => onSet(p.name, 'toggle', null)
      }, p.value ? 'HIGH' : 'LOW');
      return React.createElement("div", {
        className: 'dig-dot ' + (p.value ? 'dot-hi' : 'dot-lo')
      }, p.value ? 'HIGH' : 'LOW');
    }
    if (p.analog) {
      const pct = Math.round(p.value / 4095 * 100);
      return React.createElement("div", {
        className: "analog-wrap"
      }, React.createElement("span", {
        className: "analog-val"
      }, p.value), React.createElement("div", {
        className: "analog-bg"
      }, React.createElement("div", {
        className: "analog-fill",
        style: {
          width: pct + '%'
        }
      })));
    }
    return React.createElement("div", {
      className: 'dig-dot ' + (p.value ? 'dot-hi' : 'dot-lo')
    }, p.value ? 'HIGH' : 'LOW');
  };
  return React.createElement("div", {
    className: 'pin-card ' + mc
  }, React.createElement("div", {
    className: "pin-head"
  }, React.createElement("div", {
    className: "pin-names",
    onClick: startEdit
  }, editing ? React.createElement("input", {
    ref: inputRef,
    className: "pin-edit",
    value: val,
    onChange: e => setVal(e.target.value),
    onBlur: commit,
    onKeyDown: e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') cancel();
    }
  }) : React.createElement("span", {
    className: "pin-primary"
  }, p.label || p.name), p.label && !editing && React.createElement("span", {
    className: "pin-secondary"
  }, p.name), !p.label && !editing && React.createElement("span", {
    className: "pin-hint"
  }, canControl ? '+ ชื่อ' : '')), React.createElement("span", {
    className: "pin-gpio"
  }, "GPIO", p.gpio)), React.createElement("div", {
    className: "pin-modes"
  }, [0, 1, 2].map(m => React.createElement("button", {
    key: m,
    className: 'mode-btn' + (p.mode === m ? ' m' + m : ''),
    disabled: !canControl,
    onClick: () => onSet(p.name, 'mode', m),
    title: ML[m]
  }, ML[m]))), React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      alignItems: 'stretch'
    }
  }, renderVal()));
}
function SettingsModal({
  show,
  onClose,
  devName,
  onSaveName,
  isOwner
}) {
  const [tab, setTab] = useState('device');
  const [name, setName] = useState(devName);
  const [pcode, setPcode] = useState('------');
  const [devId, setDevId] = useState('-');
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [msg, setMsg] = useState({
    text: '',
    cls: ''
  });
  useEffect(() => {
    if (!show) return;
    setName(devName);
    if (!isLocalMode) {
      fetch('api/device/info').then(r => r.json()).then(d => {
        setName(d.name || devName);
        setPcode(d.pairing_code || '------');
        setDevId(d.device_id || '-');
      }).catch(() => {});
      if (isOwner) fetch('api/device/users').then(r => r.json()).then(setUsers).catch(() => {});
    }
  }, [show]);
  const sm = (t, c) => {
    setMsg({
      text: t,
      cls: c
    });
    setTimeout(() => setMsg({
      text: '',
      cls: ''
    }), 3000);
  };
  const saveName = async () => {
    if (!isLocalMode) {
      await fetch('api/device/info', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name
        })
      });
    }
    onSaveName(name);
    showToast('บันทึกชื่อแล้ว');
    onClose();
  };
  const rmUser = async id => {
    await fetch('api/device/users/' + id, {
      method: 'DELETE'
    });
    setUsers(u => u.filter(x => x.userId !== id));
    showToast('ลบผู้ใช้แล้ว');
  };
  const invite = async () => {
    if (!email) {
      sm('กรุณาใส่อีเมล', 'err');
      return;
    }
    const r = await fetch('api/device/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        role
      })
    }).then(r => r.json());
    if (r.ok) {
      setUsers(u => [...u, {
        userId: Date.now(),
        email,
        role
      }]);
      setEmail('');
      sm('เชิญสำเร็จ', 'ok');
      showToast('เชิญผู้ใช้สำเร็จ');
    } else sm(r.error || 'เกิดข้อผิดพลาด', 'err');
  };
  if (!show) return null;
  return React.createElement("div", {
    className: "overlay show",
    onClick: e => e.target === e.currentTarget && onClose()
  }, React.createElement("div", {
    className: "modal"
  }, React.createElement("div", {
    className: "modal-head"
  }, React.createElement("h3", null, "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C"), React.createElement("button", {
    className: "btn-x",
    onClick: onClose
  }, "\u2715")), React.createElement("div", {
    className: "modal-tabs"
  }, React.createElement("button", {
    className: 'mtab' + (tab === 'device' ? ' active' : ''),
    onClick: () => setTab('device')
  }, "\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C"), isOwner && !isLocalMode && React.createElement("button", {
    className: 'mtab' + (tab === 'users' ? ' active' : ''),
    onClick: () => setTab('users')
  }, "\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49")), tab === 'device' && React.createElement("div", {
    className: "modal-body"
  }, React.createElement("div", {
    className: "m-group"
  }, React.createElement("label", {
    className: "m-label"
  }, "\u0E0A\u0E37\u0E48\u0E2D\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C"), React.createElement("div", {
    className: "input-row"
  }, React.createElement("input", {
    className: "m-input",
    value: name,
    onChange: e => setName(e.target.value)
  }), React.createElement("button", {
    className: "btn-save",
    onClick: saveName
  }, "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01"))), React.createElement("div", {
    className: "m-group"
  }, React.createElement("label", {
    className: "m-label"
  }, "Pairing Code"), React.createElement("div", {
    className: "pcode"
  }, pcode), React.createElement("div", {
    className: "hint"
  }, "\u0E43\u0E0A\u0E49\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E01\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C\u0E01\u0E31\u0E1A\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E43\u0E2B\u0E21\u0E48")), React.createElement("div", {
    className: "m-group"
  }, React.createElement("label", {
    className: "m-label"
  }, "Device ID"), React.createElement("div", {
    className: "mono"
  }, devId))), tab === 'users' && isOwner && React.createElement("div", {
    className: "modal-body"
  }, React.createElement("div", {
    className: "m-group"
  }, React.createElement("label", {
    className: "m-label"
  }, "\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49"), users.map(u => React.createElement("div", {
    key: u.userId,
    className: "user-row"
  }, React.createElement("span", {
    className: "u-email"
  }, u.email), React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, React.createElement("span", {
    className: "u-role"
  }, u.role), u.role !== 'owner' && React.createElement("button", {
    className: "btn-rm",
    onClick: () => rmUser(u.userId)
  }, "\u0E25\u0E1A"))))), React.createElement("div", {
    className: "m-group"
  }, React.createElement("label", {
    className: "m-label"
  }, "\u0E40\u0E0A\u0E34\u0E0D\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49"), React.createElement("div", {
    className: "input-row"
  }, React.createElement("input", {
    className: "m-input",
    type: "email",
    placeholder: "email@example.com",
    value: email,
    onChange: e => setEmail(e.target.value)
  }), React.createElement("select", {
    className: "m-select",
    value: role,
    onChange: e => setRole(e.target.value)
  }, React.createElement("option", {
    value: "editor"
  }, "Editor"), React.createElement("option", {
    value: "viewer"
  }, "Viewer"))), React.createElement("button", {
    className: "btn-save btn-full",
    onClick: invite
  }, "\u0E40\u0E0A\u0E34\u0E0D"), msg.text && React.createElement("div", {
    className: 'm-msg ' + msg.cls
  }, msg.text)))));
}
function App() {
  const [pins, setPins] = useState([]);
  const [status, setStatus] = useState({
    ip: '...',
    rssi: 0,
    uptime: 0,
    status: 'ok'
  });
  const [uptime, setUptime] = useState(0);
  const [filter, setFilter] = useState('all');
  const [showSettings, setSS] = useState(false);
  const [devName, setDevName] = useState('ESP32');
  const [countdown, setCD] = useState(Math.ceil(GPIO_POLL_MS / 1000));
  const [otaOpen, setOtaOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [role, setRole] = useState('owner');
  const gpioLoadingRef = useRef(false);
  const statusLoadingRef = useRef(false);
  const labelsRef = useRef({});
  const labelsLoadedRef = useRef(0);
  const canControl = role !== 'viewer';
  const isOwner = role === 'owner';
  useEffect(() => {
    initApp();
    const gpioIv = setInterval(loadGpio, GPIO_POLL_MS);
    const statusIv = setInterval(loadStatus, STATUS_POLL_MS);
    const uptimeIv = setInterval(() => setUptime(u => u + 1), 1000);
    return () => {
      clearInterval(gpioIv);
      clearInterval(statusIv);
      clearInterval(uptimeIv);
    };
  }, []);
  const initApp = async () => {
    if (!isLocalMode) {
      try {
        const d = await timedJson('api/device/info', 'device-info');
        setRole(d.role || 'viewer');
        if (d.name) setDevName(d.name);
      } catch {}
    }
    loadStatus();
    loadGpio();
  };
  const loadStatus = async () => {
    if (statusLoadingRef.current) return;
    statusLoadingRef.current = true;
    try {
      const d = await timedJson('api/status', 'status');
      setStatus(d);
      setUptime(d.uptime || 0);
      if (d.name) setDevName(d.name);
    } catch {} finally {
      statusLoadingRef.current = false;
    }
  };
  const loadLabels = async force => {
    if (isLocalMode) return labelsRef.current;
    const freshEnough = Date.now() - labelsLoadedRef.current < LABEL_CACHE_MS;
    if (!force && freshEnough) return labelsRef.current;
    try {
      const rows = await timedJson('api/gpio/labels', 'gpio-labels');
      const labels = {};
      if (Array.isArray(rows)) rows.forEach(l => {
        labels[l.pin_name] = l.label;
      });
      labelsRef.current = labels;
      labelsLoadedRef.current = Date.now();
    } catch {}
    return labelsRef.current;
  };
  const loadGpio = async () => {
    if (gpioLoadingRef.current) return;
    gpioLoadingRef.current = true;
    setCD(Math.ceil(GPIO_POLL_MS / 1000));
    try {
      const [data, labels] = await Promise.all([timedJson('api/gpio', 'gpio'), loadLabels(false)]);
      setPins((data.pins || []).map((p, i) => ({
        ...p,
        label: labels[p.name] || '',
        _i: i
      })));
    } catch {} finally {
      gpioLoadingRef.current = false;
    }
    setTimeout(() => setCD(0), 100);
  };
  const handleSet = useCallback((pinName, action, val) => {
    setPins(prev => prev.map(p => {
      if (p.name !== pinName) return p;
      if (action === 'toggle') {
        const nv = p.value ? 0 : 1;
        fetch('api/gpio/set', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            pin: pinName,
            mode: p.mode,
            value: nv
          })
        }).then(loadGpio).catch(() => {});
        showToast(pinName + ': ' + (p.value ? 'HIGH→LOW' : 'LOW→HIGH'));
        return {
          ...p,
          value: nv
        };
      }
      if (action === 'mode') {
        fetch('api/gpio/set', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            pin: pinName,
            mode: val,
            value: p.value
          })
        }).then(loadGpio).catch(() => {});
        showToast(pinName + ': ' + ML[val]);
        return {
          ...p,
          mode: val
        };
      }
      if (action === 'label') {
        labelsRef.current = {
          ...labelsRef.current,
          [pinName]: val
        };
        labelsLoadedRef.current = Date.now();
        fetch('api/gpio/labels', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            pin: pinName,
            label: val
          })
        });
        showToast(val ? '"' + val + '"' : 'ลบชื่อแล้ว');
        return {
          ...p,
          label: val
        };
      }
      return p;
    }));
  }, []);
  const filtered = (() => {
    switch (filter) {
      case 'output':
        return pins.filter(p => p.mode === 1);
      case 'input':
        return pins.filter(p => p.mode !== 1);
      case 'high':
        return pins.filter(p => p.mode === 1 && p.value === 1);
      default:
        return pins;
    }
  })();
  const outCount = pins.filter(p => p.mode === 1).length;
  const hiCount = pins.filter(p => p.mode === 1 && p.value === 1).length;
  return React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh'
    }
  }, React.createElement("nav", {
    className: "nav"
  }, React.createElement("div", {
    className: "nav-brand"
  }, React.createElement("span", {
    className: "nav-mark"
  }, "\u26A1"), !isLocalMode && React.createElement("a", {
    href: "/",
    className: "nav-home"
  }, "ESP32 Relay"), !isLocalMode && React.createElement("span", {
    className: "nav-sep"
  }, "\u203A"), React.createElement("span", {
    className: "nav-dev"
  }, devName)), React.createElement("div", {
    className: "nav-right"
  }, React.createElement("div", {
    className: "nav-dot"
  }), React.createElement("span", {
    className: "nav-badge"
  }, isLocalMode ? 'Local' : 'Relay'), (canControl || isOwner) && React.createElement("button", {
    className: "nav-btn",
    onClick: () => setSS(true)
  }, "\u2699 \u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32"), !isLocalMode && React.createElement("button", {
    className: "nav-btn",
    onClick: () => fetch('/api/auth/logout', {
      method: 'POST'
    }).then(() => location.href = '/login')
  }, "\u0E2D\u0E2D\u0E01"), React.createElement("button", {
    className: "nav-ham",
    onClick: () => setSidebarOpen(o => !o),
    "aria-label": "\u0E40\u0E21\u0E19\u0E39"
  }, sidebarOpen ? "\u2715" : "\u2630"))), React.createElement("div", {
    className: "body"
  }, React.createElement("div", {
    className: "sidebar-overlay" + (sidebarOpen ? " show" : ""),
    onClick: () => setSidebarOpen(false)
  }), React.createElement("aside", {
    className: "sidebar" + (sidebarOpen ? " open" : "")
  }, React.createElement("div", {
    className: "s-section"
  }, React.createElement("div", {
    className: "s-title"
  }, "\u0E2A\u0E16\u0E32\u0E19\u0E30"), React.createElement("div", {
    className: "status-grid"
  }, React.createElement("div", {
    className: "si"
  }, React.createElement("span", {
    className: "si-lbl"
  }, "IP"), React.createElement("span", {
    className: "si-val",
    style: {
      fontSize: '.75rem'
    }
  }, status.ip || '...')), React.createElement("div", {
    className: "si"
  }, React.createElement("span", {
    className: "si-lbl"
  }, "Signal"), React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      marginTop: 2
    }
  }, React.createElement(Signal, {
    rssi: status.rssi || 0
  }), React.createElement("span", {
    style: {
      fontSize: '.68rem',
      color: 'var(--muted)'
    }
  }, status.rssi))), React.createElement("div", {
    className: "si"
  }, React.createElement("span", {
    className: "si-lbl"
  }, "Uptime"), React.createElement("span", {
    className: "si-val",
    style: {
      fontSize: '.72rem'
    }
  }, fmtUp(uptime))), React.createElement("div", {
    className: "si"
  }, React.createElement("span", {
    className: "si-lbl"
  }, "\u0E2A\u0E16\u0E32\u0E19\u0E30"), React.createElement("span", {
    className: 'si-val ' + (status.status === 'ok' ? 'ok' : 'err')
  }, status.status === 'ok' ? 'Online' : 'Error'))), React.createElement("button", {
    className: "btn-refresh",
    onClick: loadStatus
  }, "\u0E23\u0E35\u0E40\u0E1F\u0E23\u0E0A")), React.createElement("hr", {
    className: "s-divider"
  }), isLocalMode && React.createElement("div", {
    className: "s-section"
  }, React.createElement("button", {
    className: "ota-toggle",
    onClick: () => setOtaOpen(o => !o)
  }, React.createElement("span", {
    className: "s-title"
  }, "OTA Update"), React.createElement("span", {
    className: 'ota-chev' + (otaOpen ? ' open' : '')
  }, "\u25BE")), React.createElement("div", {
    className: "ota-body",
    style: {
      maxHeight: otaOpen ? '400px' : '0',
      overflow: 'hidden',
      transition: 'max-height .25s ease'
    }
  }, React.createElement(OtaSection, {
    label: "Firmware",
    type: "fw"
  }), React.createElement(OtaSection, {
    label: "Filesystem",
    type: "fs"
  }))), !isLocalMode && React.createElement("div", {
    className: "s-section"
  }, React.createElement("div", {
    className: "s-title",
    style: {
      color: 'var(--dim)',
      fontSize: '.6rem'
    }
  }, "OTA \u2014 \u0E43\u0E0A\u0E49\u0E1C\u0E48\u0E32\u0E19 Local IP \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19"))), React.createElement("main", {
    className: "main"
  }, React.createElement("div", {
    className: "gpio-header"
  }, React.createElement("span", {
    className: "gpio-title"
  }, "GPIO Control"), React.createElement("div", {
    className: "gpio-meta"
  }, outCount > 0 && React.createElement("span", {
    className: "gpio-stats"
  }, outCount, " OUT \xB7 ", hiCount, " HIGH"), React.createElement("span", {
    className: "countdown"
  }, countdown > 0 ? countdown + 's' : '...'))), React.createElement("div", {
    className: "filter-row"
  }, React.createElement("div", {
    className: "filter-tabs"
  }, ['all', 'output', 'input', 'high'].map((f, i) => React.createElement("button", {
    key: f,
    className: 'ftab' + (filter === f ? ' active' : ''),
    onClick: () => setFilter(f)
  }, ['ทั้งหมด', 'OUTPUT', 'INPUT', 'HIGH'][i]))), React.createElement("div", {
    className: "legend"
  }, React.createElement("span", null, React.createElement("span", {
    className: "ldot",
    style: {
      background: 'var(--blue)'
    }
  }), "IN"), React.createElement("span", null, React.createElement("span", {
    className: "ldot",
    style: {
      background: 'var(--amber)'
    }
  }), "OUT"), React.createElement("span", null, React.createElement("span", {
    className: "ldot",
    style: {
      background: 'var(--purple)'
    }
  }), "PU"))), React.createElement("div", {
    className: "gpio-grid"
  }, filtered.length === 0 ? React.createElement("div", {
    className: "gpio-empty"
  }, pins.length === 0 ? 'กำลังโหลด GPIO...' : 'ไม่มีพินที่ตรงกัน') : filtered.map(p => React.createElement(PinCard, {
    key: p.name,
    pin: p,
    onSet: handleSet,
    canControl: canControl
  }))))), React.createElement("footer", null, "Arduino Nano ESP32 \u2014 PlatformIO + ESPAsyncWebServer"), React.createElement(SettingsModal, {
    show: showSettings,
    onClose: () => setSS(false),
    devName: devName,
    onSaveName: n => setDevName(n),
    isOwner: isOwner
  }));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App, null));
