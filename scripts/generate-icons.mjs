// Rasterize the repository's vector icon for iOS and the PWA manifest.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const svg = (await readFile('public/icons/icon.svg', 'utf8')).replace('rx="112"', 'rx="0"');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined });
try {
  for (const [size, name] of [[180, 'apple-touch-icon'], [192, 'icon-192'], [512, 'icon-512']]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: `public/icons/${name}.png` });
    await page.close();
  }
} finally { await browser.close(); }
