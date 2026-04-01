// src/models/Confession.model.js
const mongoose = require('mongoose');
const { STATUS } = require('../utils/constants');

// Define the confession schema
const confessionSchema = new mongoose.Schema({
    // The actual confession text
    text: {
        type: String,
        required: [true, 'Confession text is required'],
        trim: true,
        minlength: [3, 'Confession must be at least 3 characters long'],
        maxlength: [4000, 'Confession cannot exceed 4000 characters']
    },

    // Status of the confession
    status: {
        type: String,
        enum: Object.values(STATUS),
        default: STATUS.PENDING,
        index: true // Add index for faster queries
    },

    // Metadata (completely anonymous - no user IDs)
    metadata: {
        hasLinks: {
            type: Boolean,
            default: false
        },
        messageLength: {
            type: Number,
            required: true
        },
        language: {
            type: String,
            default: 'unknown'
        }
    },

    // Admin actions
    adminAction: {
        performedBy: {
            type: String,
            default: null
        },
        performedAt: {
            type: Date,
            default: null
        },
        reason: {
            type: String,
            default: null
        }
    },

    // For channel post reference
    channelPostId: {
        type: String,
        default: null,
        index: true
    },
    channelPostedAt: {
        type: Date,
        default: null
    },
    channelPostUrl: {
        type: String,
        default: null
    }
}, {
    // Automatically add createdAt and updatedAt fields
    timestamps: true
});

// Add text index for search functionality (optional)
confessionSchema.index({ text: 'text' });

// Virtual for formatted date
confessionSchema.virtual('formattedDate').get(function() {
    return this.createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
});

// Method to safely return confession data (without internal fields)
confessionSchema.methods.toSafeObject = function() {
    const obj = this.toObject();
    delete obj.__v;
    delete obj.adminAction;
    return obj;
};

// Static method to find pending confessions
confessionSchema.statics.findPending = function() {
    return this.find({ status: STATUS.PENDING })
        .sort({ createdAt: -1 })
        .limit(50);
};

// Static method to find approved confessions
confessionSchema.statics.findApproved = function(limit = 20) {
    return this.find({ status: STATUS.APPROVED })
        .sort({ createdAt: -1 })
        .limit(limit);
};

// Static method to find confessions posted to channel
confessionSchema.statics.findPosted = function(limit = 20) {
    return this.find({ channelPostId: { $ne: null } })
        .sort({ channelPostedAt: -1 })
        .limit(limit);
};

// Pre-save middleware to ensure data quality
confessionSchema.pre('save', function(next) {
    // Ensure text is properly trimmed
    if (this.text) {
        this.text = this.text.trim();
    }
    
    // Update metadata if not set
    if (!this.metadata.messageLength) {
        this.metadata.messageLength = this.text.length;
    }
    
    next();
});

// Create the model
const Confession = mongoose.model('Confession', confessionSchema);

module.exports = Confession;