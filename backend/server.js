const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// تحميل متغيرات البيئة المحلية (backend/.env)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// ----------------------------------------------------------
// الأمان: CORS مقيد + Helmet + Rate Limiting + تنظيف المدخلات
// ----------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
    // Render يعتمد على X-Forwarded-For لحساب IP العميل بشكل صحيح (مطلوب لـ Rate Limit)
    app.set('trust proxy', 1);
}

// CORS: في الإنتاج يُقبل فقط نطاق التطبيق الأمامي (Vercel) ما لم تُحدد ALLOWED_ORIGINS يدوياً.
const DEFAULT_PROD_ORIGIN = 'https://server-status-dashboard-six.vercel.app';
const allowedRaw = process.env.ALLOWED_ORIGINS || (process.env.NODE_ENV === 'production' ? DEFAULT_PROD_ORIGIN : '*');
const allowedOrigins = allowedRaw.split(',').map(s => String(s).trim()).filter(Boolean);
const isWildcard = allowedOrigins.includes('*');

app.use(cors({
    origin: (origin, cb) => {
        if (isWildcard || !origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(helmet({ crossOriginResourcePolicy: false }));

// قيود عدد الطلبات (Rate Limiting)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,       // 15 دقيقة
    max: 100,                        // أقصى 100 طلب لكل IP
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/webhooks/paddle', // الـ Webhook يأتي من سيرفرات Paddle وقد يتجاوز حد الطلبات من نفس الـ IP
    message: { ok: false, message: "⛔ تجاوزت حد الطلبات المسموح — حاول مرة أخرى بعد 15 دقيقة." }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,                         // أقصى 20 محاولة دخول/تسجيل لكل IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: "⛔ محاولات كثيرة — حاول مرة أخرى بعد 15 دقيقة." }
});

app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/login', authLimiter);
app.use('/api', apiLimiter);

// verify: نحتفظ بالجسم الخام (raw body) للتحقق من توقيع Webhook الخاص بـ Paddle
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// تنظيف مفاتيح المدخلات من رموز NoSQL Injection ($ و .) في body/query/params
function sanitizeForMongo(input) {
    if (Array.isArray(input)) return input.map(sanitizeForMongo);
    if (input && typeof input === 'object') {
        const out = {};
        for (const key of Object.keys(input)) {
            out[key.replace(/^\$+/g, '').replace(/\./g, '_')] = sanitizeForMongo(input[key]);
        }
        return out;
    }
    return input;
}
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') req.body = sanitizeForMongo(req.body);
    try {
        const q = req.query;
        if (q && typeof q === 'object' && Object.keys(q).length) {
            Object.defineProperty(req, 'query', { value: sanitizeForMongo(q), writable: true, configurable: true, enumerable: true });
        }
    } catch (_) { /* req.query قد يكون للقراءة فقط في بعض ظروف Express */ }
    if (req.params && typeof req.params === 'object') req.params = sanitizeForMongo(req.params);
    next();
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: isWildcard ? '*' : allowedOrigins }
});

const DATA_FILE = path.join(__dirname, 'servers.json');
const WEBHOOK_FILE = path.join(__dirname, 'webhook.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const INCIDENT_FILE = path.join(__dirname, 'incidents.json');
const USERS_FILE = path.join(__dirname, 'users.json');
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
const CONFIG_FIELDS = ['id', 'userId', 'name', 'host', 'port', 'protocol', 'checkType', 'expectedStatus', 'region', 'lat', 'lng'];

const monitoredServerSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    userId: { type: String, default: null },
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
// نظام المصادقة والصلاحيات (JWT Auth & Multi-Tenant SaaS)
// ----------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || 'nemvai_super_secret_change_me';
const JWT_EXPIRES = '12h';
const DEFAULT_ADMIN = {
    id: 'admin-root',
    username: 'admin',
    email: 'admin@nemvai.app',
    password: 'adminpassword123',
    role: 'admin',
    plan: 'business'
};

// خطط الاشتراك وحدود السيرفرات لكل خطة
const PLAN_LIMITS = { free: 2, pro: 10, business: Infinity };

// ----------------------------------------------------------
// Paddle Billing (v2) — إعدادات الدفع والاشتراكات
// ----------------------------------------------------------
const PADDLE_ENV = process.env.PADDLE_ENV || 'sandbox';
const PADDLE_CLIENT_TOKEN = process.env.PADDLE_CLIENT_TOKEN || '';
const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
const PADDLE_PRO_PRICE_ID = process.env.PADDLE_PRO_PRICE_ID || '';
const PADDLE_BUSINESS_PRICE_ID = process.env.PADDLE_BUSINESS_PRICE_ID || '';
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';

function getPlanLimit(plan) {
    return PLAN_LIMITS[plan] !== undefined ? PLAN_LIMITS[plan] : PLAN_LIMITS.free;
}

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, sparse: true },
    email: { type: String, unique: true, lowercase: true, required: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'subscriber'], default: 'subscriber' },
    plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
    paddleCustomerId: { type: String, default: null },
    paddleSubscriptionId: { type: String, default: null },
    paddleTransactionId: { type: String, default: null },
    paddlePriceId: { type: String, default: null },
    plan_updated_at: { type: Number, default: null },
    created_at: { type: Number, default: Date.now }
}, { collection: 'users' });

