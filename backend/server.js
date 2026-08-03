const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();

// CORS: يقبل الاتصالات من أي رابط افتراضياً.
// للتقييد، عيّن ALLOWED_ORIGINS في بيئة الاستضافة (مثال: https://your-app.vercel.app).
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS }
});

const DATA_FILE = path.join(__dirname, 'servers.json');
const WEBHOOK_FILE = path.join(__dirname, 'webhook.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const INCIDENT_FILE = path.join(__dirname, 'incidents.json');
const MONGODB_URI = process.env.MONGODB_URI || '';

// ----------------------------------------------------------
// سجل الاستجابة والنسبة والتخزين (Analytics & History)
// ----------------------------------------------------------
const LATENCY_HISTORY_LIMIT = 200;          // عدد نقاط سجل الاستجابة المحفوظة لكل سيرفر
const UPTIME_BUCKET_MS = 5 * 60 * 1000;     // كل مجموعة تمثل 5 دقائق
const UPTIME_WINDOW_MS = 24 * 60 * 60 * 1000; // نافذة الـ 24 ساعة
const INCIDENTS_LIMIT = 200;                // الحد الأقصى للحوادث المحفوظة

// ----------------------------------------------------------
// قاعدة البيانات السحابية الدائمة (MongoDB عبر Mongoose)
// ----------------------------------------------------------
const CONFIG_FIELDS = ['id', 'name', 'host', 'port', 'protocol', 'checkType', 'expectedStatus', 'region', 'lat', 'lng'];

const monitoredServerSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    host: { type: String, required: true },
    port: { type: Number, default: null },
    protocol: { type: String, default: 'http' },
    checkType: { type: String, default: 'http' },
    expectedStatus: { type: Number, default: null },
    region: { type: String, default: 'Unknown' },
    lat: { type: Number, default: 0 },
    lng: { type: Number, default: 0 }
}, { collection: 'servers' });

const webhookSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'main' },
    url: { type: String, default: '' }
}, { collection: 'settings' });

const ServerModel = mongoose.models.MonitoredServer || mongoose.model('MonitoredServer', monitoredServerSchema);
const WebhookModel = mongoose.models.WebhookSetting || mongoose.model('WebhookSetting', webhookSettingSchema);

// ----------------------------------------------------------
// نظام المصادقة والصلاحيات (JWT Auth & Roles)
// ----------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || 'nemvai_super_secret_change_me';
const JWT_EXPIRES = '12h';
const DEFAULT_ADMIN = { username: 'admin', password: 'adminpassword123', role: 'admin' };

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'viewer'], default: 'viewer' }
}, { collection: 'users' });

const UserModel = mongoose.models.NemvaiUser || mongoose.model('NemvaiUser', userSchema);

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// إنشاء حساب المسؤول الافتراضي عند بدء التشغيل إن لم يكن موجوداً
async function seedAdmin() {
    if (!isDbConnected) return;
    try {
        const existing = await UserModel.findOne({ username: DEFAULT_ADMIN.username });
        if (!existing) {
            const hash = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
            await UserModel.create({ username: DEFAULT_ADMIN.username, password: hash, role: DEFAULT_ADMIN.role });
            console.log('✅ تم إنشاء حساب المسؤول الافتراضي (admin).');
        }
    } catch (err) {
        console.error('⚠️ خطأ في إنشاء حساب المسؤول:', err.message);
    }
}

// التحقق من بيانات المستخدم (قاعدة البيانات أولاً، ثم Fallback محلي)
async function verifyUser(username, password) {
    if (isDbConnected) {
        try {
            const user = await UserModel.findOne({ username });
            if (user && await bcrypt.compare(password, user.password)) {
                return { username: user.username, role: user.role };
            }
        } catch (err) {
            console.error("⚠️ خطأ في التحقق من المستخدم:", err.message);
        }
    }
    if (username === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
        return { username: DEFAULT_ADMIN.username, role: DEFAULT_ADMIN.role };
    }
    return null;
}

let isDbConnected = false;

async function connectDatabase() {
    if (!MONGODB_URI) {
        console.log('⚠️ MONGODB_URI غير معرّف — سيتم استخدام ملفات servers.json/webhook.json كـ Fallback.');
        return false;
    }
    try {
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
        isDbConnected = true;
        console.log('✅ متصل بقاعدة البيانات السحابية MongoDB بنجاح.');
        return true;
    } catch (err) {
        console.error('❌ فشل الاتصال بـ MongoDB:', err.message);
        console.log('⚠️ سيتم استخدام الملفات المحلية كـ Fallback.');
        return false;
    }
}

// ----------------------------------------------------------
// طبقة التخزين: قاعدة البيانات أولاً، ثم الملفات كـ Fallback
// ----------------------------------------------------------
function sanitizeForFile(list) {
    return list.map(s => {
        const clean = {};
        CONFIG_FIELDS.forEach(f => { clean[f] = s[f]; });
        return clean;
    });
}

function readFileServers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
            if (Array.isArray(data)) {
                return data.map(s => ({
                    id: s.id,
                    name: s.name,
                    host: s.host || s.url || '',
                    port: s.port !== undefined ? s.port : null,
                    protocol: s.protocol || 'http',
                    checkType: s.checkType || (s.protocol === 'tcp' ? 'tcp' : 'http'),
                    expectedStatus: s.expectedStatus !== undefined ? s.expectedStatus : null,
                    region: s.region || "Unknown",
                    lat: s.lat,
                    lng: s.lng
                }));
            }
        }
    } catch (err) {
        console.error("⚠️ خطأ في قراءة servers.json:", err.message);
    }
    return [];
}

