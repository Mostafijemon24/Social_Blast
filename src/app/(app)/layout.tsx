'use client';
import { AppProvider } from '@/components/app-context';
import { AppShell } from '@/components/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
