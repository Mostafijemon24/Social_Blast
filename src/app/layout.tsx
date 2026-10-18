import type { Metadata } from 'next';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import './globals.css';

export const metadata: Metadata = {
  title: 'Social Blast',
  description: 'Website-grounded social media content, scheduling and engagement for agencies.',
};

// Applies the saved theme before paint to avoid a light→dark flash.
const themeScript = `try{var t=localStorage.getItem('sb.theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
