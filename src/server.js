const { createApp } = require('./app');
const config = require('./config');
const { initializeConfiguration } = require('./config/ssmConfig');
const { closeDatabase } = require('./db/sqlite');

async function startServer() {
  try {
    // 1. Initialize configuration from SSM Parameter Store if enabled
    await initializeConfiguration();

    // 2. Initialize application
    const app = createApp();

    const server = app.listen(config.port, () => {
      console.log(`=======================================================`);
      console.log(`  CloudSpend Server running on port ${config.port}`);
      console.log(`  URL:          ${config.appUrl}`);
      console.log(`  Environment:  ${config.env}`);
      console.log(`  Storage Mode: ${config.storage.mode}`);
      console.log(`  Auth Provider: ${config.auth.provider}`);
      console.log(`=======================================================`);
    });

    // Graceful shutdown
    const handleShutdown = (signal) => {
      console.log(`\n[Shutdown] Received ${signal}. Gracefully stopping server...`);
      server.close(() => {
        closeDatabase();
        console.log('[Shutdown] Server closed cleanly.');
        process.exit(0);
      });

      // Force exit after 5s if still hanging
      setTimeout(() => {
        console.error('[Shutdown] Forced termination after timeout.');
        process.exit(1);
      }, 5000);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    return { app, server };
  } catch (err) {
    console.error('[Startup:Fatal] Error starting CloudSpend server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer
};
