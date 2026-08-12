import User from "../model/user.js";
import Message from "../model/message.js";
import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MESSAGE_COUNT_KEY = 'messageCount';
const MESSAGE_COUNT_TTL = 60;

const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('Redis error:', err.message));
redisClient.connect().catch((err) => console.error('Redis connect failed (will retry in background):', err.message));

const USERNAME_RETRIES = 5;

const generateGuestUsername = () => `guest_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const getCachedCount = async () => {
    try {
        if (redisClient.isOpen) {
            const cached = await redisClient.get(MESSAGE_COUNT_KEY);
            if (cached !== null) return { count: parseInt(cached), fromCache: true };
        }
    } catch (err) {
        console.error('Redis get failed:', err.message);
    }
    return null;
}

const setCachedCount = async (count) => {
    try {
        if (redisClient.isOpen) {
            await redisClient.set(MESSAGE_COUNT_KEY, count, { EX: MESSAGE_COUNT_TTL });
        }
    } catch (err) {
        console.error('Redis set failed:', err.message);
    }
}

const incrementCachedCount = async () => {
    try {
        if (!redisClient.isOpen) return;
        const count = await Message.countDocuments();
        const exists = await redisClient.exists(MESSAGE_COUNT_KEY);
        if (exists) {
            await redisClient.incr(MESSAGE_COUNT_KEY);
        } else {
            await setCachedCount(count);
        }
    } catch (err) {
        console.error('Redis incr failed:', err.message);
    }
}

const createGuestUser = async () => {
    for (let attempt = 0; attempt < USERNAME_RETRIES; attempt++) {
        try {
            const guest = new User({ username: generateGuestUsername(), isGuest: true });
            return await guest.save();
        } catch (error) {
            if (error.code !== 11000 || attempt === USERNAME_RETRIES - 1) throw error;
        }
    }
}

export const createGuest = async (req, res) => {
    try {
        const savedGuest = await createGuestUser();
        return res.status(201).json({ message: "Guest created successfully", data: savedGuest });
    } catch (error) {
        return res.status(500).json({ message: "Error creating guest", error: error.message });
    }
}

export const sendMessage = async (req, res) => {
    if (!req.body.user || !req.body.consumer || !req.body.content) {
        return res.status(400).json({ message: "User, consumer, and content are required." });
    }

    try {
        const user = await User.findById(req.body.user);
        const consumer = await User.findById(req.body.consumer);
        if (!user || !consumer) {
            return res.status(404).json({ message: "User or consumer not found." });
        }
        if (user._id.equals(consumer._id)) {
            return res.status(400).json({ message: "User and consumer cannot be the same." });
        }

        const message = new Message({
            user: user._id,
            consumer: consumer._id,
            content: req.body.content
        });

        const savedMessage = await message.save();
        if (!savedMessage) {
            return res.status(500).json({ message: "Failed to save message." });
        }
        await incrementCachedCount();
        return res.status(201).json({ message: "Message sent successfully", data: savedMessage });
    } catch (error) {
        return res.status(500).json({ message: "Error sending message", error: error.message });
    }
}

export const getMessageCount = async (req, res) => {
    try {
        const cached = await getCachedCount();
        if (cached) {
            return res.status(200).json({
                message: "Message count retrieved successfully",
                data: { ...cached }
            });
        }

        const count = await Message.countDocuments();
        await setCachedCount(count);
        return res.status(200).json({ message: "Message count retrieved successfully", data: { count, fromCache: false } });
    } catch (error) {
        return res.status(500).json({ message: "Error retrieving message count", error: error.message });
    }
}

export const getUsers = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const users = await User.find().sort({ createdAt: -1 }).limit(limit);
        return res.status(200).json({ message: "Users retrieved successfully", data: { count: users.length, users } });
    } catch (error) {
        return res.status(500).json({ message: "Error retrieving users", error: error.message });
    }
}