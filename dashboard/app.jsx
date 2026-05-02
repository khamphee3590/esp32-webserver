const { useState, useEffect, useRef, useCallback } = React;

const isLocalMode = !window.location.pathname.startsWith('/d/');
const ML = ['INPUT','OUTPUT','PULLUP'];
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
    console.log('[Timing]', label || url, { browserMs: elapsed, relayMs });
  }
  return data;
}

function showToast(msg, type) {
  const c = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  const t = type || 'ok';
  const col = t==='ok' ? 'var(--green)' : t==='err' ? 'var(--red)' : 'var(--muted)';
  el.innerHTML = '<span style="color:'+col+';font-size:.7rem">'+(t==='ok'?'✓':t==='err'?'✕':'·')+'</span><span>'+msg+'</span>';
  c.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); el.addEventListener('transitionend',()=>el.remove(),{once:true}); }, 2500);
}

function sig(r) { if(r>-60)return 4; if(r>-70)return 3; if(r>-80)return 2; return 1; }
function fmtUp(s) { return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m '+s%60+'s'; }

function Signal({ rssi }) {
  const b = sig(rssi);
  return <div className="signal">{[1,2,3,4].map(i=><div key={i} className={'sb'+(i<=b?' on':'')}></div>)}</div>;
}

function OtaSection({ label, type }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [pct, setPct]   = useState(0);
  const [msg, setMsg]   = useState('');
  const [cls, setCls]   = useState('');

  const upload = () => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    setMsg('กำลังอัพโหลด...'); setCls('');
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) { const p=Math.round(e.loaded/e.total*100); setPct(p); setMsg(p+'%'); }
    };
    xhr.onload = () => {
      if (xhr.status===200) { setPct(100); setMsg('สำเร็จ! กำลัง restart...'); setCls('ok'); showToast('OTA อัพโหลดสำเร็จ'); }
      else { setMsg('เกิดข้อผิดพลาด'); setCls('err'); }
    };
    xhr.onerror = () => { setMsg('เกิดข้อผิดพลาด'); setCls('err'); };
    xhr.open('POST', 'ota');
    xhr.send(form);
  };

  return (
    <div className="ota-sec">
      <div className="ota-type">{label}</div>
      <div className="ota-file-row">
        <label className="btn-file" htmlFor={'ota-'+type}>เลือก</label>
        <input type="file" id={'ota-'+type} accept=".bin" style={{display:'none'}}
          onChange={e=>{const f=e.target.files[0];setFile(f);setName(f?f.name:'');}} />
        <span className="ota-fname">{name||'ยังไม่ได้เลือก'}</span>
      </div>
      <div className="ota-bar"><div className={'ota-fill'+(cls?' '+cls:'')} style={{width:pct+'%'}}></div></div>
      <div className="ota-status" style={{color:cls==='ok'?'var(--green)':cls==='err'?'var(--red)':'var(--muted)'}}>{msg}</div>
      <button className="btn-ota" disabled={!file} onClick={upload}>อัพโหลด {label}</button>
    </div>
  );
}

function PinCard({ pin: p, onSet, canControl }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState('');
  const inputRef = useRef();
  const mc = p.mode===0?'mi':p.mode===1?'mo':'mp';

  const startEdit = () => { if(!canControl)return; setVal(p.label||''); setEditing(true); setTimeout(()=>inputRef.current&&inputRef.current.focus(),10); };
  const commit = () => { onSet(p.name,'label',val.trim()); setEditing(false); };
  const cancel = () => setEditing(false);

  const renderVal = () => {
    if (p.mode===1) {
      if (canControl) return <button className={'toggle-btn '+(p.value?'hi':'lo')} onClick={()=>onSet(p.name,'toggle',null)}>{p.value?'HIGH':'LOW'}</button>;
      return <div className={'dig-dot '+(p.value?'dot-hi':'dot-lo')}>{p.value?'HIGH':'LOW'}</div>;
    }
    if (p.analog) {
      const pct = Math.round(p.value/4095*100);
      return <div className="analog-wrap"><span className="analog-val">{p.value}</span><div className="analog-bg"><div className="analog-fill" style={{width:pct+'%'}}></div></div></div>;
    }
    return <div className={'dig-dot '+(p.value?'dot-hi':'dot-lo')}>{p.value?'HIGH':'LOW'}</div>;
  };

  return (
    <div className={'pin-card '+mc}>
      <div className="pin-head">
        <div className="pin-names" onClick={startEdit}>
          {editing
            ? <input ref={inputRef} className="pin-edit" value={val}
                onChange={e=>setVal(e.target.value)}
                onBlur={commit}
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape')cancel();}} />
            : <span className="pin-primary">{p.label||p.name}</span>
          }
          {p.label&&!editing&&<span className="pin-secondary">{p.name}</span>}
          {!p.label&&!editing&&<span className="pin-hint">{canControl?'+ ชื่อ':''}</span>}
        </div>
        <span className="pin-gpio">GPIO{p.gpio}</span>
      </div>
      <div className="pin-modes">
        {[0,1,2].map(m=>(
          <button key={m} className={'mode-btn'+(p.mode===m?' m'+m:'')} disabled={!canControl} onClick={()=>onSet(p.name,'mode',m)} title={ML[m]}>{ML[m]}</button>
        ))}
      </div>
      <div style={{flex:1,display:'flex',alignItems:'stretch'}}>{renderVal()}</div>
    </div>
  );
}

