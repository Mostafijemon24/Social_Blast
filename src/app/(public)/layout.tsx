import type { Metadata } from 'next';

// Invite and reset links carry a secret token in the URL: never send it to other sites as a Referer.
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false } };

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
