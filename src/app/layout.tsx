import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Space_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-hw',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Ambient Noise — Sleep & Focus',
  description:
    'A minimal noise instrument. Shape white, pink or brown noise with an 8-band equalizer — sleep better, focus deeper.',
  manifest: '/manifest.json',
  applicationName: 'Ambient Noise',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Ambient Noise',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0608',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${spaceMono.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
  if ('serviceWorker' in navigator && ${process.env.NODE_ENV === 'production'}) {
    window.addEventListener('load', function() {
      // Register; when an already-controlled page picks up a newer worker from
      // a fresh deploy, ask it to activate and reload once to serve the update.
      navigator.serviceWorker.register('/sw.js').then(function(reg) {
        var refreshed = false;
        function activateAndReload(worker) {
          if (worker && worker.state === 'installed') {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        }
        if (!navigator.serviceWorker.controller) {
          // First visit — nothing to refresh yet.
          return;
        }
        if (reg.waiting) {
          activateAndReload(reg.waiting);
        }
        reg.addEventListener('updatefound', function() {
          var newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function() {
            if (newWorker.state === 'installed') {
              activateAndReload(newWorker);
            }
          });
        });
        // A new worker taking control means a fresh build is active. Reload
        // exactly once so this page serves it instead of the stale copy.
        navigator.serviceWorker.addEventListener('controllerchange', function() {
          if (!refreshed) {
            refreshed = true;
            window.location.reload();
          }
        });
      }).catch(function(err) {
        console.warn('[SW] Registration failed:', err);
      });
    });
  }
`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
