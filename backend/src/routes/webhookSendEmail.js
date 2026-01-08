const express = require('express');
const rateLimit = require('express-rate-limit');
const { supabaseAdmin } = require('../config/supabase');
const { sendEmail } = require('../services/imapSmtpService');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SUBJECT_LENGTH = 255;
const MAX_BODY_LENGTH = 1000000; // 1MB limit for email body

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many webhook requests, please retry later'
  }
});

router.use(webhookLimiter);

/**
 * Validate email address format
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validate multiple email addresses (comma-separated)
 */
function validateEmailList(emailList) {
  if (!emailList || typeof emailList !== 'string') {
    return false;
  }
  const emails = emailList.split(',').map(e => e.trim()).filter(e => e.length > 0);
  return emails.every(email => validateEmail(email));
}

/**
 * POST /api/webhooks/send-email
 * Public webhook endpoint for N8N to send emails
 * 
 * Request Body:
 * {
 *   "accountId": "uuid",
 *   "to": "recipient@example.com" or "recipient1@example.com,recipient2@example.com",
 *   "subject": "Email Subject",
 *   "body": "Plain text body",
 *   "html": "<html>HTML body</html>", // optional
 *   "attachments": [ // optional
 *     {
 *       "filename": "document.pdf",
 *       "path": "https://example.com/file.pdf" // or
 *       "content": "base64-encoded-content",
 *       "encoding": "base64"
 *     }
 *   ],
 *   "cc": "cc@example.com", // optional
 *   "bcc": "bcc@example.com", // optional
 *   "replyTo": "reply@example.com" // optional
 * }
 */