function writeFileServers(list) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(sanitizeForFile(list), null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("⚠️ خطأ في حفظ servers.json:", err.message);
        return false;
    }
}

function readFileWebhook() {
    try {
        if (fs.existsSync(WEBHOOK_FILE)) {
            const data = JSON.parse(fs.readFileSync(WEBHOOK_FILE, 'utf-8'));
            return (data && data.url) || '';
        }
    } catch (err) {
        console.error("⚠️ خطأ في قراءة webhook.json:", err.message);
    }
    return '';
}

function writeFileWebhook(url) {
    try {
        fs.writeFileSync(WEBHOOK_FILE, JSON.stringify({ url }, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("⚠️ خطأ في حفظ webhook.json:", err.message);
        return false;
    }
}

// ----------------------------------------------------------
// سجل الاستجابة الزمني (Latency History) — ملفات محلية
// ----------------------------------------------------------
function readFileLatencyHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
            return (data && typeof data === 'object') ? data : {};
        }
    } catch (err) {
        console.error("⚠️ خطأ في قراءة history.json:", err.message);
    }
    return {};
}

function writeFileLatencyHistory() {
    try {
        const map = {};
        realServers.forEach(s => {
            if (s.id !== undefined) {
                map[s.id] = {
                    latencyHistory: s.latencyHistory || [],
                    uptimeBuckets: s.uptimeBuckets || []
                };
            }
        });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(map, null, 2), 'utf-8');
    } catch (err) {
        console.error("⚠️ خطأ في حفظ history.json:", err.message);
    }
}

// ----------------------------------------------------------
// سجل الحوادث (Incident Log) — ملفات محلية
// ----------------------------------------------------------
function readFileIncidents() {
    try {
        if (fs.existsSync(INCIDENT_FILE)) {
            const data = JSON.parse(fs.readFileSync(INCIDENT_FILE, 'utf-8'));
            return Array.isArray(data) ? data : [];
        }
    } catch (err) {
        console.error("⚠️ خطأ في قراءة incidents.json:", err.message);
    }
    return [];
}

function writeFileIncidents() {
    try {
        fs.writeFileSync(INCIDENT_FILE, JSON.stringify(incidents.slice(0, INCIDENTS_LIMIT), null, 2), 'utf-8');
    } catch (err) {
        console.error("⚠️ خطأ في حفظ incidents.json:", err.message);
    }
}

let webhookUrl = '';
let incidents = [];

async function loadServers() {
    if (isDbConnected) {
        try {
            const count = await ServerModel.countDocuments();
            if (count > 0) {
                const docs = await ServerModel.find().lean();
                return docs.map(s => ({
                    id: s.id,
                    name: s.name,
                    host: s.host || s.url || '',
                    port: s.port !== undefined ? s.port : null,
                    protocol: s.protocol || 'http',
                    checkType: s.checkType || (s.protocol === 'tcp' ? 'tcp' : 'http'),
                    expectedStatus: s.expectedStatus !== undefined ? s.expectedStatus : null,
                    region: s.region || 'Unknown',
                    lat: s.lat,
                    lng: s.lng
                }));
            }
            // قاعدة البيانات فارغة → استيراد الملف الافتراضي إن وُجد
            const seed = readFileServers();
            if (seed.length > 0) {
                await ServerModel.insertMany(seed.map(s => ({
                    id: s.id,
                    name: s.name,
                    host: s.host,
                    port: s.port !== undefined ? s.port : null,
                    protocol: s.protocol || 'http',
                    checkType: s.checkType || (s.protocol === 'tcp' ? 'tcp' : 'http'),
                    expectedStatus: s.expectedStatus !== undefined ? s.expectedStatus : null,
                    region: s.region,
                    lat: s.lat,
                    lng: s.lng
                })));
                console.log('✅ تم استيراد السيرفرات الافتراضية إلى قاعدة البيانات.');
                return seed;
            }
            return [];
        } catch (err) {
            console.error("⚠️ خطأ في قراءة السيرفرات من قاعدة البيانات:", err.message);
        }
    }
    return readFileServers();
}

async function saveServers(list) {
    if (isDbConnected) {
        try {
            await ServerModel.deleteMany({});
            await ServerModel.insertMany(list.map(s => ({
                id: s.id,
                name: s.name,
                host: s.host,
                port: s.port !== undefined ? s.port : null,
                protocol: s.protocol || 'http',
                checkType: s.checkType || (s.protocol === 'tcp' ? 'tcp' : 'http'),
                expectedStatus: s.expectedStatus !== undefined ? s.expectedStatus : null,
                region: s.region,
                lat: s.lat,
                lng: s.lng
            })));
            return true;
        } catch (err) {
            console.error("⚠️ فشل الحفظ في قاعدة البيانات، استخدام الملف كـ Fallback:", err.message);
        }
    }
    return writeFileServers(list);
}

async function loadWebhook() {
    if (isDbConnected) {
        try {
            const doc = await WebhookModel.findOne({ key: 'main' }).lean();
            if (doc) {
                webhookUrl = doc.url || '';
                return;
            }
        } catch (err) {
            console.error("⚠️ خطأ في قراءة الـ Webhook من قاعدة البيانات:", err.message);
        }
    }
    webhookUrl = readFileWebhook();
}

