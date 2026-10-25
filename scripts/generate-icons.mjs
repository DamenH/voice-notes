// Renders PNG app icons from public/favicon.svg using Playwright's Chromium.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const targets = [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/icon-maskable-512.png', 512, true],
  ['public/apple-touch-icon.png', 180, true],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [path, size, maskable] of targets) {
  // Maskable icons need a full-bleed background with the glyph inside the safe zone.
  const inner = maskable ? svg.replace('rx="14"', 'rx="0"') : svg;
  const scale = maskable ? 0.8 : 1;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${maskable ? '#4f46c8' : 'transparent'};display:grid;place-items:center;height:100vh">
      <div style="width:${size * scale}px;height:${size * scale}px">${inner.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path, omitBackground: !maskable });
  console.log('wrote', path);
}
await browser.close();