router.post('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `email-${Date.now()}`;
  const logPrefix = `[WEBHOOK-SEND-EMAIL][${requestId}]`;

  try {
    let { accountId, to, subject, body, html, attachments, cc, bcc, replyTo } = req.body || {};

    console.log(`${logPrefix} Incoming webhook request`, {
      accountId: accountId ? accountId.substring(0, 8) + '...' : 'missing',
      to: to ? to.substring(0, 30) + '...' : 'missing',
      hasSubject: !!subject,
      hasBody: !!body,
      hasHtml: !!html,
      hasAttachments: Array.isArray(attachments) && attachments.length > 0
    });

    // Validate accountId
    if (!accountId || typeof accountId !== 'string' || !UUID_REGEX.test(accountId)) {
      console.warn(`${logPrefix} Invalid accountId`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing accountId',
        details: 'accountId must be a valid UUID'
      });
    }

    // Validate recipient email
    if (!to || typeof to !== 'string' || !validateEmailList(to)) {
      console.warn(`${logPrefix} Invalid recipient email: ${to}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing recipient email',
        details: 'to must be a valid email address or comma-separated list of email addresses'
      });
    }

    // Validate subject
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      console.warn(`${logPrefix} Invalid subject`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing subject',
        details: 'subject is required and cannot be empty'
      });
    }

    if (subject.length > MAX_SUBJECT_LENGTH) {
      console.warn(`${logPrefix} Subject too long: ${subject.length} chars`);
      return res.status(400).json({
        success: false,
        error: 'Subject too long',
        details: `Subject must be less than ${MAX_SUBJECT_LENGTH} characters`
      });
    }

    // Validate body or html (at least one required)
    if ((!body || typeof body !== 'string' || body.trim().length === 0) &&
        (!html || typeof html !== 'string' || html.trim().length === 0)) {
      console.warn(`${logPrefix} Missing email body`);
      return res.status(400).json({
        success: false,
        error: 'Missing email body',
        details: 'Either body (plain text) or html must be provided'
      });
    }

    if (body && body.length > MAX_BODY_LENGTH) {
      console.warn(`${logPrefix} Body too long: ${body.length} chars`);
      return res.status(400).json({
        success: false,
        error: 'Email body too long',
        details: `Email body must be less than ${MAX_BODY_LENGTH} characters`
      });
    }

    // Validate optional fields
    if (cc && !validateEmailList(cc)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid CC email address',
        details: 'cc must be a valid email address or comma-separated list'
      });
    }

    if (bcc && !validateEmailList(bcc)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid BCC email address',
        details: 'bcc must be a valid email address or comma-separated list'
      });
    }

    if (replyTo && !validateEmail(replyTo)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Reply-To email address',
        details: 'replyTo must be a valid email address'
      });
    }

    // Validate attachments format if provided
    if (attachments) {
      if (!Array.isArray(attachments)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid attachments format',
          details: 'attachments must be an array'
        });
      }

      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        if (!attachment.filename || typeof attachment.filename !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'Invalid attachment',
            details: `Attachment ${i + 1} must have a filename`
          });
        }

        // Attachment must have either path or content
        if (!attachment.path && !attachment.content) {
          return res.status(400).json({
            success: false,
            error: 'Invalid attachment',
            details: `Attachment ${i + 1} must have either path or content`
          });
        }
      }
    }

    // Verify email account exists and is active
    const { data: accountData, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, email, user_id, is_active, smtp_host, smtp_username, smtp_password')
      .eq('id', accountId)
      .maybeSingle();

    if (accountError) {
      console.error(`${logPrefix} Database error fetching account:`, accountError);
      return res.status(500).json({
        success: false,
        error: 'Failed to verify email account',
        details: 'Database error'
      });
    }

    if (!accountData) {
      console.warn(`${logPrefix} Email account not found: ${accountId}`);
      return res.status(404).json({
        success: false,
        error: 'Email account not found',
        details: `No email account found with ID: ${accountId}`
      });
    }

    if (!accountData.is_active) {
      console.warn(`${logPrefix} Email account is inactive: ${accountId}`);
      return res.status(400).json({
        success: false,
        error: 'Email account is inactive',
        details: 'The email account is not active. Please activate it first.'
      });
    }

    // Verify SMTP configuration exists
    if (!accountData.smtp_host || !accountData.smtp_username || !accountData.smtp_password) {
      console.warn(`${logPrefix} SMTP not configured for account: ${accountId}`);
      return res.status(400).json({
        success: false,
        error: 'SMTP not configured',
        details: 'The email account does not have SMTP settings configured'
      });
    }

    console.log(`${logPrefix} ✅ Account verified:`, {
      accountId: accountId.substring(0, 8) + '...',
      email: accountData.email,
      hasSmtpConfig: true
    });

    // Prepare email payload
    const emailPayload = {
      to: to.trim(),
      subject: subject.trim(),
      body: body ? body.trim() : (html ? '' : ''), // Plain text body (required by nodemailer, can be empty if html provided)
      html: html ? html.trim() : undefined,
      attachments: attachments || []
    };

    // Add optional fields if provided
    if (cc) {
      emailPayload.cc = cc.trim();
    }
    if (bcc) {
      emailPayload.bcc = bcc.trim();
    }
    if (replyTo) {
      emailPayload.replyTo = replyTo.trim();
    }

    // Send email via existing service
    try {
      const result = await sendEmail(accountId, emailPayload);

      if (!result.success) {
        console.error(`${logPrefix} ❌ Failed to send email:`, result.error);
        return res.status(500).json({
          success: false,
          error: 'Failed to send email',
          details: result.error
        });
      }

      console.log(`${logPrefix} ✅ Email sent successfully`, {
        accountId: accountId.substring(0, 8) + '...',
        to: to.substring(0, 30) + '...',
        subject: subject.substring(0, 50),
        messageId: result.messageId
      });

      return res.status(200).json({
        success: true,
        message: 'Email sent successfully',
        data: {
          accountId,
          to: emailPayload.to,
          subject: emailPayload.subject,
          messageId: result.messageId,
          response: result.response,
          sentAt: new Date().toISOString()
        }
      });
    } catch (sendError) {
      console.error(`${logPrefix} ❌ Error sending email:`, sendError.message);

      // Check if it's a connection/auth error
      if (sendError.message.includes('authentication') || 
          sendError.message.includes('credentials') ||
          sendError.message.includes('AUTHENTICATIONFAILED')) {
        return res.status(401).json({
          success: false,
          error: 'SMTP authentication failed',
          details: 'The email account credentials are invalid. Please reconnect the account.'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to send email',
        details: sendError.message
      });
    }

  } catch (error) {
    console.error(`${logPrefix} ❌ Unexpected error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * GET /api/webhooks/send-email/test
 * Test endpoint that returns example payloads for testing
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Email webhook test endpoint',
    endpoint: '/api/webhooks/send-email',
    method: 'POST',
    examples: {
      basicEmail: {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        to: 'recipient@example.com',
        subject: 'Test Email',
        body: 'This is a plain text email body'
      },
      htmlEmail: {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        to: 'recipient@example.com',
        subject: 'Test HTML Email',
        body: 'Plain text fallback',
        html: '<h1>HTML Content</h1><p>This is HTML email</p>'
      },
      emailWithAttachments: {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        to: 'recipient@example.com',
        subject: 'Email with Attachment',
        body: 'Please find attached',
        attachments: [
          {
            filename: 'document.pdf',
            path: 'https://example.com/document.pdf'
          },
          {
            filename: 'image.png',
            content: 'base64-encoded-content',
            encoding: 'base64'
          }
        ]
      },
      multipleRecipients: {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        to: 'recipient1@example.com,recipient2@example.com',
        subject: 'Bulk Email',
        body: 'Email to multiple recipients',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com'
      }
    },
    validation: {
      maxSubjectLength: MAX_SUBJECT_LENGTH,
      maxBodyLength: MAX_BODY_LENGTH,
      requiredFields: ['accountId', 'to', 'subject', 'body or html']
    },
    curlExample: `curl -X POST https://pa.duhanashrah.ai/api/webhooks/send-email \\
  -H "Content-Type: application/json" \\
  -d '{
    "accountId": "your-account-id-here",
    "to": "recipient@example.com",
    "subject": "Test Email",
    "body": "This is a test email"
  }'`
  });
});

