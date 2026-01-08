const express = require('express');
const multer = require('multer');
const pino = require('pino');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const logger = pino();
const router = express.Router();

const PROFILE_BUCKET = 'profile_pic';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];

let bucketChecked = false;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Unsupported file type. Please upload jpg, jpeg, png, gif, or webp images.'));
  },
});

async function ensureProfileBucket() {
  if (bucketChecked) {
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.storage.getBucket(PROFILE_BUCKET);
    if (!error && data) {
      bucketChecked = true;
      return;
    }
  } catch (error) {
    logger.warn({ error: error.message }, '[PROFILE] Bucket lookup failed, attempting creation');
  }

  try {
    const { error: createError } = await supabaseAdmin.storage.createBucket(PROFILE_BUCKET, {
      public: true,
    });

    if (createError && !createError.message?.toLowerCase().includes('already exists')) {
      logger.error({ error: createError.message }, '[PROFILE] Failed to create profile_pic bucket');
      throw createError;
    }
    bucketChecked = true;
  } catch (error) {
    logger.error({ error: error.message }, '[PROFILE] Unable to ensure profile bucket');
    throw error;
  }
}

function buildAvatarFileName(userId, originalName, mimetype) {
  const timestamp = Date.now();
  const extension =
    originalName?.split('.').pop()?.toLowerCase() ||
    mimetype?.split('/').pop() ||
    'jpg';
  const sanitized = extension.replace(/[^a-z0-9]/gi, '');
  return `${userId}_${timestamp}.${sanitized}`;
}

function extractStoragePath(url) {
  if (!url) return null;
  const marker = `${PROFILE_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return url.substring(index + marker.length);
}

async function getOrCreateProfile(user) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }

  const payload = {
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name || '',
    company_name: user.user_metadata?.company_name || '',
    phone_number: user.user_metadata?.phone_number || '',
    country: user.user_metadata?.country || '',
    avatar_url: null,
  };

  const { data: created, error: insertError } = await supabaseAdmin
    .from('profiles')
    .insert(payload)
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  return created;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user);
    res.json({ profile });
  } catch (error) {
    logger.error({ error: error.message }, '[PROFILE] ❌ Failed to fetch profile');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/', authMiddleware, async (req, res) => {
  try {
    const schema = z.object({
      full_name: z.string().max(255).optional().nullable(),
      company_name: z.string().max(255).optional().nullable(),
      phone_number: z.string().max(50).optional().nullable(),
      country: z.string().max(100).optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      logger.error({ error: parsed.error.issues }, '[PROFILE] ❌ Validation failed');
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    // Handle empty strings as null
    const updatePayload = {
      full_name: parsed.data.full_name || null,
      company_name: parsed.data.company_name || null,
      phone_number: parsed.data.phone_number || null,
      country: parsed.data.country || null,
      updated_at: new Date().toISOString(),
    };

    logger.info({ userId: req.user.id, updatePayload }, '[PROFILE] 📝 Updating profile');

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updatePayload)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) {
      logger.error({ error: error.message, code: error.code, details: error.details }, '[PROFILE] ❌ Database update failed');
      throw error;
    }

    logger.info({ userId: req.user.id, updatedProfile: data }, '[PROFILE] ✅ Profile updated successfully');
    res.json({ profile: data });
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, '[PROFILE] ❌ Failed to update profile');
    res.status(500).json({ error: 'Failed to update profile', message: error.message });
  }
});

router.post('/upload-avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No avatar file uploaded' });
    }

    await ensureProfileBucket();

    const profile = await getOrCreateProfile(req.user);
    const filename = buildAvatarFileName(req.user.id, req.file.originalname, req.file.mimetype);

    const { error: uploadError } = await supabaseAdmin.storage
      .from(PROFILE_BUCKET)
      .upload(filename, req.file.buffer, {
        cacheControl: '3600',
        upsert: true,
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      logger.error({ error: uploadError.message }, '[PROFILE] ❌ Failed to upload avatar');
      return res.status(500).json({ error: 'Failed to upload avatar' });
    }

    const { data: publicData } = supabaseAdmin.storage.from(PROFILE_BUCKET).getPublicUrl(filename);
    const avatarUrl = publicData?.publicUrl || null;

    if (!avatarUrl) {
      return res.status(500).json({ error: 'Failed to generate avatar URL' });
    }

    if (profile.avatar_url) {
      const oldPath = extractStoragePath(profile.avatar_url);
      if (oldPath) {
        await supabaseAdmin.storage.from(PROFILE_BUCKET).remove([oldPath]);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({ avatar_url: avatarUrl, profile: data });
  } catch (error) {
    logger.error({ error: error.message }, '[PROFILE] ❌ Failed to upload avatar');
    const status = error.message?.includes('Unsupported file type') ? 400 : 500;
    res.status(status).json({ error: error.message || 'Failed to upload avatar' });
  }
});

router.delete('/avatar', authMiddleware, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', req.user.id)
      .single();

    if (error) {
      throw error;
    }

    if (profile?.avatar_url) {
      const path = extractStoragePath(profile.avatar_url);
      if (path) {
        await supabaseAdmin.storage.from(PROFILE_BUCKET).remove([path]);
      }
    }

    await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq('id', req.user.id);

    res.json({ success: true });
  } catch (error) {
    logger.error({ error: error.message }, '[PROFILE] ❌ Failed to delete avatar');
    res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

module.exports = router;

