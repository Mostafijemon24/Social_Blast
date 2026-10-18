import { redirect } from 'next/navigation';

// The design opens on the Content Studio, the primary screen.
export default function Home() {
  redirect('/content');
}
