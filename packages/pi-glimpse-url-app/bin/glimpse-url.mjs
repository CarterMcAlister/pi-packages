#!/usr/bin/env node
import { open } from 'glimpseui'

const url = process.argv[2]

if (!url) {
  console.error('Usage: glimpse-url <url>')
  process.exit(64)
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Plannotator</title>
  <style>
    html, body, iframe {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      overflow: hidden;
      background: #0b0f19;
    }

    #fallback {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      color: #dbeafe;
      font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    a {
      color: #93c5fd;
    }
  </style>
</head>
<body>
  <div id="fallback">Opening <a href=${JSON.stringify(url)}>${escapeHtml(url)}</a>…</div>
  <iframe src=${JSON.stringify(url)} allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`

const win = open(html, {
  width: Number(process.env.GLIMPSE_URL_WIDTH || 1440),
  height: Number(process.env.GLIMPSE_URL_HEIGHT || 960),
  title: process.env.GLIMPSE_URL_TITLE || 'Plannotator',
  openLinks: true,
})

win.once('closed', () => process.exit(0))
win.once('error', (error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  )
  process.exit(1)
})
