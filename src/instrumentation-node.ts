import { startWorker } from './server/worker';
import { startWatchdog } from './server/monitor';

if (process.env.SB_WORKER !== 'off') startWorker();
// Web servers without a worker still watch the workers and send alerts.
else startWatchdog();
