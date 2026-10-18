'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { UnderlineTabs } from '@/components/ui';
import { Studio } from '@/components/content/studio';
import { ContentList } from '@/components/content/list';
import { BulkImport } from '@/components/content/bulk';

type Tab = 'studio' | 'list' | 'bulk';

function ContentPage() {
  const params = useSearchParams();
  const router = useRouter();
  const postId = params.get('post');
  const tab = (params.get('tab') as Tab) || 'studio';

  return (
    <div className="animate-sb-fade">
      <UnderlineTabs<Tab>
        label="Content sections"
        value={tab}
        onChange={(t) => router.push(t === 'studio' ? '/content' : `/content?tab=${t}`)}
        options={[{ value: 'studio', label: 'AI Content Studio' }, { value: 'list', label: 'All content' }, { value: 'bulk', label: 'Bulk import' }]}
      />
      {tab === 'studio' && <Studio key={postId ?? 'working'} postId={postId} />}
      {tab === 'list' && <ContentList />}
      {tab === 'bulk' && <BulkImport />}
    </div>
  );
}

export default function Page() {
  return <Suspense><ContentPage /></Suspense>;
}