const UserModel = mongoose.models.NemvaiUser || mongoose.model('NemvaiUser', userSchema);

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// مستخدم محلي للعرض/النسخ
function publicUser(u) {
    return {
        id: u.id || u._id.toString(),
        username: u.username || null,
        email: u.email || null,
        role: u.role || 'subscriber',
        plan: u.plan || 'free',
        created_at: u.created_at || Date.now()
    };
}

// إنشاء حساب المسؤول الافتراضي عند بدء التشغيل إن لم يكن موجوداً
async function seedAdmin() {
    try {
        if (isDbConnected) {
            let existing = await UserModel.findOne({ $or: [{ username: DEFAULT_ADMIN.username }, { email: DEFAULT_ADMIN.email }] });
            if (!existing) {
                const hash = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
                await UserModel.create({
                    username: DEFAULT_ADMIN.username,
                    email: DEFAULT_ADMIN.email,
                    password_hash: hash,
                    role: DEFAULT_ADMIN.role,
                    plan: DEFAULT_ADMIN.plan
                });
                console.log('✅ تم إنشاء حساب المسؤول الافتراضي (admin).');
            } else if (existing && (!existing.plan || existing.role !== 'admin')) {
                existing.plan = 'business';
                existing.role = 'admin';
                await existing.save();
                console.log('✅ تم ترقية حساب المسؤول الافتراضي إلى خطة Business.');
            }
        } else {
            const local = readFileUsers();
            if (!local.some(u => u.username === DEFAULT_ADMIN.username || u.email === DEFAULT_ADMIN.email)) {
                local.push({
                    id: DEFAULT_ADMIN.id,
                    username: DEFAULT_ADMIN.username,
                    email: DEFAULT_ADMIN.email,
                    password_hash: await bcrypt.hash(DEFAULT_ADMIN.password, 10),
                    role: DEFAULT_ADMIN.role,
                    plan: DEFAULT_ADMIN.plan,
                    created_at: Date.now()
                });
                writeFileUsers(local);
                console.log('✅ تم إنشاء حساب المسؤول الافتراضي محلياً (admin).');
            }
        }
    } catch (err) {
        console.error('⚠️ خطأ في إنشاء حساب المسؤول:', err.message);
    }
}

// التحقق من بيانات المستخدم (البريد الإلكتروني أو اسم المستخدم)
async function verifyUser(identifier, password) {
    const idf = String(identifier || '').trim();
    if (!idf) return null;
    if (isDbConnected) {
        try {
            const user = await UserModel.findOne({ $or: [{ username: idf }, { email: idf.toLowerCase() }] });
            if (user && await bcrypt.compare(password, user.password_hash)) {
                return publicUser(user);
            }
        } catch (err) {
            console.error("⚠️ خطأ في التحقق من المستخدم:", err.message);
        }
    }
    const local = readFileUsers().find(u => u.username === idf || u.email === idf.toLowerCase());
    if (local && await bcrypt.compare(password, local.password_hash)) {
        return publicUser(local);
    }
    if (idf === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
        return publicUser(DEFAULT_ADMIN);
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
                    userId: s.userId || null,
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

function readFileUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
            return Array.isArray(data) ? data : [];
        }
    } catch (err) {
        console.error("⚠️ خطأ في قراءة users.json:", err.message);
    }
    return [];
}

