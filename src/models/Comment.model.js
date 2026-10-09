// src/models/Comment.model.js
const mongoose = require('mongoose');

// A comment (or a one-level reply) on an approved confession.
// Comments are ONLY ever shown inside the bot - never posted to the channel.
const commentSchema = new mongoose.Schema({
    // Which confession this comment belongs to (always the root confession,
    // even for replies).
    confessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Confession',
        required: true,
        index: true
    },

    // Parent comment id for replies. null for top-level comments.
    // v1 supports exactly one level of replies (reply to a top-level comment).
    parentCommentId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true
    },

    // Telegram ID of the commenter (kept separate from content).
    authorId: {
        type: String,
        default: null,
        index: true
    },

    // Public nickname snapshot at comment time (null → shown without name).
    nickname: {
        type: String,
        default: null
    },

    text: {
        type: String,
        required: [true, 'Comment text is required'],
        trim: true,
        minlength: [1, 'Comment cannot be empty'],
        maxlength: [1000, 'Comment cannot exceed 1000 characters']
    }
}, {
    timestamps: true
});

// Method to safely return comment data (without internal fields)
commentSchema.methods.toSafeObject = function() {
    const obj = this.toObject();
    delete obj.__v;
    delete obj.authorId;
    return obj;
};

module.exports = mongoose.model('Comment', commentSchema);