async function saveWebhookToFile(url) {
    if (isDbConnected) {
        try {
            await WebhookModel.findOneAndUpdate(
                { key: 'main' },
                { key: 'main', url },
                { upsert: true, setDefaultsOnInsert: true }
            );
            webhookUrl = url;
            return true;
        } catch (err) {
            console.error("⚠️ فشل الحفظ في قاعدة البيانات، استخدام الملف كـ Fallback:", err.message);
        }
    }
    if (writeFileWebhook(url)) {
        webhookUrl = url;
        return true;
    }
    return false;
}

let realServers = [];

// ----------------------------------------------------------
// قياس استهلاك CPU الحقيقي للسيرفر المضيف (عبر os)
// يحسب نسبة الاستخدام بين عينتين زمنيتين متتاليتين
// ----------------------------------------------------------
let lastCpuTimes = os.cpus().map(c => c.times);

function getCpuUsage() {
    const cpus = os.cpus();
    if (cpus.length === 0) return 0;

    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu, i) => {
        const prev = lastCpuTimes[i] || cpu.times;
        const idle = cpu.times.idle - prev.idle;
        const total = (cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq) -
                      (prev.user + prev.nice + prev.sys + prev.idle + prev.irq);
        totalIdle += idle;
        totalTick += total;
    });

    lastCpuTimes = cpus.map(c => c.times);

    if (totalTick <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(((totalTick - totalIdle) / totalTick) * 100)));
}

// ----------------------------------------------------------
// قياس استهلاك الذاكرة الحقيقي للسيرفر المضيف (عبر os)
// ----------------------------------------------------------
function getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
        total,
        free,
        used,
        percent: total > 0 ? Math.round((used / total) * 100) : 0
    };
}

// ----------------------------------------------------------
// فحص السيرفرات + بث النتائج للواجهة
// ----------------------------------------------------------
function buildUrl(host) {
    if (!host) return null;
    const h = String(host).trim();
    if (!h) return null;
    return /^https?:\/\//i.test(h) ? h : 'https://' + h;
}

// ----------------------------------------------------------
// فحص منفذ TCP عبر net.Socket مع قياس زمن الاستجابة (Latency)
// ----------------------------------------------------------
function checkTcpPort(host, port, timeout = 3000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();
        let settled = false;

        const done = (ok, latency) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve({ ok, latency });
        };

        socket.setTimeout(timeout);
        socket.once('connect', () => done(true, Date.now() - start));
        socket.once('timeout', () => done(false, 0));
        socket.once('error', () => done(false, 0));

        socket.connect(port, host);
    });
}

// ----------------------------------------------------------
// فحص HTTP/HTTPS: كود الاستجابة (Status Code) + زمن الاستجابة
// يعيد الحالة والكود الفعلي. عند تعيين expectedStatus يتم مقارنته.
// ----------------------------------------------------------
async function checkServerHttp(s) {
    const url = buildUrl(s.host);
    if (!url) return { ok: false, latency: 0, statusCode: null };
    const start = Date.now();
    try {
        const resp = await axios.get(url, {
            timeout: 3000,
            maxRedirects: 5,
            validateStatus: () => true
        });
        const statusCode = resp.status;
        const expected = s.expectedStatus ? Number(s.expectedStatus) : null;
        const ok = expected ? statusCode === expected : statusCode < 500;
        return { ok, latency: Date.now() - start, statusCode };
    } catch (error) {
        return { ok: false, latency: 0, statusCode: error.response ? error.response.status : null };
    }
}

// ----------------------------------------------------------
// فحص شهادة SSL عبر اتصال TLS مباشر
// يرجع مدى صلاحية الشهادة وعدد الأيام المتبقية حتى الانتهاء
// عند فشل الاتصال يرجع checked:false (تعذر الفحص) بدون اعتباره عطلاً
// ----------------------------------------------------------
function checkSslCertificate(host, port = 443, timeout = 3000) {
    return new Promise((resolve) => {
        let settled = false;
        let socket = null;

        const done = (res) => {
            if (settled) return;
            settled = true;
            if (socket) socket.destroy();
            resolve(res);
        };

        try {
            socket = tls.connect({
                host,
                port,
                servername: host,
                rejectUnauthorized: false,
                timeout
            }, () => {
                const cert = socket.getPeerCertificate();
                if (cert && cert.valid_to) {
                    const daysLeft = Math.max(0, Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000));
                    done({
                        checked: true,
                        valid: !!socket.authorized,
                        expiresIn: daysLeft,
                        expiresAt: cert.valid_to,
                        issuer: cert.issuer ? (cert.issuer.O || 'Unknown') : 'Unknown'
                    });
                } else {
                    done({ checked: true, valid: false, expiresIn: 0, expiresAt: null, issuer: 'Unknown' });
                }
            });
            socket.on('error', () => done({ checked: false, valid: null, expiresIn: null, expiresAt: null, issuer: null }));
            socket.on('timeout', () => done({ checked: false, valid: null, expiresIn: null, expiresAt: null, issuer: null }));
        } catch (err) {
            done({ checked: false, valid: null, expiresIn: null, expiresAt: null, issuer: null });
        }
    });
}

// ----------------------------------------------------------
// سجل الأداء + حساب نسبة الاستقرار (Uptime %)
// يحتفظ بآخر 20 قراءة لكل سيرفر ويحسب النسبة من السجل
// ----------------------------------------------------------
const HISTORY_LIMIT = 20;

