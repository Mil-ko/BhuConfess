// src/services/database.service.js
const Confession = require('../models/Confession.model');
const Comment = require('../models/Comment.model');
const User = require('../models/User.model');
const { NICKNAME } = require('../utils/constants');

const NICKNAME_COOLDOWN_MS = NICKNAME.CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const databaseConnection = require('../config/database');
const logger = require('../utils/logger');
const { STATUS } = require('../utils/constants');
const mongoose = require('mongoose');

class DatabaseService {
    
    // Initialize database connection
    async initialize() {
        return await databaseConnection.connect();
    }

    // Save a new confession
    async saveConfession(confessionData) {
        try {
            // Ensure database is connected
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            // Create new confession document
            const confession = new Confession({
                text: confessionData.text,
                topic: confessionData.topic || 'other',
                authorId: confessionData.authorId || null,
                nickname: confessionData.nickname || null,
                metadata: {
                    hasLinks: confessionData.metadata?.hasLinks || false,
                    messageLength: confessionData.text.length,
                    language: confessionData.metadata?.language || 'unknown'
                }
            });

            // Save to database
            const savedConfession = await confession.save();
            
            logger.info(`✅ Confession saved with ID: ${savedConfession._id}`);
            
            // Return safe object (without internal fields)
            return {
                success: true,
                confession: savedConfession.toSafeObject(),
                id: savedConfession._id
            };

        } catch (error) {
            logger.error('Error saving confession:', error);
            
            // Handle validation errors
            if (error.name === 'ValidationError') {
                const errors = Object.values(error.errors).map(e => e.message);
                return {
                    success: false,
                    error: 'Validation failed',
                    details: errors
                };
            }

            return {
                success: false,
                error: 'Failed to save confession'
            };
        }
    }

    // Get confession by ID
    // includeAuthor: also return the authorId (for decision notifications)
    async getConfessionById(id, includeAuthor = false) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confession = await Confession.findById(id);
            
            if (!confession) {
                return {
                    success: false,
                    error: 'Confession not found'
                };
            }

