import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

test('Landing page automatically detects OS and wires downloads correctly', async () => {
  const distDir = path.resolve('landing/dist');
  
  // Create a minimal static HTTP server
  const server = http.createServer(async (req, res) => {
    try {
      const parsedPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = path.join(distDir, parsedPath);
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/`;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });

    // 1. Test Windows User Agent
    const winContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const winPage = await winContext.newPage();
    await winPage.goto(baseUrl);
    const winHeroBtn = winPage.locator('#hero-download-btn');
    assert.match(await winHeroBtn.textContent(), /Windows/);
    assert.equal(await winHeroBtn.getAttribute('href'), 'https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phibee-Windows.exe');
    assert.equal(await winPage.locator('#card-windows.is-detected').count(), 1);
    await winContext.close();

    // 2. Test Linux User Agent
    const linuxContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const linuxPage = await linuxContext.newPage();
    await linuxPage.goto(baseUrl);
    const linuxHeroBtn = linuxPage.locator('#hero-download-btn');
    assert.match(await linuxHeroBtn.textContent(), /Linux/);
    assert.equal(await linuxHeroBtn.getAttribute('href'), 'https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phibee-Linux.AppImage');
    assert.equal(await linuxPage.locator('#card-linux.is-detected').count(), 1);
    await linuxContext.close();

    // 3. Test macOS User Agent
    const macContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const macPage = await macContext.newPage();
    await macPage.goto(baseUrl);
    const macHeroBtn = macPage.locator('#hero-download-btn');
    assert.match(await macHeroBtn.textContent(), /macOS/);
    assert.equal(await macHeroBtn.getAttribute('href'), 'https://storage.googleapis.com/xcoach-interview-2026.firebasestorage.app/downloads/Phibee-Mac-AppleSilicon.dmg');
    assert.equal(await macPage.locator('#card-mac.is-detected').count(), 1);
    await macContext.close();

  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
