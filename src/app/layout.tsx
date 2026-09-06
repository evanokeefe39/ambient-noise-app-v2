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
      navigator.serviceWorker.register('/sw.js').catch(function(err) {
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
