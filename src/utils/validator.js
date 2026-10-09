// src/utils/validator.js
const logger = require('./logger');
const { NICKNAME } = require('./constants');

class Validator {
    // Sanitize and validate confession text
    validateConfession(text) {
        try {
            if (!text || typeof text !== 'string') {
                return {
                    isValid: false,
                    error: 'Confession cannot be empty'
                };
            }

            // Trim whitespace
            let cleaned = text.trim();

            // Check length (minimum 3 characters, maximum 4000)
            if (cleaned.length < 3) {
                return {
                    isValid: false,
                    error: 'Confession is too short (minimum 3 characters)'
                };
            }

            if (cleaned.length > 4000) {
                return {
                    isValid: false,
                    error: 'Confession is too long (maximum 4000 characters)'
                };
            }

            // Remove excessive newlines
            cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

            // Basic spam detection (optional)
            const spamPatterns = [
                /(https?:\/\/[^\s]+)/g,  // URLs
                /(?:^|\s)@\w+/g,          // Mentions
                /(?:^|\s)#\w+/g,          // Hashtags
                /[\u{1F600}-\u{1F6FF}]/gu // Emojis (optional - you might want to keep these)
            ];

            const hasSpam = spamPatterns.some(pattern => pattern.test(cleaned));
            
            return {
                isValid: true,
                cleaned: cleaned,
                hasLinks: hasSpam,
                length: cleaned.length
            };
        } catch (error) {
            logger.error('Validation error:', error);
            return {
                isValid: false,
                error: 'Error validating confession'
            };
        }
    }

    // Validate a nickname (2-20 chars, single line, printable)
    validateNickname(text) {
        try {
            if (!text || typeof text !== 'string') {
                return { isValid: false, error: 'Nickname cannot be empty' };
            }

            // Remove control characters and collapse whitespace
            let cleaned = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');

            if (cleaned.length < NICKNAME.MIN) {
                return { isValid: false, error: `Nickname must be at least ${NICKNAME.MIN} characters` };
            }
            if (cleaned.length > NICKNAME.MAX) {
                return { isValid: false, error: `Nickname must be at most ${NICKNAME.MAX} characters` };
            }

            return { isValid: true, cleaned };
        } catch (error) {
            logger.error('Nickname validation error:', error);
            return { isValid: false, error: 'Error validating nickname' };
        }
    }

    // Validate comment / reply text (plain text, 1-1000 chars)
    validateComment(text) {
        try {
            if (!text || typeof text !== 'string') {
                return { isValid: false, error: 'Comment cannot be empty' };
            }

            const cleaned = text.trim().replace(/\n{3,}/g, '\n\n');

            if (cleaned.length < 1) {
                return { isValid: false, error: 'Comment cannot be empty' };
            }

            if (cleaned.length > 1000) {
                return { isValid: false, error: 'Comment is too long (maximum 1000 characters)' };
            }

            return { isValid: true, cleaned, length: cleaned.length };
        } catch (error) {
            logger.error('Comment validation error:', error);
            return { isValid: false, error: 'Error validating comment' };
        }
    }

    // Validate admin actions
    validateAdminAction(action, data) {
        const validActions = ['approve', 'reject', 'delete', 'info'];
        
        if (!validActions.includes(action)) {
            return {
                isValid: false,
                error: 'Invalid admin action'
            };
        }

        if (!data || !data.confessionId) {
            return {
                isValid: false,
                error: 'Confession ID is required'
            };
        }

        return {
            isValid: true,
            action,
            confessionId: data.confessionId
        };
    }

    // Sanitize input for database
    sanitizeForDb(input) {
        if (typeof input !== 'string') return input;
        
        // Remove any null bytes
        let sanitized = input.replace(/\0/g, '');
        
        // Escape MongoDB operators (optional, depends on your needs)
        sanitized = sanitized.replace(/^\$/, '&#36;');
        
        return sanitized;
    }
}

module.exports = new Validator();