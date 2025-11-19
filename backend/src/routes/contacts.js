const express = require('express');
const multer = require('multer');
const pino = require('pino');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const contactsService = require('../services/contactsService');
const { supabaseAdmin } = require('../config/supabase');

const logger = pino();
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/csv',
      'text/vcard',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (
      allowedTypes.includes(file.mimetype) ||
      /\.(csv|vcf|xlsx|xls)$/i.test(file.originalname)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, VCF, and Excel files are allowed.'));
    }
  },
});

router.post('/:agentId/contacts/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id, user_id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (agentError || !agent) {
      logger.error({ agentId, userId, error: agentError }, '❌ Agent not found or unauthorized');
      return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    logger.info({ filename: req.file.originalname, agentId }, '📄 Parsing contact file');
    const parsedContacts = await contactsService.parseContactFile(
      req.file.buffer,
      req.file.originalname
    );

    if (!parsedContacts.length) {
      return res.status(400).json({ error: 'No valid contacts found in file' });
    }

    const contactsToInsert = parsedContacts.map((contact) => ({
      ...contact,
      agent_id: agentId,
    }));

    const { data: insertedContacts, error: insertError } = await supabaseAdmin
      .from('contacts')
      .upsert(contactsToInsert, {
        onConflict: 'agent_id,phone_number',
        ignoreDuplicates: false,
      })
      .select();

    if (insertError) {
      logger.error({ error: insertError, agentId }, '❌ Failed to insert contacts');
      return res.status(500).json({ error: 'Failed to save contacts' });
    }

    logger.info(
      {
        agentId,
        count: insertedContacts?.length || 0,
        totalParsed: parsedContacts.length,
      },
      '✅ Contacts uploaded successfully'
    );

    return res.json({
      message: 'Contacts uploaded successfully',
      uploaded: insertedContacts?.length || 0,
      total: parsedContacts.length,
      contacts: insertedContacts,
    });
  } catch (error) {
    logger.error({ error: error.message, agentId: req.params.agentId }, '❌ Contact upload error');
    return res.status(500).json({ error: error.message || 'Failed to upload contacts' });
  }
});

router.post('/:agentId/contacts', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    const contactSchema = z.object({
      name: z.string().min(1, 'Name is required'),
      phone_number: z.string().min(3, 'Phone number is required'),
      email: z
        .string()
        .email('Invalid email address')
        .optional()
        .or(z.literal('')),
      company: z.string().optional(),
      notes: z.string().optional(),
    });

    const validation = contactSchema.safeParse(req.body);
    if (!validation.success) {
      logger.warn({ agentId, issues: validation.error.issues }, '⚠️ Contact creation validation failed');
      return res.status(400).json({
        error: 'Invalid input',
        details: validation.error.issues,
      });
    }

    const { data: agent } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    const payload = validation.data;
    const contactPayload = {
      agent_id: agentId,
      name: payload.name,
      phone_number: payload.phone_number,
      email: payload.email || null,
      company: payload.company || null,
      notes: payload.notes || null,
      metadata: {},
    };

    const { data: insertedContact, error: insertError } = await supabaseAdmin
      .from('contacts')
      .upsert(contactPayload, {
        onConflict: 'agent_id,phone_number',
        ignoreDuplicates: false,
      })
      .select()
      .maybeSingle();

    if (insertError) {
      logger.error({ insertError, agentId }, '❌ Failed to create contact');
      return res.status(500).json({ error: 'Failed to create contact' });
    }

    logger.info({ agentId, contactId: insertedContact?.id }, '✅ Contact created successfully');
    return res.status(201).json({ contact: insertedContact });
  } catch (error) {
    logger.error({ error: error.message }, '❌ Create contact error');
    return res.status(500).json({ error: 'Failed to create contact' });
  }
});

router.get('/:agentId/contacts', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    const { data: agent } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const { data: contacts, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return res.json({ contacts, count: contacts.length });
  } catch (error) {
    logger.error({ error: error.message }, '❌ Failed to fetch contacts');
    return res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

router.delete('/:agentId/contacts/:contactId', authMiddleware, async (req, res) => {
  try {
    const { agentId, contactId } = req.params;
    const userId = req.user.id;

    const { data: agent } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('agent_id', agentId);

    if (deleteError) {
      logger.error({ error: deleteError, contactId }, '❌ Failed to delete contact');
      return res.status(500).json({ error: 'Failed to delete contact' });
    }

    logger.info({ contactId, agentId }, '🗑️ Contact deleted successfully');
    return res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    logger.error({ error: error.message }, '❌ Delete contact error');
    return res.status(500).json({ error: 'Failed to delete contact' });
  }
});

router.delete('/:agentId/contacts', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    const { data: agent } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    const { data: deletedContacts, error: deleteError } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('agent_id', agentId)
      .select('id');

    if (deleteError) {
      logger.error({ error: deleteError, agentId }, '❌ Failed to delete contacts');
      return res.status(500).json({ error: 'Failed to delete contacts' });
    }

    const count = deletedContacts?.length || 0;
    logger.info({ agentId, count }, '🗑️ All contacts deleted successfully');

    return res.json({ message: 'All contacts deleted successfully', count });
  } catch (error) {
    logger.error({ error: error.message }, '❌ Delete all contacts error');
    return res.status(500).json({ error: 'Failed to delete contacts' });
  }
});

