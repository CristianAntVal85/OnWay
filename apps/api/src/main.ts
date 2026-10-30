import 'reflect-metadata';
import { createApp } from './app.js';
import { appConnectionFromEnv } from './db/config.js';

const app = await createApp({ database: appConnectionFromEnv() });
const port = Number(process.env.PORT ?? 3000);
await app.listen(port, process.env.HOST ?? '0.0.0.0');
