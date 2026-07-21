const admin = require('../config/firebase');

const sendPushNotification = async (tokens, title, body, data = {}, imageUrl = null) => {
    if (!tokens || tokens.length === 0) return { failureCount: 0, successCount: 0 };

    // Remove duplicates
    const uniqueTokens = [...new Set(tokens)];

    const message = {
        notification: {
            title,
            body,
        },
        data: data || {},
        tokens: uniqueTokens,
    };

    if (imageUrl) {
        message.notification.imageUrl = imageUrl;
        // Android specific
        message.android = {
            notification: {
                image: imageUrl
            }
        };
        // Apple specific
        message.apns = {
            payload: {
                aps: {
                    'mutable-content': 1
                }
            },
            fcm_options: {
                image: imageUrl
            }
        };
    }

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(response.successCount + ' messages were sent successfully');
        
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(uniqueTokens[idx]);
                }
            });
            console.log('List of tokens that caused failures: ' + failedTokens);
        }

        return response;
    } catch (error) {
        console.error('Error sending push notification:', error);
        throw error;
    }
};

const sendTopicNotification = async (topic, title, body, data = {}, imageUrl = null) => {
    const message = {
        notification: {
            title,
            body,
        },
        data: data || {},
        topic: topic,
    };

    if (imageUrl) {
        message.notification.imageUrl = imageUrl;
        message.android = { notification: { image: imageUrl } };
        message.apns = {
            payload: { aps: { 'mutable-content': 1 } },
            fcm_options: { image: imageUrl }
        };
    }

    try {
        const response = await admin.messaging().send(message);
        console.log(`Message sent successfully to topic ${topic}:`, response);
        // Map to standard counts so frontend success tracking succeeds
        return { successCount: 1, failureCount: 0, messageId: response };
    } catch (error) {
        console.error(`Error sending push notification to topic ${topic}:`, error);
        throw error;
    }
};

module.exports = {
    sendPushNotification,
    sendTopicNotification
};
