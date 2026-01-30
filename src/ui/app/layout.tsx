import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Voice Live Agent',
  description: 'Azure Speech Voice Live Agent Demo',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {children}
      </body>
    </html>
  )
}
