const mongoose = require('mongoose');

// เชื่อมต่อ MongoDB
mongoose.connect(process.env.DATABASE_URL)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// --- วางโครงสร้างข้อมูล (Schemas) ---
const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password_hash: String,
    created_at: { type: Number, default: Date.now },
    reset_token: String,
    reset_expires: Number
});

const deviceSchema = new mongoose.Schema({
    device_id: { type: String, unique: true, required: true },
    name: String,
    pairing_code: String,
    last_seen: Number
});

const deviceUserSchema = new mongoose.Schema({
    user_id: mongoose.Schema.Types.ObjectId,
    device_id: String,
    role: String,
    joined_at: { type: Number, default: Date.now }
});

const gpioLabelSchema = new mongoose.Schema({
    device_id: String,
    pin_name: String,
    label: String
});

const User = mongoose.model('User', userSchema);
const Device = mongoose.model('Device', deviceSchema);
const DeviceUser = mongoose.model('DeviceUser', deviceUserSchema);
const GpioLabel = mongoose.model('GpioLabel', gpioLabelSchema);

module.exports = {
    // Users
    getUserByEmail: async (email) => await User.findOne({ email }),
    getUserById: async (id) => await User.findById(id),
    getUserByResetToken: async (token) => await User.findOne({ reset_token: token, reset_expires: { $gt: Date.now() } }),
    createUser: async (email, passwordHash) => {
        const user = new User({ email, password_hash: passwordHash });
        await user.save();
        return user._id; // ส่ง ID ของ MongoDB กลับไป
    },
    setResetToken: async (id, token, expires) => await User.findByIdAndUpdate(id, { reset_token: token, reset_expires: expires }),
    updatePassword: async (id, passwordHash) => await User.findByIdAndUpdate(id, { password_hash: passwordHash, reset_token: null, reset_expires: null }),

    // Devices
    upsertDevice: async (deviceId, name, pairingCode) => {
        await Device.findOneAndUpdate(
            { device_id: deviceId },
            { name: name || 'ESP32 Device', pairing_code: pairingCode, last_seen: Date.now() },
            { upsert: true }
        );
    },
    getDeviceByPairingCode: async (code) => await Device.findOne({ pairing_code: code }),
    touchDevice: async (deviceId) => await Device.findOneAndUpdate({ device_id: deviceId }, { last_seen: Date.now() }),
    getDeviceById: async (deviceId) => await Device.findOne({ device_id: deviceId }),
    updateDeviceName: async (deviceId, name) => await Device.findOneAndUpdate({ device_id: deviceId }, { name }),

    // Device-User
    getDeviceAccess: async (userId, deviceId) => await DeviceUser.findOne({ user_id: userId, device_id: deviceId }),
    getDevicesByUser: async (userId) => {
        const relations = await DeviceUser.find({ user_id: userId });
        const deviceIds = relations.map(r => r.device_id);
        const devices = await Device.find({ device_id: { $in: deviceIds } });
        return devices.map(d => {
            const rel = relations.find(r => r.device_id === d.device_id);
            return { ...d.toObject(), role: rel.role };
        });
    },
    pairDevice: async (userId, deviceId, role = 'owner') => {
        await new DeviceUser({ user_id: userId, device_id: deviceId, role }).save();
    },
    unpairDevice: async (userId, deviceId) => await DeviceUser.findOneAndDelete({ user_id: userId, device_id: deviceId }),

    // GPIO Labels
    getGpioLabels: async (deviceId) => await GpioLabel.find({ device_id: deviceId }),
    setGpioLabel: async (deviceId, pinName, label) => {
        await GpioLabel.findOneAndUpdate(
            { device_id: deviceId, pin_name: pinName },
            { label },
            { upsert: true }
        );
    }
};