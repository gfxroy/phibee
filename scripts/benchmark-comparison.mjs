import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const SITES = [
  {
    id: 'phiby-antigravity',
    name: 'Phiby Harness + Anti-Gravity (Gemini 3.8 Flash High)',
    url: 'https://testweb-blush.vercel.app',
    role: 'Dual-Agent Harness (Manager + Builder)',
    targetNode: '19-406 (Upcoming Events with Rotator)'
  },
  {
    id: 'claude-code-opus',
    name: 'Claude Code (Opus 4.6 Standalone)',
    url: 'https://gallaio-app.vercel.app',
    role: 'Single Terminal CLI',
    targetNode: '12-320 (The Visuals - Missed Node 19-406)'
  },
  {
    id: 'antigravity-standalone',
    name: 'Anti-Gravity CLI Standalone (Gemini 3.8 Flash High)',
    url: 'https://gallazio-antigrav.vercel.app',
    role: 'Single Terminal CLI',
    targetNode: '12-320 (The Visuals - Missed Node 19-406)'
  },
  {
    id: 'galaziio-full',
    name: 'Galaziio Full Restaurant Experience (Multi-Section)',
    url: 'https://galaziio-full.vercel.app',
    role: 'Comprehensive Showcase App',
    targetNode: 'Full Site (Hero + Bento + Rotator Events + Menu + Booking)'
  }
];

async function run() {
  const outputDir = path.resolve('test-artifacts/comparison');
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const site of SITES) {
    console.log(`\n=== Testing ${site.name} (${site.url}) ===`);
    const page = await browser.newPage({
      viewport: { width: 1944, height: 1080 },
      deviceScaleFactor: 1
    });

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    const startTime = Date.now();
    try {
      await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      console.warn(`Load warning: ${e.message}, waiting for domcontentloaded...`);
      await page.waitForLoadState('domcontentloaded');
    }
    const loadTimeMs = Date.now() - startTime;

    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 1000));

    // Initial screenshot
    const screenshotPath = path.join(outputDir, `${site.id}-render.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Saved screenshot to ${screenshotPath}`);

    // Inspect presence of key elements
    const elementsReport = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const hasUpcoming = /upcoming/i.test(bodyText);
      const hasEvents = /events/i.test(bodyText);
      const hasStarlight = /starlight/i.test(bodyText);
      const hasDjZora = /zora/i.test(bodyText);
      const hasReserve = /reserve table/i.test(bodyText);
      const hasDates = /21 sep|22 sep|23 sep|24|25 sep|26 sep|27 sep/i.test(bodyText);
      const hasYellowIndicator = !!document.querySelector('[style*="E8D26A"], [style*="e8d26a"], [style*="rgb(232, 210, 106)"], .line-yellow');
      const hasRotator = hasDates || !!document.querySelector('.events-rotator-slider, [title*="rotate"]');

      return {
        hasUpcoming,
        hasEvents,
        hasStarlight,
        hasDjZora,
        hasReserve,
        hasDates,
        hasYellowIndicator,
        hasRotator,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        textSnippet: bodyText.slice(0, 300).replace(/\n+/g, ' ')
      };
    });

    // Test interactivity if it's the rotator site
    let interactionWorked = false;
    let interactionScreenshot = null;
    if (site.id === 'phiby-antigravity') {
      try {
        console.log('Testing rotator interaction (clicking 22 sep)...');
        const clicked = await page.evaluate(() => {
          const els = [...document.querySelectorAll('div')];
          const target = els.find(e => e.textContent.trim() === '22 sep');
          if (target) {
            target.click();
            return true;
          }
          return false;
        });

        if (clicked) {
          await new Promise(r => setTimeout(r, 800));
          interactionScreenshot = path.join(outputDir, `${site.id}-interacted.png`);
          await page.screenshot({ path: interactionScreenshot });
          interactionWorked = true;
          console.log('Interaction succeeded! Captured rotated state.');
        }
      } catch (err) {
        console.warn('Interaction test error:', err.message);
      }
    }

    await page.close();

    results.push({
      ...site,
      loadTimeMs,
      consoleErrors,
      elementsReport,
      interactionWorked,
      screenshotPath,
      interactionScreenshot
    });
  }

  await browser.close();

  // Pixel comparison for Phiby against Figma Reference
  const refPath = path.resolve('test-artifacts/galaziio-page/reference.png');
  const phibyRender = path.join(outputDir, 'phiby-antigravity-render.png');
  const diffPath = path.join(outputDir, 'phiby-diff.png');

  let diffStats = null;
  try {
    const imgA = PNG.sync.read(await fs.readFile(refPath));
    const imgB = PNG.sync.read(await fs.readFile(phibyRender));

    if (imgA.width === imgB.width && imgA.height === imgB.height) {
      const diff = new PNG({ width: imgA.width, height: imgA.height });
      const numDiffPixels = pixelmatch(
        imgA.data,
        imgB.data,
        diff.data,
        imgA.width,
        imgA.height,
        { threshold: 0.15, includeAA: false }
      );
      await fs.writeFile(diffPath, PNG.sync.write(diff));
      const totalPixels = imgA.width * imgA.height;
      const mismatchPercent = ((numDiffPixels / totalPixels) * 100).toFixed(2);
      const matchPercent = (100 - mismatchPercent).toFixed(2);
      diffStats = {
        comparable: true,
        matchPercent: `${matchPercent}%`,
        mismatchPercent: `${mismatchPercent}%`,
        diffPath
      };
      console.log(`\nPixelmatch Result: ${matchPercent}% visual match against Figma reference!`);
    } else {
      diffStats = {
        comparable: false,
        reason: `Reference is ${imgA.width}x${imgA.height}, render is ${imgB.width}x${imgB.height}`
      };
    }
  } catch (e) {
    diffStats = { comparable: false, error: e.message };
  }

  const report = {
    evaluatedAt: new Date().toISOString(),
    figmaUrl: 'https://www.figma.com/design/b8FxVSqyfhO9ZXIjs8BD47/galaziio?node-id=19-406&m=dev',
    diffStats,
    results
  };

  await fs.writeFile(
    path.join(outputDir, 'benchmark-results.json'),
    JSON.stringify(report, null, 2)
  );
  console.log('\nBenchmark completed successfully! Saved to test-artifacts/comparison/benchmark-results.json');
}

run().catch(console.error);