            return {
                success: true,
                confession: includeAuthor
                    ? confession.toAdminObject()
                    : confession.toSafeObject()
            };

        } catch (error) {
            logger.error('Error fetching confession:', error);
            
            // Handle invalid ID format
            if (error.name === 'CastError') {
                return {
                    success: false,
                    error: 'Invalid confession ID format'
                };
            }

            return {
                success: false,
                error: 'Failed to fetch confession'
            };
        }
    }

    // Get pending confessions (for admin)
    async getPendingConfessions(limit = 10) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confessions = await Confession.findPending();
            
            return {
                success: true,
                count: confessions.length,
                confessions: confessions.map(c => c.toSafeObject())
            };

        } catch (error) {
            logger.error('Error fetching pending confessions:', error);
            return {
                success: false,
                error: 'Failed to fetch pending confessions'
            };
        }
    }

    // Get confession status (without revealing content)
    async getConfessionStatus(id) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confession = await Confession.findById(id).select('status createdAt metadata.messageLength');
            
            if (!confession) {
                return {
                    success: false,
                    error: 'Confession not found'
                };
            }

            return {
                success: true,
                status: confession.status,
                submittedAt: confession.createdAt,
                length: confession.metadata?.messageLength
            };

        } catch (error) {
            logger.error('Error fetching confession status:', error);
            return {
                success: false,
                error: 'Failed to fetch status'
            };
        }
    }

    // Update confession status (for admin)
    async updateConfessionStatus(id, status, adminId, reason = null) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            // Validate status
            if (!Object.values(STATUS).includes(status)) {
                return {
                    success: false,
                    error: 'Invalid status'
                };
            }

            const confession = await Confession.findById(id);
            
            if (!confession) {
                return {
                    success: false,
                    error: 'Confession not found'
                };
            }

            // Update status and admin info
            confession.status = status;
            confession.adminAction = {
                performedBy: adminId,
                performedAt: new Date(),
                reason: reason
            };

            await confession.save();

            logger.info(`Confession ${id} updated to status: ${status}`);

            return {
                success: true,
                confession: confession.toSafeObject()
            };

        } catch (error) {
            logger.error('Error updating confession status:', error);
            return {
                success: false,
                error: 'Failed to update confession status'
            };
        }
    }

    // Get database stats
    async getStats() {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const stats = {
                total: await Confession.countDocuments(),
                pending: await Confession.countDocuments({ status: STATUS.PENDING }),
                approved: await Confession.countDocuments({ status: STATUS.APPROVED }),
                rejected: await Confession.countDocuments({ status: STATUS.REJECTED })
            };

            return {
                success: true,
                stats
            };

        } catch (error) {
            logger.error('Error getting stats:', error);
            return {
                success: false,
                error: 'Failed to get stats'
            };
        }
    }

    // Check database health
    async healthCheck() {
        try {
            const status = databaseConnection.getConnectionStatus();
            
            // Try to execute a simple command to verify connection
            if (status.isConnected) {
                await mongoose.connection.db.admin().ping();
                status.dbStatus = 'healthy';
            } else {
                status.dbStatus = 'disconnected';
            }

            return status;

        } catch (error) {
            logger.error('Database health check failed:', error);
            return {
                isConnected: false,
                dbStatus: 'unhealthy',
                error: error.message
            };
        }
    }
    // Add to existing DatabaseService class in database.service.js

    // Get approved confessions
    async getApprovedConfessions(limit = 10) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confessions = await Confession.find({ status: STATUS.APPROVED })
                .sort({ createdAt: -1 })
                .limit(limit);

            return {
                success: true,
                count: confessions.length,
                confessions: confessions.map(c => c.toSafeObject())
            };

        } catch (error) {
            logger.error('Error fetching approved confessions:', error);
            return {
                success: false,
                error: 'Failed to fetch approved confessions'
            };
        }
    }

    // Get rejected confessions
    async getRejectedConfessions(limit = 10) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confessions = await Confession.find({ status: STATUS.REJECTED })
                .sort({ createdAt: -1 })
                .limit(limit);

            return {
                success: true,
                count: confessions.length,
                confessions: confessions.map(c => c.toSafeObject())
            };

        } catch (error) {
            logger.error('Error fetching rejected confessions:', error);
            return {
                success: false,
                error: 'Failed to fetch rejected confessions'
            };
        }
    }

    // Get all confessions with pagination
    async getAllConfessions(limit = 10, page = 1) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const skip = (page - 1) * limit;

            const confessions = await Confession.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            const total = await Confession.countDocuments();

            return {
                success: true,
                count: confessions.length,
                total: total,
                page: page,
                pages: Math.ceil(total / limit),
                confessions: confessions.map(c => c.toSafeObject())
            };

        } catch (error) {
            logger.error('Error fetching all confessions:', error);
            return {
                success: false,
                error: 'Failed to fetch confessions'
            };
        }
    }

    // Delete confession (admin only)
    async deleteConfession(id, adminId) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confession = await Confession.findById(id);
            
            if (!confession) {
                return {
                    success: false,
                    error: 'Confession not found'
                };
            }

            await confession.deleteOne();
            
            logger.info(`Confession ${id} deleted by admin ${adminId}`);

            return {
                success: true,
                message: 'Confession deleted successfully'
            };

        } catch (error) {
            logger.error('Error deleting confession:', error);
            return {
                success: false,
                error: 'Failed to delete confession'
            };
        }
    }
    // Add to DatabaseService class

    // Update confession with channel post info
    async updateChannelPostInfo(id, messageId, postedAt) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confession = await Confession.findById(id);
            
            if (!confession) {
                return {
                    success: false,
                    error: 'Confession not found'
                };
            }

            confession.channelPostId = messageId;
            confession.channelPostedAt = postedAt;

            await confession.save();

            logger.info(`Confession ${id} marked as posted to channel`);

            return {
                success: true,
                confession: confession.toSafeObject()
            };

        } catch (error) {
            logger.error('Error updating channel post info:', error);
            return {
                success: false,
                error: 'Failed to update channel post info'
            };
        }
    }

    // Get confessions posted to channel
    async getPostedConfessions(limit = 20) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confessions = await Confession.find({
                channelPostId: { $ne: null }
            })
                .sort({ channelPostedAt: -1 })
                .limit(limit);

            return {
                success: true,
                count: confessions.length,
                confessions: confessions.map(c => c.toSafeObject())
            };

        } catch (error) {
            logger.error('Error fetching posted confessions:', error);
            return {
                success: false,
                error: 'Failed to fetch posted confessions'
            };
        }
    }
    // Add to DatabaseService class in database.service.js

    // Update confession with channel post info
    async updateChannelPostInfo(id, messageId, postedAt) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confession = await Confession.findById(id);
            
            if (!confession) {
                return {
                    success: false,
                    error: 'Confession not found'
                };
            }

            confession.channelPostId = messageId;
            confession.channelPostedAt = postedAt;

            await confession.save();

            logger.info(`Confession ${id} marked as posted to channel`);

            return {
                success: true,
                confession: confession.toSafeObject()
            };

        } catch (error) {
            logger.error('Error updating channel post info:', error);
            return {
                success: false,
                error: 'Failed to update channel post info'
            };
        }
    }

    // Get confessions posted to channel
    async getPostedConfessions(limit = 20) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confessions = await Confession.findPosted(limit);

            return {
                success: true,
                count: confessions.length,
                confessions: confessions.map(c => c.toSafeObject())
            };

        } catch (error) {
            logger.error('Error fetching posted confessions:', error);
            return {
                success: false,
                error: 'Failed to fetch posted confessions'
            };
        }
    }

    // Get confession by channel message ID
    async getConfessionByChannelPostId(messageId) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const confession = await Confession.findOne({ channelPostId: messageId });
            
            if (!confession) {
                return {
                    success: false,
                    error: 'Confession not found'
                };
            }

            return {
                success: true,
                confession: confession.toSafeObject()
            };

        } catch (error) {
            logger.error('Error fetching confession by channel post ID:', error);
            return {
                success: false,
                error: 'Failed to fetch confession'
            };
        }
    }
    // ── Comments (only ever shown inside the bot, never posted) ──────

    // Create a comment or a one-level reply
    async createComment({ confessionId, authorId, nickname = null, text, parentCommentId = null, replyToCommentId = null }) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const comment = new Comment({
                confessionId,
                authorId: authorId || null,
                nickname: nickname || null,
                text,
                parentCommentId: parentCommentId || null,
                replyToCommentId: replyToCommentId || null
            });

            const saved = await comment.save();
            logger.info(`💬 Comment saved for confession ${confessionId}`);

            return { success: true, comment: saved.toSafeObject() };
        } catch (error) {
            logger.error('Error saving comment:', error);
            if (error.name === 'ValidationError') {
                const errors = Object.values(error.errors).map(e => e.message);
                return { success: false, error: errors.join(', ') };
            }
            return { success: false, error: 'Failed to save comment' };
        }
    }

    // All comments for a confession, oldest first (pagination happens above)
    // includeAuthor: keep authorId so the viewer can resolve one stable display
    // name per person across the whole discussion.
    async getComments(confessionId, includeAuthor = false) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const comments = await Comment.find({ confessionId })
                .sort({ createdAt: 1 })
                .limit(500);

            return {
                success: true,
                comments: comments.map(c => (includeAuthor
                    ? (() => { const obj = c.toObject(); delete obj.__v; return obj; })()
                    : c.toSafeObject()))
            };
        } catch (error) {
            logger.error('Error fetching comments:', error);
            return { success: false, error: 'Failed to fetch comments' };
        }
    }

    // Current nicknames for a set of telegram ids → { id: nickname|null }
    // Used to keep one person's name consistent across a whole discussion.
    async getNicknames(telegramIds = []) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const ids = [...new Set((telegramIds || []).filter(Boolean).map(String))];
            if (!ids.length) return { success: true, nicknames: {} };

            const users = await User.find({ telegramId: { $in: ids } }).select('telegramId nickname');
            const nicknames = {};
            for (const user of users) {
                nicknames[String(user.telegramId)] = user.nickname || null;
            }
            return { success: true, nicknames };
        } catch (error) {
            logger.error('Error fetching nicknames:', error);
            return { success: false, nicknames: {} };
        }
    }

    // Toggle one reaction from one user on one comment.
    // → { success, comment, reacted, counts }
    async toggleReaction(commentId, telegramId, key) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const comment = await Comment.findById(commentId);
            if (!comment) {
                return { success: false, error: 'Comment not found' };
            }

            const bucket = comment.reactions[key] || [];
            const userId = String(telegramId);
            const existing = bucket.indexOf(userId);
            const reacted = existing === -1;

            if (reacted) bucket.push(userId);
            else bucket.splice(existing, 1);

            comment.reactions[key] = bucket;
            comment.markModified(`reactions.${key}`);
            await comment.save();

            return { success: true, comment: comment.toObject(), reacted, counts: comment.reactionCounts() };
        } catch (error) {
            logger.error('Error toggling reaction:', error);
            if (error.name === 'CastError') {
                return { success: false, error: 'Invalid comment ID' };
            }
            return { success: false, error: 'Failed to save reaction' };
        }
    }

    // Single comment (needed to resolve reply targets)
    // includeAuthor: also return authorId (for reply notifications)
    async getCommentById(id, includeAuthor = false) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const comment = await Comment.findById(id);
            if (!comment) {
                return { success: false, error: 'Comment not found' };
            }
            if (includeAuthor) {
                const obj = comment.toObject();
                delete obj.__v;
                return { success: true, comment: obj };
            }
            return { success: true, comment: comment.toSafeObject() };
        } catch (error) {
            logger.error('Error fetching comment:', error);
            if (error.name === 'CastError') {
                return { success: false, error: 'Invalid comment ID' };
            }
            return { success: false, error: 'Failed to fetch comment' };
        }
    }

    // ── Profile stats ───────────────────────────────────────────────────

    // ── Nicknames ───────────────────────────────────────────────

    // { nickname, canChange, retryAt }
    async getNicknameState(telegramId) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const user = await User.findOne({ telegramId: String(telegramId) });
            if (!user || !user.nickname) {
                return { nickname: null, canChange: true, retryAt: null };
            }

            if (!user.nicknameChangedAt) {
                // First set never started a cooldown - a change is allowed now
                return { nickname: user.nickname, canChange: true, retryAt: null };
            }

            const elapsed = Date.now() - user.nicknameChangedAt.getTime();
            if (elapsed >= NICKNAME_COOLDOWN_MS) {
                return { nickname: user.nickname, canChange: true, retryAt: null };
            }

            return {
                nickname: user.nickname,
                canChange: false,
                retryAt: new Date(user.nicknameChangedAt.getTime() + NICKNAME_COOLDOWN_MS)
            };
        } catch (error) {
            logger.error('Error getting nickname state:', error);
            return { nickname: null, canChange: false, retryAt: null };
        }
    }

    async getNickname(telegramId) {
        const state = await this.getNicknameState(telegramId);
        return state.nickname;
    }

    // Save a nickname, enforcing the change cooldown.
    // First-ever save is free; every later change starts a 14-day cooldown.
    // → { success, nickname } or { success:false, error, retryAt }
    async setNickname(telegramId, nickname) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const id = String(telegramId);
            const state = await this.getNicknameState(id);

            if (state.nickname && !state.canChange) {
                return { success: false, error: 'cooldown', retryAt: state.retryAt };
            }

            const isFirstSet = !state.nickname;
            const update = { nickname };
            if (!isFirstSet) {
                update.nicknameChangedAt = new Date(); // start the cooldown
            }

            const user = await User.findOneAndUpdate(
                { telegramId: id },
                { $set: update },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            logger.info(`📛 Nickname ${isFirstSet ? 'set' : 'changed'} for ${id}`);
            return { success: true, nickname: user.nickname };
        } catch (error) {
            logger.error('Error setting nickname:', error);
            return { success: false, error: 'save failed' };
        }
    }

    /* ── Paginated lists & activity for the redesigned UI ──────── */

    // One page of confessions by status (null = every status).
    async getConfessionsPage(status, limit = 4, page = 0) {
        try {
            if (!databaseConnection.isConnected) await this.initialize();

            const filter = status ? { status } : {};
            const skip = Math.max(0, page) * limit;
            const [confessions, total] = await Promise.all([
                Confession.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
                Confession.countDocuments(filter)
            ]);

            return { success: true, total, confessions: confessions.map(c => c.toSafeObject()) };
        } catch (error) {
            logger.error('Error fetching confession page:', error);
            return { success: false, total: 0, confessions: [] };
        }
    }

    // A reader's own confessions, newest first.
    async getConfessionsByAuthor(authorId, limit = 4, page = 0) {
        try {
            if (!databaseConnection.isConnected) await this.initialize();

            const filter = { authorId: String(authorId) };
            const skip = Math.max(0, page) * limit;
            const [confessions, total] = await Promise.all([
                Confession.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
                Confession.countDocuments(filter)
            ]);

            return { success: true, total, confessions: confessions.map(c => c.toSafeObject()) };
        } catch (error) {
            logger.error('Error fetching author confessions:', error);
            return { success: false, total: 0, confessions: [] };
        }
    }

    // A reader's own comments (and replies), newest first, each annotated with
    // the text of the confession it belongs to.
    async getCommentsByAuthor(authorId, limit = 4, page = 0) {
        try {
            if (!databaseConnection.isConnected) await this.initialize();

            const filter = { authorId: String(authorId) };
            const skip = Math.max(0, page) * limit;
            const [comments, total] = await Promise.all([
                Comment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
                Comment.countDocuments(filter)
            ]);

            const ids = [...new Set(comments.map(c => String(c.confessionId)))];
            const confessions = ids.length
                ? await Confession.find({ _id: { $in: ids } }).select('text')
                : [];
            const texts = new Map(confessions.map(c => [String(c._id), c.text]));

            return {
                success: true,
                total,
                comments: comments.map(c => ({
                    ...c.toSafeObject(),
                    confessionText: texts.get(String(c.confessionId)) || null
                }))
            };
        } catch (error) {
            logger.error('Error fetching author comments:', error);
            return { success: false, total: 0, comments: [] };
        }
    }

    // { confessionId: commentCount } for a set of confessions.
    async getCommentCounts(confessionIds = []) {
        try {
            if (!databaseConnection.isConnected) await this.initialize();

            const ids = [...new Set(confessionIds.map(String))]
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
            if (!ids.length) return { success: true, counts: {} };

            const rows = await Comment.aggregate([
                { $match: { confessionId: { $in: ids } } },
                { $group: { _id: '$confessionId', n: { $sum: 1 } } }
            ]);

            const counts = {};
            for (const row of rows) counts[String(row._id)] = row.n;
            return { success: true, counts };
        } catch (error) {
            logger.error('Error counting comments:', error);
            return { success: false, counts: {} };
        }
    }

    // Everything the "My Activity" screen shows, in one round trip.
    async getAuthorActivity(authorId) {
        try {
            if (!databaseConnection.isConnected) await this.initialize();

            const id = String(authorId);
            const [submitted, approved, pending, rejected, comments, replies, own] = await Promise.all([
                Confession.countDocuments({ authorId: id }),
                Confession.countDocuments({ authorId: id, status: STATUS.APPROVED }),
                Confession.countDocuments({ authorId: id, status: STATUS.PENDING }),
                Confession.countDocuments({ authorId: id, status: STATUS.REJECTED }),
                Comment.countDocuments({ authorId: id, parentCommentId: null }),
                Comment.countDocuments({ authorId: id, parentCommentId: { $ne: null } }),
                Comment.find({ authorId: id }).select('reactions')
            ]);

            const reactions = own.reduce((sum, comment) => {
                const store = comment.reactions || {};
                return sum + ['heart', 'laugh', 'fire', 'like']
                    .reduce((inner, key) => inner + ((store[key] || []).length), 0);
            }, 0);

            return { success: true, submitted, approved, pending, rejected, comments, replies, reactions };
        } catch (error) {
            logger.error('Error fetching author activity:', error);
            return { success: false, submitted: 0, approved: 0, pending: 0, rejected: 0, comments: 0, replies: 0, reactions: 0 };
        }
    }

    // Numbers for the admin "User Statistics" screen.
    async getUserStats() {
        try {
            if (!databaseConnection.isConnected) await this.initialize();

            const [users, nicknames, comments] = await Promise.all([
                User.countDocuments(),
                User.countDocuments({ nickname: { $ne: null } }),
                Comment.countDocuments()
            ]);

            const perAuthor = await Confession.aggregate([
                { $match: { authorId: { $ne: null } } },
                { $group: { _id: '$authorId', n: { $sum: 1 } } },
                { $sort: { n: -1 } }
            ]);

            const reactionAgg = await Comment.aggregate([
                {
                    $project: {
                        heart: { $size: { $ifNull: ['$reactions.heart', []] } },
                        laugh: { $size: { $ifNull: ['$reactions.laugh', []] } },
                        fire: { $size: { $ifNull: ['$reactions.fire', []] } },
                        like: { $size: { $ifNull: ['$reactions.like', []] } }
                    }
                },
                { $group: { _id: null, total: { $sum: { $add: ['$heart', '$laugh', '$fire', '$like'] } } } }
            ]);

            const totalAuthored = perAuthor.reduce((sum, row) => sum + row.n, 0);
            const average = perAuthor.length ? (totalAuthored / perAuthor.length).toFixed(1) : '0';

            const top = perAuthor.slice(0, 5);
            const topUsers = top.length
                ? await User.find({ telegramId: { $in: top.map(row => String(row._id)) } }).select('telegramId nickname')
                : [];
            const nickById = new Map(topUsers.map(u => [String(u.telegramId), u.nickname]));

            return {
                success: true,
                users,
                nicknames,
                comments,
                reactions: (reactionAgg[0] && reactionAgg[0].total) || 0,
                average,
                top: top.map((row, i) => ({
                    rank: i + 1,
                    name: nickById.get(String(row._id)) || `Anon #${i + 1}`,
                    count: row.n
                }))
            };
        } catch (error) {
            logger.error('Error fetching user stats:', error);
            return { success: false, users: 0, nicknames: 0, comments: 0, reactions: 0, average: '0', top: [] };
        }
    }

    async getAuthorStats(authorId) {
        try {
            if (!databaseConnection.isConnected) {
                await this.initialize();
            }

            const submitted = await Confession.countDocuments({ authorId: String(authorId) });
            const approved = await Confession.countDocuments({
                authorId: String(authorId),
                status: STATUS.APPROVED
            });

            return { success: true, submitted, approved };
        } catch (error) {
            logger.error('Error getting author stats:', error);
            return { success: false, error: 'Failed to get stats' };
        }
    }
}

module.exports = new DatabaseService();