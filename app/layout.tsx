import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LHC Worship Prep',
  description: 'Worship preparation for Luther House Chapel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