function computeUptime(history) {
    if (!history || history.length === 0) return 100;
    const upCount = history.filter(h => h.up).length;
    return Math.round((upCount / history.length) * 1000) / 10;
}

// ----------------------------------------------------------
// حساب نسبة التشغيل خلال آخر 24 ساعة من مجموعات Uptime
// كل مجموعة تمثل 5 دقائق وتحتوي عدد الفحوصات الناجحة
// ----------------------------------------------------------
function computeUptime24h(uptimeBuckets) {
    const now = Date.now();
    const recent = (uptimeBuckets || []).filter(b => (now - ((b.t || 0) || (b.i * UPTIME_BUCKET_MS))) <= UPTIME_WINDOW_MS && (b.total || 0) > 0);
    if (recent.length === 0) return 100;
    const total = recent.reduce((a, b) => a + (b.total || 0), 0);
    const up = recent.reduce((a, b) => a + (b.up || 0), 0);
    if (total <= 0) return 100;
    return Math.round((up / total) * 1000) / 10;
}

// ----------------------------------------------------------
// تسجيل انقطاع في سجل الحوادث (بداية العطل)
// ----------------------------------------------------------
function openIncident(s, reason) {
    const incident = {
        id: Date.now(),
        serverId: s.id,
        serverName: s.name,
        host: s.host,
        checkType: s.checkType || (s.protocol === 'tcp' ? 'tcp' : 'http'),
        reason: reason || 'انقطاع الاتصال',
        startedAt: Date.now(),
        recoveredAt: null,
        durationMs: null,
        status: 'down'
    };
    incidents.unshift(incident);
    if (incidents.length > INCIDENTS_LIMIT) incidents.length = INCIDENTS_LIMIT;
    writeFileIncidents();
    io.emit('incidents_update', incidents);
    console.log(`🚨 حادثة جديدة: ${s.name} — ${incident.reason}`);
}

// ----------------------------------------------------------
// إغلاق الحادثة عند عودة السيرفر للعمل
// ----------------------------------------------------------
function closeIncident(s) {
    const incident = incidents.find(i => i.serverId === s.id && !i.recoveredAt);
    if (!incident) return;
    incident.recoveredAt = Date.now();
    incident.durationMs = incident.recoveredAt - incident.startedAt;
    incident.status = 'recovered';
    writeFileIncidents();
    io.emit('incidents_update', incidents);
    console.log(`✅ عودة السيرفر للعمل: ${s.name} — مدة الانقطاع ${Math.round(incident.durationMs / 1000)}ث`);
}

// ----------------------------------------------------------
// مُحلل التنبؤ الذكي (AI Anomaly Detection)
// يفحص تذبذب الـ Ping وارتفاع الأحمال المتتالية
// ----------------------------------------------------------
const CPU_HIGH_THRESHOLD = 80;
const CPU_HIGH_STREAK = 3;
const PING_ABSOLUTE_MS = 300;
const PING_BASELINE_FACTOR = 2.0;
const PING_SPIKE_STREAK = 2;
const PREDICTIVE_COOLDOWN_MS = 60000;

function analyzeAnomaly(s) {
    const hist = s.history || [];
    if (hist.length < 3) return null;

    const pings = hist.map(h => h.ping).filter(p => p > 0);
    if (pings.length < 2) return null;
    const baseline = pings.reduce((a, b) => a + b, 0) / pings.length;

    // تنبيه ارتفاع حمل CPU لثلاث فحوصات متتالية
    if (s.cpu >= CPU_HIGH_THRESHOLD) {
        s.cpuHighStreak = (s.cpuHighStreak || 0) + 1;
    } else {
        s.cpuHighStreak = 0;
    }
    if (s.cpuHighStreak >= CPU_HIGH_STREAK && (Date.now() - (s.lastCpuAlertAt || 0)) > PREDICTIVE_COOLDOWN_MS) {
        s.lastCpuAlertAt = Date.now();
        return {
            type: 'cpu',
            message: `ارتفاع حمل CPU غير طبيعي (${s.cpu}%) لثلاث فحوصات متتالية على ${s.name}.`,
            latency: s.latency,
            cpu: s.cpu
        };
    }

    // تنبيه تذبذب الـ Ping (فوق العتبة + انحراف عن خط الأساس)
    const lastPing = s.latency;
    if (lastPing > 0 && lastPing > PING_ABSOLUTE_MS && lastPing > baseline * PING_BASELINE_FACTOR) {
        s.pingSpikeStreak = (s.pingSpikeStreak || 0) + 1;
    } else {
        s.pingSpikeStreak = 0;
    }
    if (s.pingSpikeStreak >= PING_SPIKE_STREAK && (Date.now() - (s.lastPingAlertAt || 0)) > PREDICTIVE_COOLDOWN_MS) {
        s.lastPingAlertAt = Date.now();
        return {
            type: 'ping',
            message: `تذبذب Ping غير طبيعي على ${s.name}: ${lastPing}ms مقابل متوسط ${Math.round(baseline)}ms.`,
            latency: lastPing,
            cpu: s.cpu
        };
    }

    return null;
}

