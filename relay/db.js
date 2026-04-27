const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

const DEFAULTS = { users: [], devices: [], device_users: [], gpio_labels: [] };

function load() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch { return { ...DEFAULTS }; }
}

function save(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let _db = load();
const persist = (fn) => { fn(_db); save(_db); };

// ======= Users =======
function getUserByEmail(email) {
    return _db.users.find(u => u.email === email) || null;
}

function getUserById(id) {
    return _db.users.find(u => u.id === id) || null;
}

function getUserByResetToken(token) {
    return _db.users.find(u => u.reset_token === token && u.reset_expires > Date.now()) || null;
}

function createUser(email, passwordHash) {
    const id = Date.now();
    persist(db => db.users.push({ id, email, password_hash: passwordHash, created_at: Date.now(), reset_token: null, reset_expires: null }));
    return id;
}

function setResetToken(id, token, expires) {
    persist(db => {
        const u = db.users.find(u => u.id === id);
        if (u) { u.reset_token = token; u.reset_expires = expires; }
    });
}

function updatePassword(id, passwordHash) {
    persist(db => {
        const u = db.users.find(u => u.id === id);
        if (u) { u.password_hash = passwordHash; u.reset_token = null; u.reset_expires = null; }
    });
}

// ======= Devices =======
function upsertDevice(deviceId, name, pairingCode) {
    persist(db => {
        const idx = db.devices.findIndex(d => d.device_id === deviceId);
        const rec = { device_id: deviceId, name: name || 'ESP32 Device', pairing_code: pairingCode, last_seen: Date.now() };
        if (idx >= 0) db.devices[idx] = rec;
        else db.devices.push(rec);
    });
}

function getDeviceByPairingCode(code) {
    return _db.devices.find(d => d.pairing_code === code) || null;
}

function touchDevice(deviceId) {
    persist(db => {
        const d = db.devices.find(d => d.device_id === deviceId);
        if (d) d.last_seen = Date.now();
    });
}

// ======= Device-User relationships =======
function getDeviceAccess(userId, deviceId) {
    return _db.device_users.find(r => r.user_id === userId && r.device_id === deviceId) || null;
}

function getDevicesByUser(userId) {
    const pairs = _db.device_users.filter(r => r.user_id === userId);
    return pairs.map(r => {
        const d = _db.devices.find(d => d.device_id === r.device_id);
        return d ? { ...d, role: r.role } : null;
    }).filter(Boolean);
}

function pairDevice(userId, deviceId, role = 'owner') {
    persist(db => db.device_users.push({ user_id: userId, device_id: deviceId, role, joined_at: Date.now() }));
}

function unpairDevice(userId, deviceId) {
    persist(db => { db.device_users = db.device_users.filter(r => !(r.user_id === userId && r.device_id === deviceId)); });
}

// ======= Device Management =======
function getDeviceById(deviceId) {
    return _db.devices.find(d => d.device_id === deviceId) || null;
}

function updateDeviceName(deviceId, name) {
    persist(db => {
        const d = db.devices.find(d => d.device_id === deviceId);
        if (d) d.name = name;
    });
}

function getDeviceUsers(deviceId) {
    return _db.device_users
        .filter(r => r.device_id === deviceId)
        .map(r => {
            const u = _db.users.find(u => u.id === r.user_id);
            return u ? { userId: u.id, email: u.email, role: r.role, joined_at: r.joined_at } : null;
        })
        .filter(Boolean);
}

function inviteUserByEmail(deviceId, email, role) {
    const user = getUserByEmail(email);
    if (!user) return { ok: false, error: 'ไม่พบผู้ใช้ที่มีอีเมลนี้' };
    if (getDeviceAccess(user.id, deviceId)) return { ok: false, error: 'ผู้ใช้นี้มีสิทธิ์เข้าถึงอยู่แล้ว' };
    pairDevice(user.id, deviceId, role);
    return { ok: true };
}

// ======= GPIO Labels =======
function getGpioLabels(deviceId) {
    return _db.gpio_labels.filter(l => l.device_id === deviceId);
}

function setGpioLabel(deviceId, pinName, label) {
    persist(db => {
        const idx = db.gpio_labels.findIndex(l => l.device_id === deviceId && l.pin_name === pinName);
        if (idx >= 0) db.gpio_labels[idx].label = label;
        else db.gpio_labels.push({ device_id: deviceId, pin_name: pinName, label });
    });
}

module.exports = {
    getUserByEmail, getUserById, getUserByResetToken,
    createUser, setResetToken, updatePassword,
    upsertDevice, getDeviceByPairingCode, touchDevice,
    getDeviceById, updateDeviceName, getDeviceUsers, inviteUserByEmail,
    getDeviceAccess, getDevicesByUser, pairDevice, unpairDevice,
    getGpioLabels, setGpioLabel,
};
