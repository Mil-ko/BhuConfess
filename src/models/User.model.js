// src/models/User.model.js
const mongoose = require('mongoose');

// Lightweight per-user profile. Holds only what the bot needs: the nickname
// that is publicly displayed and when it was last changed (cooldown).
const userSchema = new mongoose.Schema({
    // Telegram user id as a string (kept separate from document ids)
    telegramId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Nickname shown with the user's confessions/comments instead of
    // "Anonymous". null until the user picks one.
    nickname: {
        type: String,
        default: null,
        trim: true,
        maxlength: 20
    },

    // When the nickname was last CHANGED (the very first set does not start
    // the cooldown, so a typo right after onboarding can be fixed).
    nicknameChangedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
