import { config } from './config.js';
import { logger } from './logger.js';
import { runMigrations, bootstrapAdmin } from './db/migrate.js';
import { createApp } from './app.js';

runMigrations();
bootstrapAdmin();

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
