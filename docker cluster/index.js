import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';

import { createGuest, getMessageCount, getUsers, sendMessage } from './controller/universalController.js';
import User from './model/user.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/get-message-count', rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: { message: "Too many requests, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
}));

app.use('/send-message', rateLimit({
    windowMs: 1 * 1000,
    max: 10,
    message: { message: "Too many requests, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
}));


app.get('/health', (req, res) => {
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const dbConnected = mongoose.connection.readyState === 1;
    res.status(dbConnected ? 200 : 503).json({
        status: 'UP',
        database: req.query.full ? { state: dbStates[mongoose.connection.readyState] } : (dbConnected ? 'UP' : 'DOWN')
    });
});

app.get('/get-message-count', (req, res) => {
    getMessageCount(req, res);
});

app.get('/users', (req, res) => {
    getUsers(req, res);
});

// POST /create-guest
// Creates a new guest user. No request body required.
// Returns: { message, data: { _id, username, isGuest: true, ... } }
// Client should store the returned data._id and reuse it as `user`.
app.post('/create-guest', (req, res) => {
    createGuest(req, res);
});

// POST /send-message
/* Sends a message from one user to another. Requires a JSON body:
 {
   "user":     "6a7cc432a2b17bffe4ed3535",     
   "consumer": "6a7cc432a2b17bffe4ed3534",   
   "content":  "Hello!"                  
 }
// Returns 201 with { message, data: { _id, user, consumer, content, ... } }
*/
app.post('/send-message', (req, res) => {
    sendMessage(req, res);
});

app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: "Internal server error" });
});

const SEED_USERS = [
    { username: 'alice' },
    { username: 'bob' }
];

const seedUsers = async () => {
    try {
        const count = await User.countDocuments();
        if (count > 0) return;
        await User.create(SEED_USERS);
        console.log('Seeded default users');
    } catch (error) {
        console.error('Failed to seed users:', error.message);
    }
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mydatabase')
    .then(async () => {
        console.log('Connected to MongoDB');
        await seedUsers();
        app.listen(PORT, () => {
            console.log(`Server is running on port http://localhost:${PORT}`);
        });
    })
    .catch(err => console.error('Could not connect to MongoDB', err));