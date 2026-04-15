import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Tanta Pipeline Dashboard',
  description: 'Trail CRM Pipeline Tracker for Tanta Mortgage Brokers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-surface text-on-surface">
        {children}
      </body>
    </html>
  )
}
