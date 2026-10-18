import { route } from '@/server/http';
import { commitImport } from '@/server/repo';

export const POST = route<{ id: string }>(async (_r, p) => ({ import: await commitImport(p.id) }), { owns: 'import' });
