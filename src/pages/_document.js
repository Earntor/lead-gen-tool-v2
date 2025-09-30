// pages/_document.js
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="nl">
      <Head>
        {/* forceer licht voor browser UI / formulieren */}
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#ffffff" />
      </Head>
      {/* forceer lichte body (ook als CSS later laadt) */}
      <body className="antialiased bg-white text-gray-900">
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
