import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { config } from '../config/index.js';
import { supabase } from '../config/database.js';
import { jobService } from './job.service.js';
import { mathpixService } from './mathpix.service.js';
import { logger } from '../utils/logger.js';

export const emailInboundService = {
  imap: null,
  connected: false,
  monitoring: false,
  currentFolder: 'INBOX',

  /**
   * Connect to IMAP server
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (!config.imap.user || !config.imap.password) {
        logger.warn('EMAIL', 'IMAP credentials not configured');
        logger.warn('EMAIL', 'Set EMAIL_ADDRESS and EMAIL_PASSWORD in .env');
        return resolve();
      }

      logger.info('EMAIL', `Connecting to IMAP server: ${config.imap.host}:${config.imap.port}`);

      this.imap = new Imap({
        user: config.imap.user,
        password: config.imap.password,
        host: config.imap.host,
        port: config.imap.port,
        tls: config.imap.tls,
        tlsOptions: { rejectUnauthorized: false },
        keepalive: config.imap.keepalive,
        authTimeout: config.imap.authTimeout,
        connTimeout: config.imap.connTimeout,
      });

      this.imap.once('ready', () => {
        this.connected = true;
        logger.success('EMAIL', 'Connected to IMAP server');
        resolve();
      });

      this.imap.once('error', (err) => {
        logger.error('EMAIL', `Connection error: ${err.message}`);
        this.connected = false;
        reject(err);
      });

      this.imap.once('end', () => {
        this.connected = false;
        logger.info('EMAIL', 'Connection ended');
      });

      this.imap.connect();
    });
  },

  /**
   * Disconnect from IMAP server
   */
  disconnect() {
    this.monitoring = false;
    if (this.imap) {
      this.imap.end();
      this.imap = null;
    }
    this.connected = false;
    logger.info('EMAIL', 'Disconnected');
  },

  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  },

  /**
   * Open a folder
   */
  openFolder(folder, readOnly = false) {
    return new Promise((resolve, reject) => {
      if (!this.imap) return reject(new Error('Not connected'));

      this.imap.openBox(folder, readOnly, (err, box) => {
        if (err) return reject(err);
        this.currentFolder = folder;
        resolve(box);
      });
    });
  },

  /**
   * Start monitoring folder for new emails using IMAP IDLE
   */
  async startMonitoring(folder = 'INBOX') {
    if (!this.imap || !this.connected) {
      logger.warn('EMAIL', 'Cannot start monitoring - not connected');
      return;
    }

    await this.openFolder(folder, false);
    this.monitoring = true;

    // Listen for new mail
    this.imap.on('mail', async (numNewMsgs) => {
      console.log('');
      logger.info('EMAIL', '┌──────────────────────────────────────────────┐');
      logger.info('EMAIL', `│  📧 NEW EMAIL RECEIVED (${numNewMsgs} message${numNewMsgs > 1 ? 's' : ''})`.padEnd(47) + '│');
      logger.info('EMAIL', '└──────────────────────────────────────────────┘');

      try {
        await this.fetchNewEmails(numNewMsgs, folder);
      } catch (err) {
        logger.error('EMAIL', `Error fetching emails: ${err.message}`);
      }
    });

    logger.info('EMAIL', `IDLE monitoring active on ${folder}`);
  },

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    this.monitoring = false;
    logger.info('EMAIL', 'Monitoring stopped');
  },

  /**
   * Fetch the newest emails
   */
  async fetchNewEmails(count, folder) {
    return new Promise((resolve, reject) => {
      if (!this.imap) return reject(new Error('Not connected'));

      // Search for recent unseen emails
      this.imap.search(['UNSEEN'], async (err, uids) => {
        if (err) return reject(err);

        if (!uids || uids.length === 0) {
          logger.info('EMAIL', 'No unseen emails to process');
          return resolve([]);
        }

        // Take the last 'count' emails
        const targetUids = uids.slice(-count);
        logger.info('EMAIL', `Processing ${targetUids.length} unseen email(s)...`);

        for (const uid of targetUids) {
          try {
            const email = await this.fetchSingleEmail(uid);
            if (email) {
              await this.processEmail(email);
            }
          } catch (fetchErr) {
            logger.error('EMAIL', `Error processing UID ${uid}: ${fetchErr.message}`);
          }
        }

        resolve(targetUids);
      });
    });
  },

  /**
   * Fetch a single email by UID
   */
  fetchSingleEmail(uid) {
    return new Promise((resolve, reject) => {
      if (!this.imap) return reject(new Error('Not connected'));

      const fetch = this.imap.fetch([uid], {
        bodies: '',
        struct: true,
        markSeen: true,
      });

      let attributes = null;
      let bodyPromise = null;

      fetch.on('message', (msg) => {
        // Create a promise that resolves when the body stream is fully read
        bodyPromise = new Promise((resolveBody) => {
          const chunks = [];
          msg.on('body', (stream) => {
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => {
              resolveBody(chunks);
            });
          });
        });

        msg.once('attributes', (attrs) => {
          attributes = attrs;
        });
      });

      fetch.once('error', reject);

      fetch.once('end', async () => {
        // Wait for the body stream to complete before processing
        const emailData = bodyPromise ? await bodyPromise : [];

        if (emailData.length === 0) {
          logger.warn('EMAIL', `No email data received for UID ${uid}`);
          return resolve(null);
        }

        try {
          const rawEmail = Buffer.concat(emailData);
          logger.info('EMAIL', `Parsing email UID ${uid}, raw size: ${rawEmail.length} bytes`);

          const parsed = await simpleParser(rawEmail);

          // Log attachment details for debugging
          if (parsed.attachments && parsed.attachments.length > 0) {
            logger.info('EMAIL', `Found ${parsed.attachments.length} attachment(s):`);
            parsed.attachments.forEach((att, i) => {
              logger.info('EMAIL', `  [${i + 1}] ${att.filename || 'unnamed'} (${att.contentType}, ${att.size || 0} bytes)`);
            });
          } else {
            logger.info('EMAIL', 'No attachments found in email');
          }

          resolve({
            uid,
            messageId: parsed.messageId,
            subject: parsed.subject || '(No subject)',
            from: parsed.from?.value?.[0] || { address: 'unknown' },
            to: parsed.to?.value || [],
            date: parsed.date || new Date(),
            text: parsed.text,
            html: parsed.html,
            attachments: (parsed.attachments || []).map((att) => ({
              filename: att.filename || 'unnamed',
              contentType: att.contentType || 'application/octet-stream',
              size: att.size || att.content?.length || 0,
              content: att.content, // Buffer
            })),
            attributes,
          });
        } catch (parseErr) {
          logger.error('EMAIL', `Failed to parse email UID ${uid}: ${parseErr.message}`);
          reject(parseErr);
        }
      });
    });
  },

  /**
   * Process an email - extract PDF attachments and store in scanned_items
   */
  async processEmail(email) {
    logger.info('EMAIL', '─────────────────────────────────────────────────');
    logger.info('EMAIL', `Subject: "${email.subject}"`);
    logger.info('EMAIL', `From: ${email.from.address}`);
    logger.info('EMAIL', `Date: ${email.date}`);
    logger.info('EMAIL', `Attachments: ${email.attachments.length}`);

    // Get active job
    const activeJob = await jobService.getActiveJob();

    if (!activeJob) {
      logger.warn('EMAIL', 'No active job configured - email skipped');
      logger.warn('EMAIL', 'Configure an active job in Job Config to process emails');
      logger.info('EMAIL', '─────────────────────────────────────────────────');
      return;
    }

    logger.info('EMAIL', `Active Job: Book=${activeJob.active_book_id}, Chapter=${activeJob.active_chapter_id}`);

    // Filter PDF attachments - include various PDF content types Gmail might use
    const pdfContentTypes = [
      'application/pdf',
      'application/x-pdf',
      'application/acrobat',
      'application/vnd.pdf',
      'text/pdf',
      'text/x-pdf',
    ];

    const pdfAttachments = email.attachments.filter((att) => {
      const contentType = att.contentType?.toLowerCase() || '';
      const filename = att.filename?.toLowerCase() || '';

      const isPdfByType = pdfContentTypes.some((type) => contentType.includes(type));
      const isPdfByName = filename.endsWith('.pdf');
      // Also check for generic octet-stream with .pdf filename
      const isOctetStreamPdf = contentType.includes('octet-stream') && isPdfByName;

      if (isPdfByType || isPdfByName || isOctetStreamPdf) {
        logger.info('EMAIL', `  ✓ PDF attachment: "${att.filename}" (${att.contentType})`);
        return true;
      }

      logger.info('EMAIL', `  ✗ Skipping non-PDF: "${att.filename}" (${att.contentType})`);
      return false;
    });

    if (pdfAttachments.length === 0) {
      logger.info('EMAIL', 'No PDF attachments found - email skipped');
      logger.info('EMAIL', '─────────────────────────────────────────────────');
      return;
    }

    logger.success('EMAIL', `Found ${pdfAttachments.length} PDF attachment(s) to process`);

    for (const attachment of pdfAttachments) {
      try {
        await this.saveAttachmentAsScannedItem(attachment, email, activeJob);
      } catch (err) {
        logger.error('EMAIL', `Failed to save "${attachment.filename}": ${err.message}`);
      }
    }

    logger.success('EMAIL', 'Email processing complete');
    logger.info('EMAIL', '─────────────────────────────────────────────────');
    console.log('');
  },

  /**
   * Save a PDF attachment as a scanned item
   */
  async saveAttachmentAsScannedItem(attachment, email, activeJob) {
    logger.info('SCAN', `┌─ Saving Attachment ─────────────────────────────`);
    logger.info('SCAN', `│ File: ${attachment.filename}`);
    logger.info('SCAN', `│ Size: ${Math.round(attachment.size / 1024)}KB`);
    logger.info('SCAN', `│ Type: ${activeJob.active_item_type || 'question'}`);
    logger.info('SCAN', `└─────────────────────────────────────────────────`);

    // Check if attachment content exists
    if (!attachment.content || attachment.content.length === 0) {
      logger.error('SCAN', `Attachment "${attachment.filename}" has no content - skipping`);
      throw new Error(`Attachment content is empty for "${attachment.filename}"`);
    }

    // Convert Buffer to base64 for proper BYTEA storage in Supabase
    // Supabase JS client expects base64 strings for BYTEA columns
    const base64Content = attachment.content.toString('base64');

    // Verify PDF header before storing
    const pdfHeader = attachment.content.slice(0, 4).toString('utf8');
    if (pdfHeader !== '%PDF') {
      logger.warn('SCAN', `Warning: File "${attachment.filename}" may not be a valid PDF (header: ${pdfHeader})`);
    }

    // Insert into scanned_items with base64-encoded content
    const { data, error } = await supabase
      .from('scanned_items')
      .insert({
        book_id: activeJob.active_book_id,
        chapter_id: activeJob.active_chapter_id,
        item_type: activeJob.active_item_type || 'question',
        item_data: attachment.filename, // Store filename in item_data
        content: base64Content, // Base64-encoded PDF for BYTEA column
        scan_type: 'email_attachment',
        status: 'pending',
        latex_conversion_status: 'pending',
        metadata: {
          email_subject: email.subject,
          email_from: email.from.address,
          email_date: email.date,
          email_message_id: email.messageId,
          filename: attachment.filename,
          size: attachment.size,
          content_type: attachment.contentType,
        },
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.success('SCAN', `✓ Scanned item created: ${data.id}`);

    // Trigger MathPix conversion asynchronously
    this.triggerMathPixConversion(data.id, attachment.content, attachment.filename);

    return data;
  },

  /**
   * Trigger MathPix conversion for email attachment
   */
  async triggerMathPixConversion(scannedItemId, contentBuffer, filename) {
    try {
      logger.info('MATHPIX', `Starting PDF→LaTeX conversion...`);
      logger.info('MATHPIX', `Item ID: ${scannedItemId}`);
      // Convert buffer to base64 for MathPix API
      const base64Content = contentBuffer.toString('base64');
      await mathpixService.convertPdfToLatex(base64Content, scannedItemId);
      logger.success('MATHPIX', `✓ Conversion complete for: ${filename || scannedItemId}`);
    } catch (err) {
      logger.error('MATHPIX', `✗ Conversion failed: ${err.message}`);
    }
  },

  /**
   * Get connection status info
   */
  getStatus() {
    return {
      connected: this.connected,
      monitoring: this.monitoring,
      currentFolder: this.currentFolder,
      email: config.imap.user,
      host: config.imap.host,
    };
  },
};

export default emailInboundService;
