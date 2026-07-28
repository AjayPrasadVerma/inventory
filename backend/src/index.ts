import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`🚀 API ready on http://localhost:${env.port}`);
  console.log(`   Health: http://localhost:${env.port}/api/health`);
});
