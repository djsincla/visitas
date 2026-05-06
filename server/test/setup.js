// Runs before each test file. Must set env vars BEFORE the app/db/config
// modules are imported by tests, so we set them here at module top.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.VISITAS_DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-production-at-all-12345';
process.env.LOG_LEVEL = 'silent';
process.env.PORT = '0';
const TMP = mkdtempSync(resolve(tmpdir(), 'visitas-test-'));
process.env.DATA_DIR = TMP;
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

const { runMigrations, bootstrapAdmin } = await import('../src/db/migrate.js');
runMigrations();
bootstrapAdmin();
