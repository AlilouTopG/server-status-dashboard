const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const mongoose = require('mongoose');

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
const MONGODB_URI = process.env.MONGODB_URI || '';

// ----------------------------------------------------------
// قاعدة البيانات السحابية الدائمة (MongoDB عبر Mongoose)
// ----------------------------------------------------------
const CONFIG_FIELDS = ['id', 'name', 'host', 'port', 'protocol', 'region', 'lat', 'lng'];

const monitoredServerSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    host: { type: String, required: true },
    port: { type: Number, default: null },
    protocol: { type: String, default: 'http' },
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

let webhookUrl = '';

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
            footer: { text: "Nexus Monitoring System v7.1" },
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
            footer: { text: "Nexus Monitoring System v7.1" },
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
            // فحص TCP: بروتوكول tcp مع منفذ محدد
            const isTcp = s.protocol === 'tcp' && s.port;
            if (isTcp) {
                const result = await checkTcpPort(s.host, s.port, 3000);
                s.status = result.ok ? 'operational' : 'down';
                s.latency = result.ok ? result.latency : 0;
            } else {
                // فحص HTTP: يستمر عبر axios.get
                const url = buildUrl(s.host);
                if (!url) {
                    s.status = 'down';
                    s.latency = 0;
                } else {
                    const start = Date.now();
                    try {
                        await axios.get(url, { timeout: 3000 });
                        s.status = 'operational';
                        s.latency = Date.now() - start;
                    } catch (error) {
                        s.status = 'down';
                        s.latency = 0;
                    }
                }
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

        // تسجيل القراءة في سجل الأداء (آخر 20 قراءة)
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

        // نسبة الاستقرار بناءً على سجل الفحص
        s.uptimePercentage = computeUptime(s.history);

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
    socket.emit('webhook_status', { configured: !!webhookUrl, url: webhookUrl });

    // إضافة سيرفر جديد
    socket.on('add_server', async (data) => {
        const { name, host, region, lat, lng, port, protocol } = data || {};
        if (!name || !host) {
            socket.emit('server_action_result', { ok: false, message: "⚠️ يجب إدخال اسم السيرفر والعنوان (Host/IP)." });
            return;
        }
        const newServer = {
            id: Date.now(),
            name: String(name),
            host: String(host),
            port: port !== undefined && port !== null && port !== '' ? Number(port) : null,
            protocol: protocol === 'tcp' ? 'tcp' : 'http',
            region: region || "Unknown",
            lat: parseFloat(lat) || 0,
            lng: parseFloat(lng) || 0,
            status: 'operational',
            cpu: 0,
            latency: 0
        };
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

    // حذف سيرفر موجود
    socket.on('delete_server', async (id) => {
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

    // محاكاة الضغط لاختبار التنبيهات (عطل مفاجئ / ضغط عالي)
    socket.on('simulate_stress', (data) => {
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

    // حفظ رابط الـ Webhook
    socket.on('save_webhook', async (url) => {
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
                content: "✅ **اختبار ناجح!** إشعارات Discord تعمل بشكل صحيح على نظام Nexus v7.1."
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
app.get('/servers', (req, res) => res.json(realServers));

app.post('/servers', async (req, res) => {
    const { name, host, region, lat, lng, port, protocol } = req.body || {};
    if (!name || !host) return res.status(400).json({ ok: false, message: "name و host مطلوبان." });
    const newServer = {
        id: Date.now(),
        name: String(name),
        host: String(host),
        port: port !== undefined && port !== null && port !== '' ? Number(port) : null,
        protocol: protocol === 'tcp' ? 'tcp' : 'http',
        region: region || "Unknown",
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        status: 'operational',
        cpu: 0,
        latency: 0
    };
    realServers.push(newServer);
    if (await saveServers(realServers)) {
        io.emit('server_updates', realServers);
        res.json({ ok: true, server: newServer });
    } else {
        realServers.pop();
        res.status(500).json({ ok: false, message: "فشل حفظ السيرفر في قاعدة البيانات." });
    }
});

app.delete('/servers/:id', async (req, res) => {
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

app.post('/webhook', async (req, res) => {
    const url = String((req.body || {}).url || '').trim();
    if (!url) return res.status(400).json({ ok: false, message: "url مطلوب." });
    if (await saveWebhookToFile(url)) {
        io.emit('webhook_status', { configured: true, url });
        res.json({ ok: true, url });
    } else {
        res.status(500).json({ ok: false, message: "فشل حفظ الرابط." });
    }
});

app.post('/webhook/test', async (req, res) => {
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

const PORT = process.env.PORT || 4000;

async function startServer() {
    await connectDatabase();
    await loadWebhook();
    realServers = await loadServers();
    server.listen(PORT, () => {
        console.log(`✅ Nexus Monitoring System يعمل بنجاح على المنفذ ${PORT}! (v7.1 TCP & Service Monitoring)`);
    });
}

startServer();
