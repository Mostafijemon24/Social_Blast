import { route } from '@/server/http';
import { adminOverview } from '@/server/repo';

export const GET = route(() => adminOverview(), { platformAdmin: true });
