import { Config } from './config/Config.js';
import { Container } from './core/Container.js';

async function main(): Promise<void> {
  const config = Config.load();
  const container = new Container(config);

  const shutdown = (signal: NodeJS.Signals) => {
    container.logger.info(`Received ${signal}, shutting down`);
    void container
      .stop()
      .catch((error: unknown) => container.logger.error('Shutdown failed', error))
      .finally(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await container.start();
}

main().catch((error: unknown) => {
  // The logger may not exist yet if config validation threw, so fall back to
  // stderr to make boot failures visible in container logs.
  process.stderr.write(
    `Failed to start Soundwave:\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
