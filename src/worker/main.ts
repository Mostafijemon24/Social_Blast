// Standalone worker: `npm run worker`. Use with SB_WORKER=off on the web servers.
import { startWorker } from '../server/worker';

startWorker();
console.log('Social Blast worker running. Press Ctrl+C to stop.');
setInterval(() => undefined, 1 << 30);
