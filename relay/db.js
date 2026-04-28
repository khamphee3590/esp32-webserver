const mongoose = require('mongoose');

// ======= Schemas =======
const userSchema = new mongoose.Schema({
    email:         { type: String, unique: true, required: true },
    password_hash: String,
    created_at:    { type: Number, default: Date.now },
    reset_token:   String,
    reset_expires: Number,
});

const deviceSchema = new mongoose.Schema({
    device_id:    { type: String, unique: true, required: true },
    name:         { type: String, default: 'ESP32 Device' },
    pairing_code: String,
    last_seen:    Number,
});

const deviceUserSchema = new mongoose.Schema({
    user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    device_id: String,
    role:      { type: String, enum: ['owner', 'editor', 'viewer'], default: 'viewer' },
    joined_at: { type: Number, default: Date.now },
});

const gpioLabelSchema = new mongoose.Schema({
    device_id: String,
    pin_name:  String,
    label:     String,
});
gpioLabelSchema.index({ device_id: 1, pin_name: 1 }, { unique: true });

const User       = mongoose.model('User',       userSchema);
const Device     = mongoose.model('Device',     deviceSchema);
const DeviceUser = mongoose.model('DeviceUser', deviceUserSchema);
const GpioLabel  = mongoose.model('GpioLabel',  gpioLabelSchema);

// ======= Connection =======
async function connect() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set in .env');
    await mongoose.connect(process.env.DATABASE_URL);
    console.log('✅ Connected to MongoDB Atlas');
}

// ======= Users =======
async function getUserByEmail(email) {
    return User.findOne({ email });
}
async function getUserById(id) {
    return User.findById(id);
}
async function getUserByResetToken(token) {
    return User.findOne({ reset_token: token, reset_expires: { $gt: Date.now() } });
}
async function createUser(email, passwordHash) {
    const user = await User.create({ email, password_hash: passwordHash });
    return user._id;
}
async function setResetToken(id, token, expires) {
    return User.findByIdAndUpdate(id, { reset_token: token, reset_expires: expires });
}
async function updatePassword(id, passwordHash) {
    return User.findByIdAndUpdate(id, { password_hash: passwordHash, reset_token: null, reset_expires: null });
}

// ======= Devices =======
async function upsertDevice(deviceId, name, pairingCode) {
    return Device.findOneAndUpdate(
        { device_id: deviceId },
        { name: name || 'ESP32 Device', pairing_code: pairingCode, last_seen: Date.now() },
        { upsert: true, new: true }
    );
}
async function getDeviceByPairingCode(code) {
    return Device.findOne({ pairing_code: code });
}
async function touchDevice(deviceId) {
    return Device.findOneAndUpdate({ device_id: deviceId }, { last_seen: Date.now() });
}
async function getDeviceById(deviceId) {
    return Device.findOne({ device_id: deviceId });
}
async function updateDeviceName(deviceId, name) {
    return Device.findOneAndUpdate({ device_id: deviceId }, { name });
}

// ======= Device-User =======
async function getDeviceAccess(userId, deviceId) {
    return DeviceUser.findOne({ user_id: userId, device_id: deviceId });
}
async function getDevicesByUser(userId) {
    const relations = await DeviceUser.find({ user_id: userId });
    const ids       = relations.map(r => r.device_id);
    const devs      = await Device.find({ device_id: { $in: ids } });
    return devs.map(d => {
        const rel = relations.find(r => r.device_id === d.device_id);
        return { ...d.toObject(), role: rel?.role };
    });
}
async function pairDevice(userId, deviceId, role = 'owner') {
    return DeviceUser.create({ user_id: userId, device_id: deviceId, role });
}
async function unpairDevice(userId, deviceId) {
    return DeviceUser.findOneAndDelete({ user_id: userId, device_id: deviceId });
}
async function getDeviceUsers(deviceId) {
    const relations = await DeviceUser.find({ device_id: deviceId }).populate('user_id', 'email');
    return relations.map(r => ({
        userId:    r.user_id?._id,
        email:     r.user_id?.email,
        role:      r.role,
        joined_at: r.joined_at,
    }));
}
async function inviteUserByEmail(deviceId, email, role) {
    const user = await getUserByEmail(email);
    if (!user) return { ok: false, error: 'ไม่พบผู้ใช้ที่มีอีเมลนี้' };
    const existing = await getDeviceAccess(user._id, deviceId);
    if (existing) return { ok: false, error: 'ผู้ใช้นี้มีสิทธิ์เข้าถึงอยู่แล้ว' };
    await pairDevice(user._id, deviceId, role);
    return { ok: true };
}

// ======= GPIO Labels =======
async function getGpioLabels(deviceId) {
    return GpioLabel.find({ device_id: deviceId });
}
async function setGpioLabel(deviceId, pinName, label) {
    return GpioLabel.findOneAndUpdate(
        { device_id: deviceId, pin_name: pinName },
        { label },
        { upsert: true, new: true }
    );
}

module.exports = {
    connect,
    getUserByEmail, getUserById, getUserByResetToken,
    createUser, setResetToken, updatePassword,
    upsertDevice, getDeviceByPairingCode, touchDevice, getDeviceById, updateDeviceName,
    getDeviceAccess, getDevicesByUser, pairDevice, unpairDevice, getDeviceUsers, inviteUserByEmail,
    getGpioLabels, setGpioLabel,
};