function writeFileUsers(list) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("⚠️ خطأ في حفظ users.json:", err.message);
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
                    userId: s.userId || null,
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
                    userId: s.userId || null,
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
                userId: s.userId !== undefined ? s.userId : null,
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
// عزل البيانات حسب المستخدم (Multi-Tenant): المشرف يرى الكل،
// والمشترك يرى سيرفراته فقط
// ----------------------------------------------------------
function isAdminUser(user) {
    return user && user.role === 'admin';
}

function getVisibleServers(user) {
    if (!user) return [];
    if (isAdminUser(user)) return realServers;
    return realServers.filter(s => s.userId === user.id);
}

function getVisibleIncidents(user) {
    if (!user) return [];
    if (isAdminUser(user)) return incidents;
    return incidents.filter(i => i.userId === user.id);
}

function emitServerUpdatesToAll() {
    io.sockets.sockets.forEach(sock => {
        sock.emit('server_updates', getVisibleServers(sock.user));
    });
}

function emitIncidentsToAll() {
    io.sockets.sockets.forEach(sock => {
        sock.emit('incidents_update', getVisibleIncidents(sock.user));
    });
}

// هل يملك المستخدم صلاحية إدارة هذا السيرفر؟
function canManageServer(user, server) {
    if (!user) return false;
    if (isAdminUser(user)) return true;
    return server.userId === user.id;
}

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
        userId: s.userId || null,
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
    emitIncidentsToAll();
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
    emitIncidentsToAll();
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
    emitServerUpdatesToAll();
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
        if (payload) socket.user = { id: payload.id, username: payload.username, email: payload.email, role: payload.role, plan: payload.plan };
    }
    socket.emit('auth_status', {
        authenticated: !!socket.user,
        id: socket.user ? socket.user.id : null,
        role: socket.user ? socket.user.role : 'viewer',
        username: socket.user ? (socket.user.username || socket.user.email) : null,
        email: socket.user ? socket.user.email : null,
        plan: socket.user ? socket.user.plan : 'free'
    });
    // لا نكشف رابط الـ Webhook إلا للمسؤول عند الاتصال
    socket.emit('webhook_status', { configured: isAdminUser(socket.user) && !!webhookUrl, url: isAdminUser(socket.user) ? webhookUrl : null });
    socket.emit('incidents_update', getVisibleIncidents(socket.user));
    socket.emit('server_updates', getVisibleServers(socket.user));

    // طلب سجل الحوادث (Incident Log)
    socket.on('get_incidents', () => {
        socket.emit('incidents_update', getVisibleIncidents(socket.user));
    });

    // تسجيل الدخول/الخروج داخل الجلسة (إعادة المصادقة)
    socket.on('authenticate', (token) => {
        const payload = verifyToken(String(token || ''));
        if (payload) {
            socket.user = { id: payload.id, username: payload.username, email: payload.email, role: payload.role, plan: payload.plan };
            socket.emit('auth_status', {
                authenticated: true,
                id: socket.user.id,
                role: socket.user.role,
                username: socket.user.username || socket.user.email,
                email: socket.user.email,
                plan: socket.user.plan
            });
            socket.emit('server_updates', getVisibleServers(socket.user));
            socket.emit('incidents_update', getVisibleIncidents(socket.user));
        } else {
            socket.user = null;
            socket.emit('auth_status', { authenticated: false, id: null, role: 'viewer', username: null, email: null, plan: 'free' });
            socket.emit('server_updates', getVisibleServers(socket.user));
            socket.emit('incidents_update', getVisibleIncidents(socket.user));
        }
    });

    function isAuthenticated() {
        return !!socket.user;
    }
    function denyAuth() {
        socket.emit('server_action_result', { ok: false, message: "⛔ صلاحيات غير كافية: يتطلب تسجيل الدخول." });
    }
    function denyAdmin() {
        socket.emit('server_action_result', { ok: false, message: "⛔ صلاحيات غير كافية: يتطلب تسجيل الدخول كـ Admin." });
    }

    // إضافة سيرفر جديد (أي مستخدم مسجل، ضمن حدود خطته)
    socket.on('add_server', async (data) => {
        if (!isAuthenticated()) return denyAuth();
        const { name, host, region, lat, lng, port, protocol, checkType, expectedStatus } = data || {};
        if (!name || !host) {
            socket.emit('server_action_result', { ok: false, message: "⚠️ يجب إدخال اسم السيرفر والعنوان (Host/IP)." });
            return;
        }
        // التحقق من حد الخطة
        const userServers = realServers.filter(s => s.userId === socket.user.id).length;
        const limit = getPlanLimit(socket.user.plan);
        if (userServers >= limit) {
            socket.emit('server_action_result', { ok: false, message: `⛔ بلغت الحد الأقصى لخطتك (${socket.user.plan}: ${limit} سيرفر). قم بترقية خطتك لإضافة المزيد.` });
            return;
        }
        const normCheck = checkType || (protocol === 'tcp' ? 'tcp' : 'http');
        const newServer = {
            id: Date.now(),
            userId: socket.user.id,
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
            emitServerUpdatesToAll();
            checkServers();
        } else {
            realServers.pop();
            socket.emit('server_action_result', { ok: false, message: "❌ فشل حفظ السيرفر في قاعدة البيانات." });
        }
    });

    // حذف سيرفر موجود (مالكه أو Admin)
    socket.on('delete_server', async (id) => {
        if (!isAuthenticated()) return denyAuth();
        const numId = Number(id);
        const index = realServers.findIndex(s => s.id === numId);
        if (index === -1) {
            socket.emit('server_action_result', { ok: false, message: "❌ السيرفر غير موجود." });
            return;
        }
        if (!canManageServer(socket.user, realServers[index])) {
            socket.emit('server_action_result', { ok: false, message: "⛔ لا تملك صلاحية حذف هذا السيرفر." });
            return;
        }
        const removed = realServers.splice(index, 1)[0];
        if (await saveServers(realServers)) {
            socket.emit('server_action_result', { ok: true, message: `🗑️ تم حذف السيرفر (${removed.name}) وتحديث قاعدة البيانات.` });
            emitServerUpdatesToAll();
        } else {
            realServers.splice(index, 0, removed);
            socket.emit('server_action_result', { ok: false, message: "❌ فشل حفظ التعديلات في قاعدة البيانات." });
        }
    });

    // محاكاة الضغط لاختبار التنبيهات (Admin فقط)
    socket.on('simulate_stress', (data) => {
        if (!isAdminUser(socket.user)) return denyAdmin();
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
        emitServerUpdatesToAll();
    });

    // حفظ رابط الـ Webhook (Admin فقط)
    socket.on('save_webhook', async (url) => {
        if (!isAdminUser(socket.user)) return denyAdmin();
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

    // إرسال رسالة اختبار للـ Webhook (Admin فقط)
    socket.on('test_webhook', async () => {
        if (!isAdminUser(socket.user)) return denyAdmin();
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

    // طلب حالة الـ Webhook الحالية (Admin فقط)
    socket.on('get_webhook', () => {
        if (!isAdminUser(socket.user)) return;
        socket.emit('webhook_status', { configured: !!webhookUrl, url: webhookUrl });
    });

    socket.on('disconnect', () => {
        console.log("🔴 عميل انقطع:", socket.id);
    });
});

// ----------------------------------------------------------
// REST endpoints للمصادقة وإدارة السيرفرات (Multi-Tenant)
// ----------------------------------------------------------

// وسيط المصادقة: يتطلب Token صالح (أي مستخدم مسجل)
function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) {
        return res.status(401).json({ ok: false, message: "⛔ صلاحيات غير كافية: يتطلب تسجيل الدخول." });
    }
    req.user = payload;
    next();
}

