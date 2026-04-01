// src/services/database.service.js
const Confession = require('../models/Confession.model');
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
    async getConfessionById(id) {
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
                confession: confession.toSafeObject()
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
}

module.exports = new DatabaseService();