function SettingsModal({ show, onClose, devName, onSaveName, isOwner }) {
  const [tab, setTab]   = useState('device');
  const [name, setName] = useState(devName);
  const [pcode, setPcode] = useState('------');
  const [devId, setDevId] = useState('-');
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole]   = useState('editor');
  const [msg, setMsg]     = useState({text:'',cls:''});

  useEffect(() => {
    if (!show) return;
    setName(devName);
    if (!isLocalMode) {
      fetch('api/device/info').then(r=>r.json()).then(d=>{
        setName(d.name||devName);
        setPcode(d.pairing_code||'------');
        setDevId(d.device_id||'-');
      }).catch(()=>{});
      if (isOwner) fetch('api/device/users').then(r=>r.json()).then(setUsers).catch(()=>{});
    }
  }, [show]);

  const sm = (t,c) => { setMsg({text:t,cls:c}); setTimeout(()=>setMsg({text:'',cls:''}),3000); };

  const saveName = async () => {
    if (!isLocalMode) {
      await fetch('api/device/info',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    }
    onSaveName(name); showToast('บันทึกชื่อแล้ว'); onClose();
  };

  const rmUser = async id => {
    await fetch('api/device/users/'+id,{method:'DELETE'});
    setUsers(u=>u.filter(x=>x.userId!==id)); showToast('ลบผู้ใช้แล้ว');
  };

  const invite = async () => {
    if (!email) { sm('กรุณาใส่อีเมล','err'); return; }
    const r = await fetch('api/device/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,role})}).then(r=>r.json());
    if (r.ok) { setUsers(u=>[...u,{userId:Date.now(),email,role}]); setEmail(''); sm('เชิญสำเร็จ','ok'); showToast('เชิญผู้ใช้สำเร็จ'); }
    else sm(r.error||'เกิดข้อผิดพลาด','err');
  };

  if (!show) return null;
  return (
    <div className="overlay show" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-head"><h3>ตั้งค่าอุปกรณ์</h3><button className="btn-x" onClick={onClose}>✕</button></div>
        <div className="modal-tabs">
          <button className={'mtab'+(tab==='device'?' active':'')} onClick={()=>setTab('device')}>อุปกรณ์</button>
          {isOwner&&!isLocalMode&&<button className={'mtab'+(tab==='users'?' active':'')} onClick={()=>setTab('users')}>ผู้ใช้</button>}
        </div>
        {tab==='device'&&(
          <div className="modal-body">
            <div className="m-group">
              <label className="m-label">ชื่ออุปกรณ์</label>
              <div className="input-row"><input className="m-input" value={name} onChange={e=>setName(e.target.value)} /><button className="btn-save" onClick={saveName}>บันทึก</button></div>
            </div>
            <div className="m-group"><label className="m-label">Pairing Code</label><div className="pcode">{pcode}</div><div className="hint">ใช้เพื่อผูกอุปกรณ์กับบัญชีใหม่</div></div>
            <div className="m-group"><label className="m-label">Device ID</label><div className="mono">{devId}</div></div>
          </div>
        )}
        {tab==='users'&&isOwner&&(
          <div className="modal-body">
            <div className="m-group">
              <label className="m-label">ผู้ใช้</label>
              {users.map(u=>(
                <div key={u.userId} className="user-row">
                  <span className="u-email">{u.email}</span>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span className="u-role">{u.role}</span>
                    {u.role!=='owner'&&<button className="btn-rm" onClick={()=>rmUser(u.userId)}>ลบ</button>}
                  </div>
                </div>
              ))}
            </div>
            <div className="m-group">
              <label className="m-label">เชิญผู้ใช้</label>
              <div className="input-row">
                <input className="m-input" type="email" placeholder="email@example.com" value={email} onChange={e=>setEmail(e.target.value)} />
                <select className="m-select" value={role} onChange={e=>setRole(e.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
              </div>
              <button className="btn-save btn-full" onClick={invite}>เชิญ</button>
              {msg.text&&<div className={'m-msg '+msg.cls}>{msg.text}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [pins, setPins]       = useState([]);
  const [status, setStatus]   = useState({ip:'...',rssi:0,uptime:0,status:'ok'});
  const [uptime, setUptime]   = useState(0);
  const [filter, setFilter]   = useState('all');
  const [showSettings, setSS] = useState(false);
  const [devName, setDevName] = useState('ESP32');
  const [countdown, setCD]    = useState(Math.ceil(GPIO_POLL_MS / 1000));
  const [otaOpen, setOtaOpen]       = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [role, setRole]               = useState('owner');
  const gpioLoadingRef        = useRef(false);
  const statusLoadingRef      = useRef(false);
  const labelsRef             = useRef({});
  const labelsLoadedRef       = useRef(0);
  const canControl = role !== 'viewer';
  const isOwner    = role === 'owner';

  useEffect(() => {
    initApp();
    const gpioIv   = setInterval(loadGpio, GPIO_POLL_MS);
    const statusIv = setInterval(loadStatus, STATUS_POLL_MS);
    const uptimeIv = setInterval(() => setUptime(u => u + 1), 1000);
    return () => { clearInterval(gpioIv); clearInterval(statusIv); clearInterval(uptimeIv); };
  }, []);

  const initApp = async () => {
    if (!isLocalMode) {
      try {
        const d = await timedJson('api/device/info', 'device-info');
        setRole(d.role||'viewer');
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
      setUptime(d.uptime||0);
      if (d.name) setDevName(d.name);
    } catch {}
    finally { statusLoadingRef.current = false; }
  };

  const loadLabels = async (force) => {
    if (isLocalMode) return labelsRef.current;
    const freshEnough = Date.now() - labelsLoadedRef.current < LABEL_CACHE_MS;
    if (!force && freshEnough) return labelsRef.current;

    try {
      const rows = await timedJson('api/gpio/labels', 'gpio-labels');
      const labels = {};
      if (Array.isArray(rows)) rows.forEach(l => { labels[l.pin_name] = l.label; });
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
      const [data, labels] = await Promise.all([
        timedJson('api/gpio', 'gpio'),
        loadLabels(false)
      ]);
      setPins((data.pins || []).map((p,i) => ({...p, label: labels[p.name]||'', _i:i})));
    } catch {}
    finally { gpioLoadingRef.current = false; }
    setTimeout(() => setCD(0), 100);
  };

  const handleSet = useCallback((pinName, action, val) => {
    setPins(prev => prev.map(p => {
      if (p.name !== pinName) return p;
      if (action === 'toggle') {
        const nv = p.value ? 0 : 1;
        fetch('api/gpio/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pinName,mode:p.mode,value:nv})})
          .then(loadGpio).catch(()=>{});
        showToast(pinName+': '+(p.value?'HIGH→LOW':'LOW→HIGH'));
        return {...p, value: nv};
      }
      if (action === 'mode') {
        fetch('api/gpio/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pinName,mode:val,value:p.value})})
          .then(loadGpio).catch(()=>{});
        showToast(pinName+': '+ML[val]);
        return {...p, mode: val};
      }
      if (action === 'label') {
        labelsRef.current = {...labelsRef.current, [pinName]: val};
        labelsLoadedRef.current = Date.now();
        fetch('api/gpio/labels',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pinName,label:val})});
        showToast(val?'"'+val+'"':'ลบชื่อแล้ว');
        return {...p, label: val};
      }
      return p;
    }));
  }, []);

  const filtered = (() => {
    switch(filter) {
      case 'output': return pins.filter(p=>p.mode===1);
      case 'input':  return pins.filter(p=>p.mode!==1);
      case 'high':   return pins.filter(p=>p.mode===1&&p.value===1);
      default: return pins;
    }
  })();

  const outCount = pins.filter(p=>p.mode===1).length;
  const hiCount  = pins.filter(p=>p.mode===1&&p.value===1).length;

  return (
    <div style={{display:'flex',flexDirection:'column',minHeight:'100vh'}}>
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-mark">⚡</span>
          {!isLocalMode && <a href="/" className="nav-home">ESP32 Relay</a>}
          {!isLocalMode && <span className="nav-sep">›</span>}
          <span className="nav-dev">{devName}</span>
        </div>
        <div className="nav-right">
          <div className="nav-dot"></div>
          <span className="nav-badge">{isLocalMode ? 'Local' : 'Relay'}</span>
          {(canControl||isOwner) && <button className="nav-btn" onClick={()=>setSS(true)}>⚙ ตั้งค่า</button>}
          {!isLocalMode && <button className="nav-btn" onClick={()=>fetch('/api/auth/logout',{method:'POST'}).then(()=>location.href='/login')}>ออก</button>}
          <button className="nav-ham" onClick={()=>setSidebarOpen(o=>!o)} aria-label="เมนู">{sidebarOpen?'✕':'☰'}</button>
        </div>
      </nav>

      <div className="body">
        <div className={"sidebar-overlay"+(sidebarOpen?" show":"")} onClick={()=>setSidebarOpen(false)}></div>
        <aside className={"sidebar"+(sidebarOpen?" open":"")}>

          <div className="s-section">
            <div className="s-title">สถานะ</div>
            <div className="status-grid">
              <div className="si"><span className="si-lbl">IP</span><span className="si-val" style={{fontSize:'.75rem'}}>{status.ip||'...'}</span></div>
              <div className="si">
                <span className="si-lbl">Signal</span>
                <div style={{display:'flex',alignItems:'center',gap:5,marginTop:2}}>
                  <Signal rssi={status.rssi||0}/>
                  <span style={{fontSize:'.68rem',color:'var(--muted)'}}>{status.rssi}</span>
                </div>
              </div>
              <div className="si"><span className="si-lbl">Uptime</span><span className="si-val" style={{fontSize:'.72rem'}}>{fmtUp(uptime)}</span></div>
              <div className="si"><span className="si-lbl">สถานะ</span><span className={'si-val '+(status.status==='ok'?'ok':'err')}>{status.status==='ok'?'Online':'Error'}</span></div>
            </div>
            <button className="btn-refresh" onClick={loadStatus}>รีเฟรช</button>
          </div>

          <hr className="s-divider"/>

          {isLocalMode && (
            <div className="s-section">
              <button className="ota-toggle" onClick={()=>setOtaOpen(o=>!o)}>
                <span className="s-title">OTA Update</span>
                <span className={'ota-chev'+(otaOpen?' open':'')}>▾</span>
              </button>
              <div className="ota-body" style={{maxHeight:otaOpen?'400px':'0',overflow:'hidden',transition:'max-height .25s ease'}}>
                <OtaSection label="Firmware" type="fw" />
                <OtaSection label="Filesystem" type="fs" />
              </div>
            </div>
          )}
          {!isLocalMode && (
            <div className="s-section">
              <div className="s-title" style={{color:'var(--dim)',fontSize:'.6rem'}}>OTA — ใช้ผ่าน Local IP เท่านั้น</div>
            </div>
          )}
        </aside>

        <main className="main">
          <div className="gpio-header">
            <span className="gpio-title">GPIO Control</span>
            <div className="gpio-meta">
              {outCount>0&&<span className="gpio-stats">{outCount} OUT · {hiCount} HIGH</span>}
              <span className="countdown">{countdown>0?countdown+'s':'...'}</span>
            </div>
          </div>

          <div className="filter-row">
            <div className="filter-tabs">
              {['all','output','input','high'].map((f,i)=>(
                <button key={f} className={'ftab'+(filter===f?' active':'')} onClick={()=>setFilter(f)}>
                  {['ทั้งหมด','OUTPUT','INPUT','HIGH'][i]}
                </button>
              ))}
            </div>
            <div className="legend">
              <span><span className="ldot" style={{background:'var(--blue)'}}></span>IN</span>
              <span><span className="ldot" style={{background:'var(--amber)'}}></span>OUT</span>
              <span><span className="ldot" style={{background:'var(--purple)'}}></span>PU</span>
            </div>
          </div>

          <div className="gpio-grid">
            {filtered.length===0
              ? <div className="gpio-empty">{pins.length===0?'กำลังโหลด GPIO...':'ไม่มีพินที่ตรงกัน'}</div>
              : filtered.map(p=>(
                  <PinCard key={p.name} pin={p} onSet={handleSet} canControl={canControl} />
                ))
            }
          </div>
        </main>
      </div>

      <footer>Arduino Nano ESP32 — PlatformIO + ESPAsyncWebServer</footer>
      <SettingsModal show={showSettings} onClose={()=>setSS(false)} devName={devName} onSaveName={n=>setDevName(n)} isOwner={isOwner} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