// حماية النقاط الحساسة: يشترط حساب Admin
function adminRequired(req, res, next) {
    authenticate(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ ok: false, message: "⛔ صلاحيات غير كافية: يتطلب تسجيل الدخول كـ Admin." });
        }
        next();
    });
}

// تسجيل حساب جديد (Subscriber افتراضياً بخطة Free)
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, message: "email و password مطلوبان." });
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ ok: false, message: "صيغة البريد الإلكتروني غير صحيحة." });
    }
    if (String(password).length < 6) {
        return res.status(400).json({ ok: false, message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل." });
    }
    const cleanName = String(username || '').trim();
    if (!cleanName) return res.status(400).json({ ok: false, message: "اسم المستخدم مطلوب." });
    try {
        if (isDbConnected) {
            const dup = await UserModel.findOne({ $or: [{ email: cleanEmail }, { username: cleanName }] });
            if (dup) return res.status(409).json({ ok: false, message: "البريد الإلكتروني أو اسم المستخدم مستخدم بالفعل." });
        } else if (readFileUsers().some(u => u.email === cleanEmail || u.username === cleanName)) {
            return res.status(409).json({ ok: false, message: "البريد الإلكتروني أو اسم المستخدم مستخدم بالفعل." });
        }
        const hash = await bcrypt.hash(String(password), 10);
        let created;
        if (isDbConnected) {
            const doc = await UserModel.create({ username: cleanName, email: cleanEmail, password_hash: hash, role: 'subscriber', plan: 'free' });
            created = publicUser(doc);
        } else {
            const local = readFileUsers();
            created = { id: 'user-' + Date.now(), username: cleanName, email: cleanEmail, password_hash: hash, role: 'subscriber', plan: 'free', created_at: Date.now() };
            local.push(created);
            writeFileUsers(local);
            created = publicUser(created);
        }
        const token = jwt.sign({ id: created.id, username: created.username, email: created.email, role: created.role, plan: created.plan }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        res.status(201).json({ ok: true, token, user: created });
    } catch (err) {
        console.error("⚠️ خطأ في تسجيل حساب جديد:", err.message);
        res.status(500).json({ ok: false, message: "فشل إنشاء الحساب." });
    }
});

// تسجيل الدخول (بالبريد الإلكتروني أو اسم المستخدم)
app.post('/api/auth/login', async (req, res) => {
    const { username, email, password } = req.body || {};
    const identifier = username || email;
    if (!identifier || !password) return res.status(400).json({ ok: false, message: "البريد الإلكتروني / اسم المستخدم و كلمة المرور مطلوبان." });
    const user = await verifyUser(String(identifier), String(password));
    if (!user) return res.status(401).json({ ok: false, message: "بيانات الدخول غير صحيحة." });
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role, plan: user.plan }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ ok: true, token, user });
});

