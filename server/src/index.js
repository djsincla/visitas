import { config } from './config.js';
import { logger } from './logger.js';
import { runMigrations, bootstrapAdmin, seedDocumentsFromConfig } from './db/migrate.js';
import { createApp } from './app.js';
import { startPhotoRetentionSweep } from './services/photo.js';
import { assertAdBindCredentials } from './auth/ad.js';

try {
  assertAdBindCredentials();
} catch (err) {
  logger.fatal({ err: err.message }, 'AD configuration check failed');
  process.exit(1);
}

runMigrations();
bootstrapAdmin();
seedDocumentsFromConfig();
startPhotoRetentionSweep();

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info(`visitas.world listening on http://localhost:${config.port}`);
});

const shutdown = (sig) => {
  logger.info({ sig }, 'shutting down');
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
