import 'server-only';
import { NextResponse } from 'next/server';
import { ApiError } from './errors';
import { requireUser } from './auth';
import { assertClient, assertOwned, type Owned } from './access';
import type { Role, SessionUser } from '@/lib/types';

type Ctx<P> = { params: Promise<P> };

export interface RouteOptions {
  /** No sign-in needed (login, setup). */
  public?: boolean;
  /** Minimum workspace role. Defaults to viewer for reads and editor for writes. */
  role?: Role;
  /** Platform operators only (Super Admin). */
  platformAdmin?: boolean;
  /** The route's `id` param is a record of this kind; check the user may access its client. */
  owns?: Owned;
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rejects cross-site writes: the browser's Origin must match the host we're served from. */
function checkOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origin).host !== host) throw new ApiError(403, 'Cross-site request blocked');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, 'Cross-site request blocked');
  }
}

/**
 * Wraps a route handler: sign-in and role checks, JSON errors with a status,
 * and no stack traces leaked to the client.
 */
export function route<P = Record<string, string>>(
  fn: (req: Request, params: P, user: SessionUser) => Promise<unknown> | unknown,
  opts: RouteOptions = {},
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const write = WRITE.has(req.method);
      if (write) checkOrigin(req);
      const user = opts.public
        ? (null as unknown as SessionUser)
        : await requireUser(req, { role: opts.role ?? (write ? 'editor' : 'viewer'), platformAdmin: opts.platformAdmin });
      const params = (await ctx?.params) ?? ({} as P);
      if (user) {
        const p = params as Record<string, string>;
        // Every /api/clients/[clientId]/... route is checked here, so handlers can't forget.
        if (p.clientId) await assertClient(user, p.clientId);
        if (opts.owns && p.id) await assertOwned(user, opts.owns, p.id);
      }
      const out = await fn(req, params, user);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Something went wrong on the server' }, { status: 500 });
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, 'Request body must be JSON');
  }
}