// (توافق مع النسخ السابقة) تسجيل الدخول القديم
app.post('/api/login', async (req, res) => {
    const { username, email, password } = req.body || {};
    const identifier = username || email;
    if (!identifier || !password) return res.status(400).json({ ok: false, message: "username و password مطلوبان." });
    const user = await verifyUser(String(identifier), String(password));
    if (!user) return res.status(401).json({ ok: false, message: "بيانات الدخول غير صحيحة." });
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role, plan: user.plan }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ ok: true, token, user });
});

// جلب بيانات المستخدم الحالي
app.get('/api/auth/me', authenticate, async (req, res) => {
    if (isDbConnected) {
        try {
            const user = await UserModel.findById(req.user.id);
            if (user) return res.json({ ok: true, user: publicUser(user) });
        } catch (err) {
            console.error("⚠️ خطأ في جلب المستخدم:", err.message);
        }
    }
    const local = readFileUsers().find(u => u.id === req.user.id);
    if (local) return res.json({ ok: true, user: publicUser(local) });
    res.json({ ok: true, user: req.user });
});

// قائمة المستخدمين (Admin فقط)
app.get('/api/auth/users', adminRequired, async (req, res) => {
    try {
        let list;
        if (isDbConnected) {
            const docs = await UserModel.find().lean();
            list = docs.map(u => publicUser(u));
        } else {
            list = readFileUsers().map(u => publicUser(u));
        }
        res.json({ ok: true, users: list });
    } catch (err) {
        console.error("⚠️ خطأ في جلب المستخدمين:", err.message);
        res.status(500).json({ ok: false, message: "فشل جلب المستخدمين." });
    }
});

// تحديث خطة/دور مستخدم (Admin فقط)
app.patch('/api/auth/users/:id', adminRequired, async (req, res) => {
    const { role, plan } = req.body || {};
    if (role && !['admin', 'subscriber'].includes(role)) {
        return res.status(400).json({ ok: false, message: "الدور يجب أن يكون admin أو subscriber." });
    }
    if (plan && !['free', 'pro', 'business'].includes(plan)) {
        return res.status(400).json({ ok: false, message: "الخطة يجب أن تكون free أو pro أو business." });
    }
    try {
        if (isDbConnected) {
            const user = await UserModel.findById(req.params.id);
            if (!user) return res.status(404).json({ ok: false, message: "المستخدم غير موجود." });
            if (role) user.role = role;
            if (plan) user.plan = plan;
            await user.save();
            return res.json({ ok: true, user: publicUser(user) });
        }
        const local = readFileUsers();
        const idx = local.findIndex(u => u.id === req.params.id);
        if (idx === -1) return res.status(404).json({ ok: false, message: "المستخدم غير موجود." });
        if (role) local[idx].role = role;
        if (plan) local[idx].plan = plan;
        writeFileUsers(local);
        res.json({ ok: true, user: publicUser(local[idx]) });
    } catch (err) {
        console.error("⚠️ خطأ في تحديث المستخدم:", err.message);
        res.status(500).json({ ok: false, message: "فشل تحديث المستخدم." });
    }
});