/**
 * POST /api/webhooks/send-email/test-send
 * Test endpoint that actually sends a test email (requires accountId in query or body)
 * This allows you to test the full email sending flow
 */
router.post('/test-send', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `test-${Date.now()}`;
  const logPrefix = `[WEBHOOK-SEND-EMAIL-TEST][${requestId}]`;

  try {
    // Get accountId from query or body
    const accountId = req.query.accountId || req.body.accountId;
    const testRecipient = req.query.to || req.body.to || req.query.recipient || req.body.recipient;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'Missing accountId',
        details: 'Please provide accountId as query parameter or in request body',
        example: '/api/webhooks/send-email/test-send?accountId=your-account-id&to=test@example.com'
      });
    }

    if (!testRecipient) {
      return res.status(400).json({
        success: false,
        error: 'Missing recipient email',
        details: 'Please provide recipient email (to) as query parameter or in request body',
        example: '/api/webhooks/send-email/test-send?accountId=your-account-id&to=test@example.com'
      });
    }

    // Validate accountId format
    if (!UUID_REGEX.test(accountId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid accountId format',
        details: 'accountId must be a valid UUID'
      });
    }

    // Validate recipient email
    if (!validateEmail(testRecipient)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid recipient email',
        details: 'Recipient email must be a valid email address'
      });
    }

    // Verify account exists
    const { data: accountData, error: accountError } = await supabaseAdmin
      .from('email_accounts')
      .select('id, email, user_id, is_active, smtp_host, smtp_username, smtp_password')
      .eq('id', accountId)
      .maybeSingle();

    if (accountError) {
      console.error(`${logPrefix} Database error:`, accountError);
      return res.status(500).json({
        success: false,
        error: 'Database error',
        details: accountError.message
      });
    }

    if (!accountData) {
      return res.status(404).json({
        success: false,
        error: 'Email account not found',
        details: `No email account found with ID: ${accountId}`
      });
    }

    if (!accountData.is_active) {
      return res.status(400).json({
        success: false,
        error: 'Email account is inactive',
        details: 'The email account is not active. Please activate it first.'
      });
    }

    if (!accountData.smtp_host || !accountData.smtp_username || !accountData.smtp_password) {
      return res.status(400).json({
        success: false,
        error: 'SMTP not configured',
        details: 'The email account does not have SMTP settings configured'
      });
    }

    // Prepare test email
    const testEmailPayload = {
      to: testRecipient,
      subject: `Test Email from ${accountData.email} - ${new Date().toISOString()}`,
      body: `This is a test email sent from the email webhook endpoint.

Account: ${accountData.email}
Sent at: ${new Date().toISOString()}
Request ID: ${requestId}

If you received this email, the webhook endpoint is working correctly!`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #008069;">Test Email from Email Webhook</h2>
            <p>This is a test email sent from the email webhook endpoint.</p>
            <ul>
              <li><strong>Account:</strong> ${accountData.email}</li>
              <li><strong>Sent at:</strong> ${new Date().toISOString()}</li>
              <li><strong>Request ID:</strong> ${requestId}</li>
            </ul>
            <p style="color: green; font-weight: bold;">✅ If you received this email, the webhook endpoint is working correctly!</p>
          </body>
        </html>
      `
    };

    console.log(`${logPrefix} Sending test email...`, {
      accountId: accountId.substring(0, 8) + '...',
      to: testRecipient,
      from: accountData.email
    });

    // Send test email
    const result = await sendEmail(accountId, testEmailPayload);

    if (!result.success) {
      console.error(`${logPrefix} Failed to send test email:`, result.error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send test email',
        details: result.error,
        accountInfo: {
          accountId: accountId.substring(0, 8) + '...',
          email: accountData.email,
          hasSmtpConfig: true
        }
      });
    }

    console.log(`${logPrefix} ✅ Test email sent successfully`, {
      accountId: accountId.substring(0, 8) + '...',
      to: testRecipient,
      messageId: result.messageId
    });

    return res.status(200).json({
      success: true,
      message: 'Test email sent successfully',
      data: {
        accountId,
        from: accountData.email,
        to: testRecipient,
        subject: testEmailPayload.subject,
        messageId: result.messageId,
        response: result.response,
        sentAt: new Date().toISOString()
      },
      note: 'Check the recipient inbox for the test email'
    });

  } catch (error) {
    console.error(`${logPrefix} ❌ Error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

module.exports = router;

