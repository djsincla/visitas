import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';

const router = Router();

const FORM_PATH = resolve(config.repoRoot, 'config/visitor-form.json');

// Default-ships to a sensible field set if config/visitor-form.json is absent.
const DEFAULT_FORM = {
  fields: [
    { key: 'name',    label: 'Your name',                  type: 'text',            required: true },
    { key: 'company', label: 'Company',                    type: 'text',            required: false },
    { key: 'email',   label: 'Email',                      type: 'email',           required: false },
    { key: 'phone',   label: 'Mobile number',              type: 'tel',             required: false },
    { key: 'host',    label: 'Who are you here to see?',   type: 'host-typeahead',  required: true },
    { key: 'purpose', label: 'Reason for visit',           type: 'select',          required: true,
      options: ['Meeting', 'Delivery', 'Interview', 'Vendor', 'Other'] },
  ],
};

// Public: kiosk (no auth) + admin UI both fetch this.
router.get('/', (_req, res) => {
  if (!existsSync(FORM_PATH)) return res.json(DEFAULT_FORM);
  try {
    const raw = JSON.parse(readFileSync(FORM_PATH, 'utf8'));
    // Strip the $comment helper keys so the kiosk doesn't see them.
    const fields = (raw.fields ?? []).map(f => {
      const { $comment, ...rest } = f;
      return rest;
    });
    res.json({ fields });
  } catch (err) {
    res.status(500).json({ error: 'failed to read visitor form schema', details: err.message });
  }
});

export default router;