// قائمة السيرفرات الخاصة بالمستخدم (عزل حسب userId)
app.get('/servers', authenticate, (req, res) => res.json(getVisibleServers(req.user)));

app.post('/servers', authenticate, async (req, res) => {
    const { name, host, region, lat, lng, port, protocol, checkType, expectedStatus } = req.body || {};
    if (!name || !host) return res.status(400).json({ ok: false, message: "name و host مطلوبان." });
    // التحقق من حد الخطة
    const userServers = realServers.filter(s => s.userId === req.user.id).length;
    const limit = getPlanLimit(req.user.plan);
    if (userServers >= limit) {
        return res.status(403).json({ ok: false, message: `⛔ بلغت الحد الأقصى لخطتك (${req.user.plan}: ${limit} سيرفر). قم بترقية خطتك لإضافة المزيد.` });
    }
    const normCheck = checkType || (protocol === 'tcp' ? 'tcp' : 'http');
    const newServer = {
        id: Date.now(),
        userId: req.user.id,
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
        emitServerUpdatesToAll();
        res.json({ ok: true, server: newServer });
    } else {
        realServers.pop();
        res.status(500).json({ ok: false, message: "فشل حفظ السيرفر في قاعدة البيانات." });
    }
});

app.delete('/servers/:id', authenticate, async (req, res) => {
    const numId = Number(req.params.id);
    const index = realServers.findIndex(s => s.id === numId);
    if (index === -1) return res.status(404).json({ ok: false, message: "السيرفر غير موجود." });
    if (!canManageServer(req.user, realServers[index])) {
        return res.status(403).json({ ok: false, message: "⛔ لا تملك صلاحية حذف هذا السيرفر." });
    }
    const removed = realServers.splice(index, 1)[0];
    if (await saveServers(realServers)) {
        emitServerUpdatesToAll();
        res.json({ ok: true, server: removed });
    } else {
        realServers.splice(index, 0, removed);
        res.status(500).json({ ok: false, message: "فشل حفظ التعديلات في قاعدة البيانات." });
    }
});

// تعديل سيرفر موجود (مالكه أو Admin فقط — تحقق من الملكية على مستوى المستند)
app.patch('/servers/:id', authenticate, async (req, res) => {
    const numId = Number(req.params.id);
    const index = realServers.findIndex(s => s.id === numId);
    if (index === -1) return res.status(404).json({ ok: false, message: "السيرفر غير موجود." });
    if (!canManageServer(req.user, realServers[index])) {
        return res.status(403).json({ ok: false, message: "⛔ لا تملك صلاحية تعديل هذا السيرفر." });
    }
    const { name, host, port, protocol, checkType, expectedStatus, region, lat, lng } = req.body || {};
    const s = realServers[index];
    if (name) s.name = String(name);
    if (host) s.host = String(host);
    if (port !== undefined && port !== null && port !== '') s.port = Number(port);
    if (checkType) {
        s.checkType = String(checkType);
        s.protocol = String(checkType) === 'tcp' ? 'tcp' : 'http';
    } else if (protocol) {
        s.protocol = String(protocol);
    }
    if ((s.checkType === 'http') && expectedStatus !== undefined && expectedStatus !== null) s.expectedStatus = Number(expectedStatus);
    if (region) s.region = String(region);
    if (lat !== undefined && lat !== null) s.lat = parseFloat(lat);
    if (lng !== undefined && lng !== null) s.lng = parseFloat(lng);
    if (await saveServers(realServers)) {
        emitServerUpdatesToAll();
        res.json({ ok: true, server: s });
    } else {
        res.status(500).json({ ok: false, message: "فشل حفظ التعديلات في قاعدة البيانات." });
    }
});

app.get('/webhook', adminRequired, (req, res) => res.json({ url: webhookUrl, configured: !!webhookUrl }));

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
app.get('/api/incidents', authenticate, (req, res) => res.json(getVisibleIncidents(req.user)));

app.delete('/api/incidents', adminRequired, async (req, res) => {
    incidents = [];
    writeFileIncidents();
    emitIncidentsToAll();
    res.json({ ok: true, message: "تم مسح سجل الحوادث." });
});