async function sendPredictiveAlert(s, alert) {
    if (!webhookUrl) return;
    const payload = {
        embeds: [{
            title: "⚠️ Predictive Alert",
            color: 16761024,
            description: alert.message,
            fields: [
                { name: "السيرفر", value: s.name, inline: true },
                { name: "النوع", value: alert.type === 'cpu' ? "ارتفاع حمل CPU" : "تذبذب Ping", inline: true },
                { name: "زمن الاستجابة", value: `${s.latency} ms`, inline: true }
            ],
            footer: { text: "Nemvai Monitoring System v9.0" },
            timestamp: new Date().toISOString()
        }]
    };
    try {
        await axios.post(webhookUrl, payload);
        console.log(`⚠️ تم إرسال تنبيه تنبؤي: ${s.name}`);
    } catch (err) {
        console.error("❌ فشل إرسال التنبيه التنبؤي:", err.message);
    }
}

// ----------------------------------------------------------
// إرسال إشعار Discord Webhook عند تغير حالة السيرفر
// ----------------------------------------------------------
const EMBED_COLORS = { down: 15548997, up: 3066993 };

async function sendWebhookNotification(serverName, status, latency, prevStatus) {
    if (!webhookUrl) return;
    const isDown = status === 'down';
    const payload = {
        embeds: [{
            title: isDown ? `🚨 DOWN: ${serverName}` : `✅ UP: ${serverName}`,
            color: isDown ? EMBED_COLORS.down : EMBED_COLORS.up,
            description: isDown
                ? `الخادم **${serverName}** لم يعد يستجيب!`
                : `الخادم **${serverName}** عاد للعمل بنجاح!`,
            fields: [
                { name: "السيرفر", value: serverName, inline: true },
                { name: "الحالة", value: isDown ? "🔴 عطل (Down)" : "🟢 شغال (Operational)", inline: true },
                { name: "زمن الاستجابة", value: `${latency} ms`, inline: true },
                { name: "الحالة السابقة", value: prevStatus === 'down' ? "🔴 عطل" : "🟢 شغال", inline: true }
            ],
            footer: { text: "Nemvai Monitoring System v9.0" },
            timestamp: new Date().toISOString()
        }]
    };
    try {
        await axios.post(webhookUrl, payload);
        console.log(`📣 تم إرسال Webhook: ${serverName} -> ${status}`);
    } catch (err) {
        console.error("❌ فشل إرسال Webhook:", err.message);
    }
}

const STRESS_DURATION_MS = 60000;

