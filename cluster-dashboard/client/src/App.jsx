import React, { useEffect, useState, useCallback } from 'react';
import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
    BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';

const POLL_MS = 5000;

const api = async (path, options) => {
    const res = await fetch(`/api${path}`, options);
    return res.json();
};

function ReplicaCards({ replicas }) {
    if (!replicas) return null;
    return (
        <div className="card-grid">
            {replicas.map(r => (
                <div key={r.name} className={`card replica ${r.up ? 'up' : 'down'}`}>
                    <div className="card-title">{r.name}</div>
                    <div className={`pulse ${r.up ? 'pulse-up' : 'pulse-down'}`} />
                    <div className="metric">Status: {r.up ? 'UP' : 'DOWN'}</div>
                    <div className="metric">DB: {r.database}</div>
                    <div className="metric">Latency: {r.latencyMs} ms</div>
                    {r.error && <div className="metric error-text">{r.error}</div>}
                </div>
            ))}
        </div>
    );
}

function OperationsPanel({ replicas }) {
    const [replica, setReplica] = useState('');
    const [result, setResult] = useState(null);
    const [form, setForm] = useState({ user: '', consumer: '', content: '' });

    const run = async (endpoint, options) => {
        setResult({ loading: true });
        try {
            const res = await api(`/operations/${endpoint}`, options);
            setResult(res);
        } catch (err) {
            setResult({ error: err.message });
        }
    };

    return (
        <div className="card">
            <div className="card-title">Operations</div>
            <div className="row">
                <select value={replica} onChange={e => setReplica(e.target.value)}>
                    <option value="">target replica…</option>
                    {replicas?.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
                </select>
                <button onClick={() => run('create-guest', { method: 'POST', body: JSON.stringify({ replica }), headers: { 'Content-Type': 'application/json' } })}>Create Guest</button>
                <button onClick={() => run('users?replica=' + replica)}>Get Users</button>
            </div>
            <div className="row">
                <input placeholder="user _id" value={form.user} onChange={e => setForm({ ...form, user: e.target.value })} />
                <input placeholder="consumer _id" value={form.consumer} onChange={e => setForm({ ...form, consumer: e.target.value })} />
                <input placeholder="content" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
                <button onClick={() => run('send-message', { method: 'POST', body: JSON.stringify({ ...form, replica }), headers: { 'Content-Type': 'application/json' } })}>Send Message</button>
            </div>
            {result && <pre className="result">{JSON.stringify(result, null, 2)}</pre>}
        </div>
    );
}

function MongoStats({ stats }) {
    if (!stats) return null;
    const counts = stats.counts || {};
    const pieData = [
        { name: 'Messages', value: counts.messages || 0 },
        { name: 'Users', value: counts.users || 0 }
    ];
    return (
        <div className="card">
            <div className="card-title">MongoDB — {stats.database}</div>
            <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label>
                        {pieData.map((_, i) => <Cell key={i} fill={['#4facfe', '#43e97b'][i]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}

function RedisPanel({ redis }) {
    if (!redis) return null;
    return (
        <div className="card">
            <div className="card-title">Redis {redis.connected ? '— connected' : '— DOWN'}</div>
            {redis.connected ? (
                <>
                    <div className="metric">messageCount (cache): {redis.messageCount}</div>
                    <div className="metric">TTL: {redis.ttl}s</div>
                    <div className="metric">Total keys: {redis.totalKeys}</div>
                    <div className="metric">Version: {redis.version} · Memory: {redis.usedMemoryMb} MB</div>
                </>
            ) : (
                <div className="metric error-text">{redis.error}</div>
            )}
        </div>
    );
}

function PerReplicaChart({ data }) {
    if (!data) return null;
    const rows = data.map(r => ({ name: r.name, count: r.count ?? 0, cached: r.cached ? 'cache' : 'mongo' }));
    return (
        <div className="card">
            <div className="card-title">Message count seen by each replica</div>
            <ResponsiveContainer width="100%" height={220}>
                <BarChart data={rows}>
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#f7971e" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function App() {
    const [health, setHealth] = useState(null);
    const [stats, setStats] = useState(null);
    const [redis, setRedis] = useState(null);
    const [perReplica, setPerReplica] = useState(null);
    const [history, setHistory] = useState([]);

    const refresh = useCallback(async () => {
        try {
            const [h, s, r, p] = await Promise.all([
                api('/health'), api('/stats'), api('/redis'), api('/per-replica-count')
            ]);
            setHealth(h); setStats(s); setRedis(r); setPerReplica(p);
            const snapshot = { t: new Date().toLocaleTimeString(), up: h.summary?.up ?? 0, total: h.summary?.total ?? 0 };
            setHistory(prev => [...prev.slice(-59), snapshot]);
        } catch (err) {
            console.error(err);
        }
    }, []);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, POLL_MS);
        return () => clearInterval(id);
    }, [refresh]);

    return (
        <div className="app">
            <header>
                <h1>Docker Cluster Dashboard</h1>
                <span className="subtitle">app replicas · MongoDB · Redis</span>
                <button onClick={refresh} className="refresh">Refresh</button>
            </header>

            <section className="summary-row">
                <div className="card summary">
                    <span className="big">{health?.summary?.total ?? 0}</span>
                    <span>replicas</span>
                </div>
                <div className="card summary up-bg">
                    <span className="big">{health?.summary?.up ?? 0}</span>
                    <span>healthy</span>
                </div>
                <div className="card summary">
                    <span className="big">{health?.summary?.avgLatencyMs ?? 0}ms</span>
                    <span>avg latency</span>
                </div>
                <div className="card summary">
                    <span className="big">{redis?.messageCount ?? '—'}</span>
                    <span>cached msg count</span>
                </div>
            </section>

            <ReplicaCards replicas={health?.replicas} />

            <section className="grid-2">
                <div className="card">
                    <div className="card-title">Replica health over time</div>
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={history}>
                            <XAxis dataKey="t" />
                            <YAxis domain={[0, 'dataMax']} allowDecimals={false} />
                            <Tooltip />
                            <Line type="monotone" dataKey="up" stroke="#43e97b" dot={false} />
                            <Line type="monotone" dataKey="total" stroke="#4facfe" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <PerReplicaChart data={perReplica} />
            </section>

            <section className="grid-2">
                <MongoStats stats={stats} />
                <RedisPanel redis={redis} />
            </section>

            <OperationsPanel replicas={health?.replicas} />
        </div>
    );
}

export default App;