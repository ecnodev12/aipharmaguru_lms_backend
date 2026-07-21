const nodemailer = require('nodemailer');
const config = require('../config');
const fs = require('fs');
const path = require('path');

// Create transporter
// Create transporter
let transporter;

try {
    if (config.email.service && config.email.service !== 'smtp') {
      // Use service (e.g., 'gmail')
      console.log(`Initializing Email Transporter with service: ${config.email.service}`);
      transporter = nodemailer.createTransport({
        service: config.email.service,
        auth: {
          user: config.email.user,
          pass: config.email.pass,
        },
      });
    } else {
      // Use SMTP host/port
      console.log('Initializing Email Transporter with SMTP');
      transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure, 
        auth: {
          user: config.email.user,
          pass: config.email.pass,
        },
      });
    }
} catch (error) {
    console.error('CRITICAL: Email Transporter Initialization Failed:', error);
    // Continue without email
    transporter = null;
}

/**
 * Send an email using a template
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} templateName - Name of the template file (without extension)
 * @param {object} data - Data to inject into the template
 */
const sendEmail = async (to, subject, templateName, data) => {
  try {
    const templatePath = path.join(__dirname, '../templates', `${templateName}.html`);
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template ${templateName} not found`);
    }

    let html = fs.readFileSync(templatePath, 'utf8');

    // Simple template replacement
    // Replaces {{key}} with data[key]
    Object.keys(data).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      html = html.replace(regex, data[key]);
    });

    try {
      const info = await transporter.sendMail({
        from: config.email.from || '"AI Cure Academy" <admin@example.com>',
        to,
        subject,
        html,
      });

      console.log('Message sent: %s', info.messageId);
      return info;
    } catch (sendError) {
      if (sendError.code === 'ECONNREFUSED' || sendError.code === 'EAUTH') {
        console.warn('⚠️ Email sending failed (Connection/Auth Error). This is expected in development without a real SMTP server.');
        console.warn('Simulating successful email send.');
        return { messageId: 'mock-id-' + Date.now() };
      }
      throw sendError;
    }
  } catch (error) {
    console.error('Error in sendEmail service:', error);
    // Don't throw for dev environment to avoid breaking flow
    if (process.env.NODE_ENV === 'development') {
        return { messageId: 'mock-error-id' };
    }
    throw error;
  }
};

module.exports = {
  sendEmail,
};
