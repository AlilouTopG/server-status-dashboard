const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const DATA_FILE = path.join(__dirname, 'servers.json');

// ----------------------------------------------------------
// قراءة وكتابة قائمة السيرفرات من ملف servers.json
// الملف النظيف يحفظ فقط: (id, name, host, region, lat, lng)
// ----------------------------------------------------------
const CONFIG_FIELDS = ['id', 'name', 'host', 'region', 'lat', 'lng'];

function sanitizeForFile(list) {
    return list.map(s => {
        const clean = {};
        CONFIG_FIELDS.forEach(f => { clean[f] = s[f]; });
        return clean;
    });
}

function loadServers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
            if (Array.isArray(data)) {
                return data.map(s => ({
                    id: s.id,
                    name: s.name,
                    host: s.host || s.url || '',
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

function saveServers(list) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(sanitizeForFile(list), null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("⚠️ خطأ في حفظ servers.json:", err.message);
        return false;
    }
}

let realServers = loadServers();

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

async function checkServers() {
    const hostCpu = getCpuUsage();
    const hostMemory = getMemoryUsage();

    for (let s of realServers) {
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

        // إرفاق استهلاك CPU والذاكرة الحقيقي للمضيف بكل سيرفر
        s.cpu = hostCpu;
        s.memory = hostMemory.percent;
        s.ram = {
            usedMB: Math.round(hostMemory.used / 1024 / 1024),
            totalMB: Math.round(hostMemory.total / 1024 / 1024),
            percent: hostMemory.percent
        };
    }

    // إرسال النتيجة الحقيقية فوراً للواجهة عبر Socket.IO
    io.emit('server_updates', realServers);
    io.emit('host_metrics', { cpu: hostCpu, memory: hostMemory });
}

// تشغيل الفحص تلقائياً كل 5 ثوانٍ
setInterval(checkServers, 5000);

// ----------------------------------------------------------
// أحداث Socket.IO لإدارة السيرفرات من الواجهة
// ----------------------------------------------------------
io.on('connection', (socket) => {
    console.log("🟢 عميل متصل:", socket.id);

    // إضافة سيرفر جديد
    socket.on('add_server', (data) => {
        const { name, host, region, lat, lng } = data || {};
        if (!name || !host) {
            socket.emit('server_action_result', { ok: false, message: "⚠️ يجب إدخال اسم السيرفر والعنوان (Host/IP)." });
            return;
        }
        const newServer = {
            id: Date.now(),
            name: String(name),
            host: String(host),
            region: region || "Unknown",
            lat: parseFloat(lat) || 0,
            lng: parseFloat(lng) || 0,
            status: 'operational',
            cpu: 0,
            latency: 0
        };
        realServers.push(newServer);
        if (saveServers(realServers)) {
            socket.emit('server_action_result', { ok: true, message: `✅ تمت إضافة السيرفر (${newServer.name}) وحفظه في servers.json.` });
            io.emit('server_updates', realServers);
            checkServers();
        } else {
            realServers.pop();
            socket.emit('server_action_result', { ok: false, message: "❌ فشل حفظ السيرفر في الملف." });
        }
    });

    // حذف سيرفر موجود
    socket.on('delete_server', (id) => {
        const numId = Number(id);
        const index = realServers.findIndex(s => s.id === numId);
        if (index === -1) {
            socket.emit('server_action_result', { ok: false, message: "❌ السيرفر غير موجود." });
            return;
        }
        const removed = realServers.splice(index, 1)[0];
        if (saveServers(realServers)) {
            socket.emit('server_action_result', { ok: true, message: `🗑️ تم حذف السيرفر (${removed.name}) وتحديث servers.json.` });
            io.emit('server_updates', realServers);
        } else {
            realServers.splice(index, 0, removed);
            socket.emit('server_action_result', { ok: false, message: "❌ فشل حفظ التعديلات في الملف." });
        }
    });

    socket.on('disconnect', () => {
        console.log("🔴 عميل انقطع:", socket.id);
    });
});

// ----------------------------------------------------------
// REST endpoints لإدارة السيرفرات (بديل / تكميلي)
// ----------------------------------------------------------
app.get('/servers', (req, res) => res.json(realServers));

app.post('/servers', (req, res) => {
    const { name, host, region, lat, lng } = req.body || {};
    if (!name || !host) return res.status(400).json({ ok: false, message: "name و host مطلوبان." });
    const newServer = {
        id: Date.now(),
        name: String(name),
        host: String(host),
        region: region || "Unknown",
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        status: 'operational',
        cpu: 0,
        latency: 0
    };
    realServers.push(newServer);
    if (saveServers(realServers)) {
        io.emit('server_updates', realServers);
        res.json({ ok: true, server: newServer });
    } else {
        realServers.pop();
        res.status(500).json({ ok: false, message: "فشل حفظ السيرفر في الملف." });
    }
});

app.delete('/servers/:id', (req, res) => {
    const numId = Number(req.params.id);
    const index = realServers.findIndex(s => s.id === numId);
    if (index === -1) return res.status(404).json({ ok: false, message: "السيرفر غير موجود." });
    const removed = realServers.splice(index, 1)[0];
    if (saveServers(realServers)) {
        io.emit('server_updates', realServers);
        res.json({ ok: true, server: removed });
    } else {
        realServers.splice(index, 0, removed);
        res.status(500).json({ ok: false, message: "فشل حفظ التعديلات في الملف." });
    }
});

server.listen(4000, () => {
    console.log("✅ الخادم يعمل بنجاح على المنفذ 4000!");
});