async function checkServers() {
    const hostCpu = getCpuUsage();
    const hostMemory = getMemoryUsage();
    const now = Date.now();

    for (let s of realServers) {
        const prevStatus = s.status;

        // محاكاة الضغط النشطة (down / high_load) للاختبار
        if (s.stress && s.stress.until > now) {
            if (s.stress.type === 'down') {
                s.status = 'down';
                s.latency = 0;
                s.cpu = 99;
                s.memory = 95;
                s.lastReason = 'محاكاة عطل مفاجئ (Simulation)';
            } else {
                s.status = 'operational';
                s.latency = Math.max(s.latency || 50, 600);
                s.cpu = 96;
                s.memory = 92;
            }
        } else {
            if (s.stress && s.stress.until <= now) {
                delete s.stress;
            }
            // فحص حسب نوع الفحص المحدد للسيرفر (tcp / http / ping)
            const checkType = s.checkType || (s.protocol === 'tcp' ? 'tcp' : 'http');

            if (checkType === 'tcp') {
                // فحص منفذ TCP: اتصال مباشر بالمنفذ المحدد
                const result = await checkTcpPort(s.host, s.port, 3000);
                s.status = result.ok ? 'operational' : 'down';
                s.latency = result.ok ? result.latency : 0;
                s.statusCode = null;
                s.sslValid = null;
                s.sslExpiresIn = null;
                s.sslIssuer = null;
                if (!result.ok) s.lastReason = `تعذر الاتصال بالمنفذ ${s.port} (TCP Timeout / RST)`;
            } else if (checkType === 'http') {
                // فحص HTTP/HTTPS: كود الاستجابة + شهادة SSL (إن كانت https)
                const check = await checkServerHttp(s);
                s.status = check.ok ? 'operational' : 'down';
                s.latency = check.ok ? check.latency : 0;
                s.statusCode = check.statusCode;
                if (!check.ok) {
                    const expected = s.expectedStatus ? ` بدلاً من ${s.expectedStatus}` : '';
                    s.lastReason = check.statusCode
                        ? `كود استجابة غير متوقع (${check.statusCode}${expected})`
                        : 'انقطاع الاتصال HTTP (Timeout / DNS)';
                }

                const url = buildUrl(s.host) || '';
                const isHttps = /^https:/i.test(url);
                if (isHttps) {
                    const ssl = await checkSslCertificate(s.host, s.port || 443);
                    s.sslChecked = ssl.checked;
                    s.sslValid = ssl.valid;
                    s.sslExpiresIn = ssl.expiresIn;
                    s.sslIssuer = ssl.issuer;
                    // شهادة SSL تم فحصها فعلاً وغير موثوقة/منتهية → نعتبر السيرفر متعطلاً
                    if (s.status === 'operational' && ssl.checked && !ssl.valid) {
                        s.status = 'down';
                        s.latency = 0;
                        s.lastReason = 'شهادة SSL غير صالحة أو منتهية';
                    }
                } else {
                    s.sslChecked = false;
                    s.sslValid = null;
                    s.sslExpiresIn = null;
                    s.sslIssuer = null;
                }
            } else {
                // فحص Ping: قياس زمن الاستجابة البسيط عبر axios
                const url = buildUrl(s.host);
                if (!url) {
                    s.status = 'down';
                    s.latency = 0;
                    s.lastReason = 'عنوان غير صالح (Host فارغ)';
                } else {
                    const start = Date.now();
                    try {
                        await axios.get(url, { timeout: 3000 });
                        s.status = 'operational';
                        s.latency = Date.now() - start;
                    } catch (error) {
                        s.status = 'down';
                        s.latency = 0;
                        s.lastReason = 'انقطاع الاتصال (Ping Timeout / DNS)';
                    }
                }
                s.statusCode = null;
                s.sslValid = null;
                s.sslExpiresIn = null;
                s.sslIssuer = null;
            }
            s.cpu = hostCpu;
            s.memory = hostMemory.percent;
            s.ram = {
                usedMB: Math.round(hostMemory.used / 1024 / 1024),
                totalMB: Math.round(hostMemory.total / 1024 / 1024),
                percent: hostMemory.percent
            };
        }

        // إرسال إشعار Discord عند تغير الحالة (operational <-> down)
        if (prevStatus && prevStatus !== s.status) {
            sendWebhookNotification(s.name, s.status, s.latency, prevStatus);
        }

        // سجل الحوادث: تسجيل بداية الانقطاع وعودة السيرفر
        if (prevStatus && prevStatus !== s.status) {
            if (s.status === 'down') {
                openIncident(s, s.lastReason);
            } else if (prevStatus === 'down' && s.status === 'operational') {
                closeIncident(s);
            }
        }

        // تسجيل القراءة في سجل الأداء (آخر 20 قراءة للتحليل التنبؤي)
        const reading = {
            t: Date.now(),
            ping: s.latency,
            cpu: s.cpu,
            ram: s.memory,
            up: s.status === 'operational'
        };
        if (!s.history) s.history = [];
        s.history.push(reading);
        if (s.history.length > HISTORY_LIMIT) s.history.shift();

        // سجل الاستجابة الزمني (Latency History) للرسوم البيانية
        if (!s.latencyHistory) s.latencyHistory = [];
        s.latencyHistory.push({ t: Date.now(), ping: s.latency });
        if (s.latencyHistory.length > LATENCY_HISTORY_LIMIT) s.latencyHistory.shift();

        // مجموعات Uptime (كل 5 دقائق) لحساب نسبة التشغيل خلال 24 ساعة
        const bucketIndex = Math.floor(Date.now() / UPTIME_BUCKET_MS);
        if (!s.uptimeBuckets) s.uptimeBuckets = [];
        let bucket = s.uptimeBuckets.find(b => b.i === bucketIndex);
        if (!bucket) {
            bucket = { i: bucketIndex, up: 0, total: 0 };
            s.uptimeBuckets.push(bucket);
            // تجاهل المجموعات الأقدم من 24 ساعة
            s.uptimeBuckets = s.uptimeBuckets.filter(b => bucketIndex - b.i <= (UPTIME_WINDOW_MS / UPTIME_BUCKET_MS));
        }
        bucket.total++;
        if (s.status === 'operational') bucket.up++;

        // نسبة التشغيل خلال آخر 24 ساعة
        s.uptimePercentage = computeUptime24h(s.uptimeBuckets);

        // التحليل التنبؤي الذكي وإرسال تنبيه مبكر إن لزم
        const alert = analyzeAnomaly(s);
        if (alert) {
            alert.serverId = s.id;
            alert.serverName = s.name;
            alert.time = Date.now();
            io.emit('predictive_alert', alert);
            sendPredictiveAlert(s, alert);
        }
    }

    // حفظ سجل الاستجابة على فترات
    writeFileLatencyHistory();

    // إرسال النتيجة الحقيقية فوراً للواجهة عبر Socket.IO
    io.emit('server_updates', realServers);
    io.emit('host_metrics', { cpu: hostCpu, memory: hostMemory });
}

// تشغيل الفحص تلقائياً كل 5 ثوانٍ
setInterval(checkServers, 5000);

