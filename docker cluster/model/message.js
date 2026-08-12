import mongoose from "mongoose";
import User from "./user.js";
const messageSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: User,
        required: true
    },
    consumer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: User,
        required: true
    },
    content: {
        type: String,
        required: true
    }
}, { timestamps: true });

const Message = mongoose.model("Message", messageSchema);

export default Message;