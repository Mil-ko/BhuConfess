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
    // Nesting stays exactly one level deep: a reply is ALWAYS attached to the
    // thread's top-level comment, even when the user tapped "Reply" on one of
    // its replies.
    parentCommentId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true
    },

    // The specific comment the author answered. Only set when it differs from
    // parentCommentId (i.e. replying to a reply) - it drives the "X replied to
    // your comment" notification and the reply context screen, without
    // changing the (one-level) parent link above.
    replyToCommentId: {
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
    },

    // One Telegram id array per reaction. Storing ids (not a counter) makes the
    // buttons toggleable per user and impossible to inflate by tapping twice.
    // Documents written before reactions existed simply read back as empty.
    reactions: {
        heart: { type: [String], default: [] },
        laugh: { type: [String], default: [] },
        fire: { type: [String], default: [] },
        like: { type: [String], default: [] }
    }
}, {
    timestamps: true
});

// Method to safely return comment data (without internal fields)
// NOTE: reaction arrays hold Telegram ids. They are only ever turned into
// counts server-side before anything is rendered.
commentSchema.methods.toSafeObject = function() {
    const obj = this.toObject();
    delete obj.__v;
    delete obj.authorId;
    return obj;
};

// Reaction counts per key, with the empty defaults applied for old documents.
commentSchema.methods.reactionCounts = function() {
    const store = this.reactions || {};
    const counts = {};
    Object.keys(store.toObject ? store.toObject() : store).forEach((key) => {
        const ids = store[key] || [];
        counts[key] = ids.length;
    });
    return counts;
};

module.exports = mongoose.model('Comment', commentSchema);
