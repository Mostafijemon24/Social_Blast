import { route } from '@/server/http';
import { currentUser, userCount } from '@/server/auth';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/server/bootstrap';
import { activeProvider } from '@/server/generator';
import { imageAiConfigured } from '@/server/media';

/** Who is signed in, whether first-run setup is needed, and (outside production) demo credentials. */
export const GET = route(async (req) => {
  const provider = activeProvider();
  const users = await userCount(); // also creates the schema and demo user on first use
  return {
    user: await currentUser(req),
    setupRequired: users === 0,
    images: imageAiConfigured(),
    demo: process.env.NODE_ENV !== 'production' && users > 0 && process.env.SB_SEED !== 'false'
      ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : null,
    ai: { provider: provider.id, label: provider.label, languages: provider.languages },
  };
}, { public: true });