// سجل الاستجابة الزمني (Latency History) — REST للتصدير
app.get('/api/history', authenticate, (req, res) => {
    const map = {};
    getVisibleServers(req.user).forEach(s => {
        map[s.id] = {
            name: s.name,
            latencyHistory: s.latencyHistory || [],
            uptimePercentage: s.uptimePercentage
        };
    });
    res.json(map);
});

// ----------------------------------------------------------
// Paddle Billing (v2) — Webhook لتحديث خطط الاشتراك تلقائياً
// ----------------------------------------------------------

// التحقق من توقيع Webhook (HMAC SHA-256) عبر ترويسة Paddle-Signature
function verifyPaddleSignature(header, rawBody) {
    try {
        const params = {};
        header.split(';').forEach(part => {
            const eq = part.indexOf('=');
            if (eq > 0) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
        });
        const ts = params.ts;
        const h1 = params.h1;
        if (!ts || !h1) return false;
        // منع إعادة تشغيل الطلبات القديمة (نافذة 5 دقائق)
        if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return false;
        const signedPayload = `${ts}:${rawBody}`;
        const expected = crypto.createHmac('sha256', PADDLE_WEBHOOK_SECRET).update(signedPayload).digest('hex');
        const actual = Buffer.from(h1.toLowerCase(), 'utf-8');
        const wanted = Buffer.from(expected.toLowerCase(), 'utf-8');
        return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
    } catch (err) {
        return false;
    }
}

// ربط معرّف السعر في Paddle بالخطة الداخلية
function planFromPaddlePriceId(priceId) {
    if (!priceId) return null;
    if (PADDLE_PRO_PRICE_ID && priceId === PADDLE_PRO_PRICE_ID) return 'pro';
    if (PADDLE_BUSINESS_PRICE_ID && priceId === PADDLE_BUSINESS_PRICE_ID) return 'business';
    return null;
}

// البحث عن المستخدم عبر custom_data.userId → البريد الإلكتروني → paddleCustomerId
async function findUserForPaddle({ userId, email, customerId }) {
    if (isDbConnected) {
        try {
            if (userId && mongoose.Types.ObjectId.isValid(userId)) {
                return await UserModel.findById(userId);
            }
            if (email) {
                const byEmail = await UserModel.findOne({ email: String(email).toLowerCase() });
                if (byEmail) return byEmail;
            }
            if (customerId) {
                return await UserModel.findOne({ paddleCustomerId: customerId });
            }
        } catch (err) {
            console.error("⚠️ [paddle] خطأ في البحث عن المستخدم:", err.message);
        }
        return null;
    }
    const local = readFileUsers();
    let u = userId ? local.find(x => x.id === userId) : null;
    if (!u && email) u = local.find(x => x.email === String(email).toLowerCase());
    if (!u && customerId) u = local.find(x => x.paddleCustomerId === customerId);
    return u || null;
}

// تطبيق الخطة الجديدة على المستخدم (قاعدة البيانات أو الملفات المحلية)
async function applyPaddlePlanToUser(user, patch) {
    if (isDbConnected) {
        if (patch.plan) user.plan = patch.plan;
        if (patch.customerId) user.paddleCustomerId = patch.customerId;
        if (patch.subscriptionId) user.paddleSubscriptionId = patch.subscriptionId;
        if (patch.transactionId) user.paddleTransactionId = patch.transactionId;
        if (patch.priceId) user.paddlePriceId = patch.priceId;
        if (patch.plan || patch.customerId || patch.subscriptionId || patch.transactionId) user.plan_updated_at = Date.now();
        await user.save();
        return publicUser(user);
    }
    const local = readFileUsers();
    const idx = local.findIndex(u => u.id === user.id);
    if (idx === -1) return null;
    if (patch.plan) local[idx].plan = patch.plan;
    if (patch.customerId) local[idx].paddleCustomerId = patch.customerId;
    if (patch.subscriptionId) local[idx].paddleSubscriptionId = patch.subscriptionId;
    if (patch.transactionId) local[idx].paddleTransactionId = patch.transactionId;
    if (patch.priceId) local[idx].paddlePriceId = patch.priceId;
    local[idx].plan_updated_at = Date.now();
    writeFileUsers(local);
    return publicUser(local[idx]);
}