// ----------------------------------------------------------
// أحداث Socket.IO لإدارة السيرفرات والـ Webhook
// ----------------------------------------------------------
io.on('connection', (socket) => {
    console.log("🟢 عميل متصل:", socket.id);

    // مصادقة عبر Token من خيارات الاتصال (إن وُجد)
    socket.user = null;
    if (socket.handshake.auth && socket.handshake.auth.token) {
        const payload = verifyToken(socket.handshake.auth.token);
        if (payload) socket.user = { username: payload.username, role: payload.role };
    }
    socket.emit('auth_status', {
        authenticated: !!socket.user,
        role: socket.user ? socket.user.role : 'viewer',
        username: socket.user ? socket.user.username : null
    });
    socket.emit('webhook_status', { configured: !!webhookUrl, url: webhookUrl });
    socket.emit('incidents_update', incidents);

    // طلب سجل الحوادث (Incident Log)
    socket.on('get_incidents', () => {
        socket.emit('incidents_update', incidents);
    });

    // تسجيل الدخول/الخروج داخل الجلسة (إعادة المصادقة)
    socket.on('authenticate', (token) => {
        const payload = verifyToken(String(token || ''));
        if (payload) {
            socket.user = { username: payload.username, role: payload.role };
            socket.emit('auth_status', { authenticated: true, role: socket.user.role, username: socket.user.username });
        } else {
            socket.user = null;
            socket.emit('auth_status', { authenticated: false, role: 'viewer', username: null });
        }
    });

    function isAdmin() {
        return socket.user && socket.user.role === 'admin';
    }
    function denyAdmin() {
        socket.emit('server_action_result', { ok: false, message: "⛔ صلاحيات غير كافية: يتطلب تسجيل الدخول كـ Admin." });
    }

    // إضافة سيرفر جديد (Admin فقط)
    socket.on('add_server', async (data) => {
        if (!isAdmin()) return denyAdmin();
        const { name, host, region, lat, lng, port, protocol, checkType, expectedStatus } = data || {};
        if (!name || !host) {
            socket.emit('server_action_result', { ok: false, message: "⚠️ يجب إدخال اسم السيرفر والعنوان (Host/IP)." });
            return;
        }
        const normCheck = checkType || (protocol === 'tcp' ? 'tcp' : 'http');
        const newServer = {
            id: Date.now(),
            name: String(name),
            host: String(host),
            port: port !== undefined && port !== null && port !== '' ? Number(port) : null,
            protocol: normCheck === 'tcp' ? 'tcp' : 'http',
            checkType: normCheck,
            expectedStatus: normCheck === 'http' && expectedStatus ? Number(expectedStatus) : null,
            region: region || "Unknown",
            lat: parseFloat(lat) || 0,
            lng: parseFloat(lng) || 0,
            status: 'operational',
            cpu: 0,
            latency: 0,
            history: [],
            latencyHistory: [],
            uptimeBuckets: [],
            uptimePercentage: 100
        };
        if (normCheck === 'tcp' && !newServer.port) {
            socket.emit('server_action_result', { ok: false, message: "⚠️ يجب تحديد المنفذ (Port) عند اختيار فحص TCP." });
            return;
        }
        realServers.push(newServer);
        if (await saveServers(realServers)) {
            socket.emit('server_action_result', { ok: true, message: `✅ تمت إضافة السيرفر (${newServer.name}) وحفظه في قاعدة البيانات.` });
            io.emit('server_updates', realServers);
            checkServers();
        } else {
            realServers.pop();
            socket.emit('server_action_result', { ok: false, message: "❌ فشل حفظ السيرفر في قاعدة البيانات." });
        }
    });

    // حذف سيرفر موجود (Admin فقط)
    socket.on('delete_server', async (id) => {
        if (!isAdmin()) return denyAdmin();
        const numId = Number(id);
        const index = realServers.findIndex(s => s.id === numId);
        if (index === -1) {
            socket.emit('server_action_result', { ok: false, message: "❌ السيرفر غير موجود." });
            return;
        }
        const removed = realServers.splice(index, 1)[0];
        if (await saveServers(realServers)) {
            socket.emit('server_action_result', { ok: true, message: `🗑️ تم حذف السيرفر (${removed.name}) وتحديث قاعدة البيانات.` });
            io.emit('server_updates', realServers);
        } else {
            realServers.splice(index, 0, removed);
            socket.emit('server_action_result', { ok: false, message: "❌ فشل حفظ التعديلات في قاعدة البيانات." });
        }
    });

    // محاكاة الضغط لاختبار التنبيهات (Admin فقط)
    socket.on('simulate_stress', (data) => {
        if (!isAdmin()) return denyAdmin();
        const { serverId, type } = data || {};
        const s = realServers.find(x => x.id === Number(serverId));
        if (!s) {
            socket.emit('server_action_result', { ok: false, message: "❌ السيرفر غير موجود." });
            return;
        }
        if (type !== 'down' && type !== 'high_load') {
            socket.emit('server_action_result', { ok: false, message: "⚠️ نوع المحاكاة يجب أن يكون down أو high_load." });
            return;
        }
        s.stress = { type, until: Date.now() + STRESS_DURATION_MS };
        socket.emit('server_action_result', { ok: true, message: `🧪 تم تشغيل محاكاة (${type === 'down' ? 'عطل مفاجئ' : 'ضغط عالي'}) على ${s.name} لمدة 60 ثانية.` });
        io.emit('server_updates', realServers);
    });

    // حفظ رابط الـ Webhook (Admin فقط)
    socket.on('save_webhook', async (url) => {
        if (!isAdmin()) return denyAdmin();
        const clean = String(url || '').trim();
        if (!clean) {
            socket.emit('webhook_result', { ok: false, message: "⚠️ أدخل رابط Webhook صحيح." });
            return;
        }
        if (await saveWebhookToFile(clean)) {
            socket.emit('webhook_result', { ok: true, message: "✅ تم حفظ رابط الـ Discord Webhook في قاعدة البيانات." });
            io.emit('webhook_status', { configured: true, url: clean });
        } else {
            socket.emit('webhook_result', { ok: false, message: "❌ فشل حفظ الرابط في قاعدة البيانات." });
        }
    });

    // إرسال رسالة اختبار للـ Webhook
    socket.on('test_webhook', async () => {
        if (!webhookUrl) {
            socket.emit('webhook_result', { ok: false, message: "⚠️ لا يوجد Webhook مضبوط. احفظ الرابط أولاً." });
            return;
        }
        try {
            await axios.post(webhookUrl, {
                content: "✅ **اختبار ناجح!** إشعارات Discord تعمل بشكل صحيح على نظام Nemvai v9.0."
            });
            socket.emit('webhook_result', { ok: true, message: "✅ تم إرسال رسالة الاختبار إلى Discord بنجاح." });
        } catch (err) {
            socket.emit('webhook_result', { ok: false, message: `❌ فشل إرسال الاختبار: ${err.message}` });
        }
    });

    // طلب حالة الـ Webhook الحالية
    socket.on('get_webhook', () => {
        socket.emit('webhook_status', { configured: !!webhookUrl, url: webhookUrl });
    });

    socket.on('disconnect', () => {
        console.log("🔴 عميل انقطع:", socket.id);
    });
});