router.put('/:agentId/contacts/:contactId', authMiddleware, async (req, res) => {
  const { agentId, contactId } = req.params;
  const userId = req.user.id;
  logger.info(
    {
      agentId,
      contactId,
      userId,
      body: req.body,
    },
    '📝 Incoming contact update request'
  );

  try {
    const updateSchema = z.object({
      name: z.string().min(1, 'Name is required').optional(),
      phone_number: z.string().min(1, 'Phone number is required').optional(),
      email: z
        .string()
        .email('Invalid email format')
        .optional()
        .or(z.literal('')),
      company: z.string().optional(),
      notes: z.string().optional(),
    });

    const validationResult = updateSchema.safeParse(req.body);
    if (!validationResult.success) {
      logger.warn(
        {
          agentId,
          contactId,
          issues: validationResult.error.issues,
        },
        '⚠️ Contact update validation failed'
      );
      return res.status(400).json({
        error: 'Invalid input',
        details: validationResult.error.issues,
      });
    }

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (agentError) {
      logger.error({ agentError, agentId, userId }, '❌ Error fetching agent during contact update');
      return res.status(500).json({ error: 'Failed to verify agent ownership' });
    }

    if (!agent) {
      logger.warn({ agentId, userId }, '🚫 Agent not found or unauthorized for contact update');
      return res.status(403).json({ error: 'Unauthorized to update contacts for this agent' });
    }

    const { data: existingContact, error: fetchError } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('agent_id', agentId)
      .maybeSingle();

    if (fetchError) {
      logger.error(
        { fetchError, contactId, agentId },
        '❌ Failed to fetch contact before update'
      );
      return res.status(500).json({ error: 'Failed to fetch contact' });
    }

    if (!existingContact) {
      logger.warn({ contactId, agentId }, '🔍 Contact not found for update');
      return res.status(404).json({ error: 'Contact not found' });
    }

    const payload = validationResult.data;
    const hasColumn = (key) =>
      Object.prototype.hasOwnProperty.call(existingContact, key);

    const updateData = {
      ...(payload.name !== undefined && { name: payload.name }),
      ...(payload.phone_number !== undefined && { phone_number: payload.phone_number }),
      ...(payload.email !== undefined && hasColumn('email') && { email: payload.email }),
      ...(payload.company !== undefined && hasColumn('company') && { company: payload.company }),
      ...(payload.notes !== undefined && hasColumn('notes') && { notes: payload.notes }),
      updated_at: new Date().toISOString(),
    };

    if (Object.keys(updateData).length === 1 && updateData.updated_at) {
      logger.warn({ contactId, agentId }, '⚠️ No fields provided for update');
      return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    logger.info(
      {
        agentId,
        contactId,
        updateData,
      },
      '🛠️ Updating contact'
    );

    const { data: updatedContact, error: updateError } = await supabaseAdmin
      .from('contacts')
      .update(updateData)
      .eq('id', contactId)
      .eq('agent_id', agentId)
      .select()
      .maybeSingle();

    if (updateError) {
      if (updateError.code === '23505') {
        logger.warn(
          { updateError, contactId, agentId, updateData },
          '⚠️ Unique constraint violation while updating contact'
        );
        return res.status(409).json({
          error: 'A contact with this phone number already exists for this agent',
        });
      }

      logger.error(
        { updateError, contactId, agentId, updateData },
        '❌ Failed to update contact'
      );
      return res.status(500).json({ error: 'Failed to update contact' });
    }

    if (!updatedContact) {
      logger.warn(
        { contactId, agentId },
        '🔍 No contact returned after update (possible RLS or missing record)'
      );
      return res.status(404).json({ error: 'Contact not found after update' });
    }

    logger.info({ contactId, agentId }, '✏️ Contact updated successfully');
    return res.json({ message: 'Contact updated successfully', contact: updatedContact });
  } catch (error) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
        agentId,
        contactId,
      },
      '❌ Unexpected error updating contact'
    );
    return res.status(500).json({ error: 'Failed to update contact' });
  }
});

router.get('/:agentId/contacts/count', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    const { data: agent } = await supabaseAdmin
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('user_id', userId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const { count, error } = await supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId);

    if (error) {
      throw error;
    }

    return res.json({ count: count || 0 });
  } catch (error) {
    logger.error({ error: error.message }, '❌ Failed to fetch contact count');
    return res.status(500).json({ error: 'Failed to fetch contact count' });
  }
});

module.exports = router;