// إخطار مستخدم متصل عبر Socket.IO لتحديث حالة الخطّة فوراً
function emitAuthRefreshToUser(userId) {
    io.sockets.sockets.forEach(s => {
        if (s.user && String(s.user.id) === String(userId)) {
            s.emit('auth_refresh', { reason: 'plan-updated' });
        }
    });
}

// Webhook الرئيسي لـ Paddle: transaction.completed / subscription.created|updated|canceled
app.post('/api/webhooks/paddle', async (req, res) => {
    const rawBody = (req.rawBody && req.rawBody.length) ? req.rawBody.toString('utf-8') : JSON.stringify(req.body || {});
    const signatureHeader = String(req.headers['paddle-signature'] || '');
    if (PADDLE_WEBHOOK_SECRET) {
        if (!verifyPaddleSignature(signatureHeader, rawBody)) {
            return res.status(401).json({ ok: false, message: 'توقيع Paddle غير صالح.' });
        }
    } else {
        console.warn('⚠️ [paddle] PADDLE_WEBHOOK_SECRET غير معرّف — تم تخطي التحقق من التوقيع (Sandbox فقط).');
    }

    const event = req.body || {};
    const eventType = event.event_type || '';
    const data = event.data || {};
    const HANDLED_EVENTS = ['transaction.completed', 'subscription.created', 'subscription.updated', 'subscription.canceled'];
    if (!HANDLED_EVENTS.includes(eventType)) {
        return res.json({ ok: true, received: true, ignored: eventType });
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const firstItem = items[0] || {};
    const priceId = firstItem.price_id || (firstItem.price && firstItem.price.id) || null;
    const customData = (data.custom_data && typeof data.custom_data === 'object') ? data.custom_data : {};
    const userId = customData.userId || customData.user_id || null;
    const email = (data.customer && data.customer.email) || null;
    const customerId = data.customer_id || null;
    const status = data.status || null;
    const isCanceled = eventType === 'subscription.canceled' || status === 'canceled';

    const plan = isCanceled ? 'free' : planFromPaddlePriceId(priceId);
    if (!plan) {
        console.warn(`⚠️ [paddle] لا يمكن تحديد الخطة من price_id: ${priceId}`);
        return res.json({ ok: true, received: true, ignored: 'unknown price' });
    }

    const user = await findUserForPaddle({ userId, email, customerId });
    if (!user) {
        console.warn(`⚠️ [paddle] لم يتم العثور على مستخدم مطابق (userId=${userId}, email=${email}, customer=${customerId}).`);
        return res.json({ ok: true, received: true, ignored: 'no user' });
    }

    const updated = await applyPaddlePlanToUser(user, {
        plan,
        customerId,
        subscriptionId: eventType.startsWith('subscription') ? (data.id || null) : null,
        transactionId: eventType === 'transaction.completed' ? (data.id || null) : null,
        priceId
    });

    if (updated) {
        console.log(`✅ [paddle] ${eventType} → ${updated.email} أصبح على خطة ${updated.plan}.`);
        emitAuthRefreshToUser(updated.id);
    }
    res.json({ ok: true, received: true, plan: updated ? updated.plan : null });
});

// جلب أسعار الخطط من Paddle لعرضها على الواجهة (اختياري)
app.get('/api/paddle/prices', async (req, res) => {
    try {
        if (!PADDLE_API_KEY || !PADDLE_PRO_PRICE_ID || !PADDLE_BUSINESS_PRICE_ID) {
            return res.json({ ok: false, message: 'إعدادات Paddle غير مكتملة.' });
        }
        const headers = { Authorization: `Bearer ${PADDLE_API_KEY}` };
        const fetchPrice = (id) => axios.get(`https://api.paddle.com/prices/${id}`, { headers })
            .then(r => r.data && r.data.data)
            .catch(() => null);
        const [pro, business] = await Promise.all([fetchPrice(PADDLE_PRO_PRICE_ID), fetchPrice(PADDLE_BUSINESS_PRICE_ID)]);
        const shape = (p) => p ? {
            amount: (p.unit_price && p.unit_price.amount) || null,
            currency: (p.unit_price && p.unit_price.currency_code) || null,
            interval: (p.billing_cycle && p.billing_cycle.interval) || null
        } : null;
        res.json({ ok: true, prices: { pro: shape(pro), business: shape(business) } });
    } catch (err) {
        res.status(500).json({ ok: false, message: err.message });
    }
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
