import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LHC Worship Prep',
  description: 'Worship preparation for Luther House Chapel',
  // public/manifest.json has existed since June wired to nothing -- no link
  // element, no metadata entry -- so no browser has ever read it. Adding the
  // app to a home screen therefore produced a bare shortcut with no declared
  // scope, name or icon. This is what makes it a real installable app.
  //
  // `appleWebApp.capable` is deliberately left off. It forces an iOS home
  // screen entry into a standalone shell, where getUserMedia has a markedly
  // worse record than in Safari proper, and no amount of hidden browser chrome
  // is worth costing a singer their microphone.
  manifest: '/manifest.json',
};

/**
 * Phone singers hold this thing at arm's length in a church, so the viewport is
 * worth stating rather than defaulting.
 *
 * `viewportFit: 'cover'` is what makes env(safe-area-inset-*) return anything
 * at all; without it a notched phone simply crops the top of the header and the
 * bottom of the lane, with no way for CSS to know.
 *
 * The theme colour matters more here than it looks: the browser paints its own
 * chrome around a page, and against this near-black UI a default white bar is a
 * bright strip at the top of a darkened room.
 *
 * Zoom is deliberately left enabled. Locking it would stop an accidental pinch
 * mid-verse, but it also stops anyone who needs to enlarge the words, and that
 * is a worse trade in a congregation.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#040715',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
