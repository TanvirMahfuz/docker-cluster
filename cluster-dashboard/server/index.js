import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import http from 'node:http';
import mongoose from 'mongoose';
import { createClient } from 'redis';

const app = express();
const PORT = process.env.PORT || 8081;

const REPLICAS = (process.env.REPLICA_HOSTS || 'docker-cluster-app-1:3000,docker-cluster-app-2:3000,docker-cluster-app-3:3000,docker-cluster-app-4:3000,docker-cluster-app-5:3000')
    .split(',').map(h => ({ name: h.split(':')[0], url: `http://${h}` }));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/mydatabase';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Dashboard connected to MongoDB'))
    .catch(err => console.error('Dashboard could not connect to MongoDB:', err.message));

const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('Redis error:', err.message));
redisClient.connect().catch((err) => console.error('Redis connect failed:', err.message));

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const httpGetJson = (url, timeout = 3000) => new Promise((resolve, reject) => {
    const req = http.request(url, { agent: false, headers: { Connection: 'close' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            try {
                resolve({ status: res.statusCode, json: JSON.parse(body) });
            } catch {
                reject(new Error('invalid JSON from ' + url));
            }
        });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.setTimeout(timeout);
    req.end();
});

const fetchReplicaHealth = async (replica, timeout = 2000) => {
    const start = Date.now();
    try {
        const res = await httpGetJson(`${replica.url}/health`, timeout);
        const body = res.json;
        return {
            name: replica.name,
            url: replica.url,
            up: body.status === 'UP',
            database: body.database,
            statusCode: res.status,
            latencyMs: Date.now() - start,
            time: Date.now()
        };
    } catch {
        return {
            name: replica.name,
            url: replica.url,
            up: false,
            database: 'DOWN',
            error: 'unreachable',
            latencyMs: Date.now() - start,
            time: Date.now()
        };
    }
};

const fetchReplicaStats = async (replica, timeout = 3000) => {
    try {
        const res = await httpGetJson(`${replica.url}/get-message-count`, timeout);
        return { name: replica.name, cached: res.json.data?.fromCache ?? null, count: res.json.data?.count ?? null };
    } catch {
        return { name: replica.name, cached: null, count: null };
    }
};

app.get('/api/health', async (req, res) => {
    const results = [];
    for (const replica of REPLICAS) {
        results.push(await fetchReplicaHealth(replica));
    }
    res.json({
        replicas: results,
        summary: {
            total: results.length,
            up: results.filter(r => r.up).length,
            avgLatencyMs: Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)
        }
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        const name = mongoose.connection.name;
        const counts = {};
        const collectionInfo = await mongoose.connection.db.listCollections().toArray();
        for (const col of collectionInfo) {
            counts[col.name] = await mongoose.connection.db.collection(col.name).countDocuments();
        }
        res.json({ database: name, counts, dbState: mongoose.connection.readyState });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/redis', async (req, res) => {
    try {
        if (!redisClient.isOpen) throw new Error('redis not connected');
        const messageCount = await redisClient.get('messageCount');
        const ttl = await redisClient.ttl('messageCount');
        const keys = await redisClient.dbSize();
        const serverInfo = await redisClient.info('server');
        const memoryInfo = await redisClient.info('memory');
        const parse = (info, prefix) => {
            const line = info.split('\n').find(l => l.startsWith(prefix + ':'));
            return line ? line.split(':')[1] : null;
        };
        res.json({
            connected: true,
            messageCount: messageCount !== null ? parseInt(messageCount) : null,
            ttl,
            totalKeys: keys,
            version: parse(serverInfo, 'redis_version'),
            usedMemoryMb: Math.round((parse(memoryInfo, 'used_memory') / 1024 / 1024) * 100) / 100
        });
    } catch (err) {
        res.json({
            connected: false,
            messageCount: null,
            ttl: null,
            totalKeys: null,
            version: null,
            usedMemoryMb: null,
            error: err.message
        });
    }
});

app.get('/api/per-replica-count', async (req, res) => {
    const results = [];
    for (const replica of REPLICAS) {
        results.push(await fetchReplicaStats(replica));
    }
    res.json(results);
});

const httpPostJson = (url, payload, timeout = 3000) => new Promise((resolve, reject) => {
    const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' }
    }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            try {
                resolve({ status: res.statusCode, json: JSON.parse(body) });
            } catch {
                reject(new Error('invalid JSON from ' + url));
            }
        });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.setTimeout(timeout);
    req.end(JSON.stringify(payload));
});

app.post('/api/operations/send-message', async (req, res) => {
    const target = REPLICAS.find(r => r.name === req.body?.replica) || REPLICAS[0];
    try {
        const upstream = await httpPostJson(`${target.url}/send-message`, {
            user: req.body.user, consumer: req.body.consumer, content: req.body.content
        });
        res.status(upstream.status).json({ replica: target.name, ...upstream.json });
    } catch (err) {
        res.status(502).json({ replica: target.name, error: err.message });
    }
});

app.post('/api/operations/create-guest', async (req, res) => {
    const target = REPLICAS.find(r => r.name === req.body?.replica) || REPLICAS[0];
    try {
        const upstream = await httpPostJson(`${target.url}/create-guest`, {});
        res.status(upstream.status).json({ replica: target.name, ...upstream.json });
    } catch (err) {
        res.status(502).json({ replica: target.name, error: err.message });
    }
});

app.get('/api/operations/users', async (req, res) => {
    const target = REPLICAS.find(r => r.name === req.query.replica) || REPLICAS[0];
    try {
        const upstream = await httpGetJson(`${target.url}/users?limit=${req.query.limit || 50}`);
        res.status(upstream.status).json({ replica: target.name, ...upstream.json });
    } catch (err) {
        res.status(502).json({ replica: target.name, error: err.message });
    }
});

const dist = path.resolve(process.env.DIST_DIR || path.join(process.cwd(), '..', 'client', 'dist'));
app.use(express.static(dist));
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Dashboard server running on http://localhost:${PORT}`);
});