// ----------------------------------------------------------
// REST endpoints لإدارة السيرفرات والـ Webhook
// ----------------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, message: "username و password مطلوبان." });
    const user = await verifyUser(String(username), String(password));
    if (!user) return res.status(401).json({ ok: false, message: "بيانات الدخول غير صحيحة." });
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ ok: true, token, username: user.username, role: user.role });
});

// حماية النقاط الحساسة: يشترط إرسال Authorization: Bearer <token> لحساب Admin
function adminRequired(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
        return res.status(401).json({ ok: false, message: "⛔ صلاحيات غير كافية: يتطلب تسجيل الدخول كـ Admin." });
    }
    next();
}

app.get('/servers', (req, res) => res.json(realServers));

app.post('/servers', adminRequired, async (req, res) => {
    const { name, host, region, lat, lng, port, protocol, checkType, expectedStatus } = req.body || {};
    if (!name || !host) return res.status(400).json({ ok: false, message: "name و host مطلوبان." });
    const normCheck = checkType || (protocol === 'tcp' ? 'tcp' : 'http');
    const newServer = {
        id: Date.now(),
        name: String(name),
        host: String(host),
        port: port !== undefined && port !== null && port !== '' ? Number(port) : null,
        protocol: normCheck === 'tcp' ? 'tcp' : 'http',
        checkType: normCheck,
        expectedStatus: normCheck === 'http' && expectedStatus ? Number(expectedStatus) : null,
        region: region || "Unknown",
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        status: 'operational',
        cpu: 0,
        latency: 0,
        history: [],
        latencyHistory: [],
        uptimeBuckets: [],
        uptimePercentage: 100
    };
    if (normCheck === 'tcp' && !newServer.port) {
        return res.status(400).json({ ok: false, message: "يجب تحديد المنفذ (Port) عند اختيار فحص TCP." });
    }
    realServers.push(newServer);
    if (await saveServers(realServers)) {
        io.emit('server_updates', realServers);
        res.json({ ok: true, server: newServer });
    } else {
        realServers.pop();
        res.status(500).json({ ok: false, message: "فشل حفظ السيرفر في قاعدة البيانات." });
    }
});

app.delete('/servers/:id', adminRequired, async (req, res) => {
    const numId = Number(req.params.id);
    const index = realServers.findIndex(s => s.id === numId);
    if (index === -1) return res.status(404).json({ ok: false, message: "السيرفر غير موجود." });
    const removed = realServers.splice(index, 1)[0];
    if (await saveServers(realServers)) {
        io.emit('server_updates', realServers);
        res.json({ ok: true, server: removed });
    } else {
        realServers.splice(index, 0, removed);
        res.status(500).json({ ok: false, message: "فشل حفظ التعديلات في قاعدة البيانات." });
    }
});

app.get('/webhook', (req, res) => res.json({ url: webhookUrl, configured: !!webhookUrl }));

app.post('/webhook', adminRequired, async (req, res) => {
    const url = String((req.body || {}).url || '').trim();
    if (!url) return res.status(400).json({ ok: false, message: "url مطلوب." });
    if (await saveWebhookToFile(url)) {
        io.emit('webhook_status', { configured: true, url });
        res.json({ ok: true, url });
    } else {
        res.status(500).json({ ok: false, message: "فشل حفظ الرابط." });
    }
});

app.post('/webhook/test', adminRequired, async (req, res) => {
    if (!webhookUrl) return res.status(400).json({ ok: false, message: "لا يوجد Webhook مضبوط." });
    try {
        await axios.post(webhookUrl, {
            content: "✅ **اختبار ناجح!** إشعارات Discord تعمل بشكل صحيح."
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ----------------------------------------------------------
// سجل الحوادث (Incident Log) — REST
// ----------------------------------------------------------
app.get('/api/incidents', (req, res) => res.json(incidents));

app.delete('/api/incidents', adminRequired, async (req, res) => {
    incidents = [];
    writeFileIncidents();
    io.emit('incidents_update', incidents);
    res.json({ ok: true, message: "تم مسح سجل الحوادث." });
});

// سجل الاستجابة الزمني (Latency History) — REST للتصدير
app.get('/api/history', (req, res) => {
    const map = {};
    realServers.forEach(s => {
        map[s.id] = {
            name: s.name,
            latencyHistory: s.latencyHistory || [],
            uptimePercentage: s.uptimePercentage
        };
    });
    res.json(map);
});

const PORT = process.env.PORT || 4000;

async function startServer() {
    await connectDatabase();
    await seedAdmin();
    await loadWebhook();
    realServers = await loadServers();
    incidents = readFileIncidents();

    // استعادة سجل الاستجابة والمجموعات السابقة إن وُجدت
    const hist = readFileLatencyHistory();
    realServers.forEach(s => {
        if (hist[s.id]) {
            s.latencyHistory = hist[s.id].latencyHistory || [];
            s.uptimeBuckets = hist[s.id].uptimeBuckets || [];
            if (s.uptimeBuckets.length > 0) s.uptimePercentage = computeUptime24h(s.uptimeBuckets);
        }
    });

    server.listen(PORT, () => {
        console.log(`✅ Nemvai Monitoring System يعمل بنجاح على المنفذ ${PORT}! (v9.0 Analytics & History)`);
    });
}

startServer();
