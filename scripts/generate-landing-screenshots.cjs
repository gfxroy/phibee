const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../dist');

const server = http.createServer((req, res) => {
  let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }
  const ext = path.extname(filePath);
  let contentType = 'text/html';
  if (ext === '.js') contentType = 'text/javascript';
  else if (ext === '.css') contentType = 'text/css';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.svg') contentType = 'image/svg+xml';
  
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  console.log('Server running on port', port);
  const browser = await chromium.launch({ headless: true });

  const landingAssetsDir = path.resolve(__dirname, '../landing/dist/assets');
  if (!fs.existsSync(landingAssetsDir)) fs.mkdirSync(landingAssetsDir, { recursive: true });

  // 1. High-Res Setup Screen
  const setupContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2
  });
  const setupPage = await setupContext.newPage();
  await setupPage.addInitScript(() => {
    localStorage.setItem('phibee-theme', 'light');
    window.align = {
      state: () => Promise.resolve({
        projects: [
          {
            id: '1',
            name: 'xcoach',
            directory: '/Users/aaditya/Projects/xcoach',
            pages: [
              { name: 'Home', url: 'https://www.figma.com/design/B6MbKX63uprX1EoUSzUMpg/figma-to-dev?node-id=1-87' },
              { name: 'Login', url: 'https://www.figma.com/design/B6MbKX63uprX1EoUSzUMpg/figma-to-dev?node-id=1-98' }
            ],
            lastBuild: { previewUrl: 'http://localhost:5173' },
            instructions: 'Design the dark and light mode UI matching the exact Figma tokens. Keep components modular, responsive, and cleanly separated.',
            builder: 'Antigravity',
            manager: 'codex',
            builderModel: 'gemini-2.5-pro',
            managerModel: 'o3-mini'
          },
          { id: '2', name: 'ate' },
          { id: '3', name: 'gallazio' },
          { id: '4', name: 'test-web', lastBuild: { previewUrl: 'http://localhost:5173' } }
        ],
        run: null,
        activeRuns: {}
      }),
      onState: () => () => {},
      onTerminal: () => () => {},
      attach: () => Promise.resolve(''),
      resize: () => {},
      input: () => {},
      models: () => Promise.resolve([
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'o3-mini', name: 'OpenAI o3-mini' }
      ])
    };
  });
  await setupPage.goto(`http://127.0.0.1:${port}`);
  await setupPage.waitForTimeout(1200);

  // Fill in any additional form inputs if needed to make it look active
  await setupPage.screenshot({
    path: path.join(landingAssetsDir, 'setup.png')
  });
  console.log('Saved landing/dist/assets/setup.png');
  await setupContext.close();

  // 2. High-Res Workspace Screen
  const workContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2
  });
  const workPage = await workContext.newPage();
  await workPage.addInitScript(() => {
    localStorage.setItem('phibee-theme', 'light');
    window.align = {
      state: () => Promise.resolve({
        projects: [
          { id: '1', name: 'xcoach', lastBuild: { previewUrl: 'http://localhost:5173' } },
          { id: '2', name: 'ate' },
          { id: '3', name: 'gallazio' },
          { id: '4', name: 'test-web', lastBuild: { previewUrl: 'http://localhost:5173' } }
        ],
        run: {
          id: '1',
          status: 'manager',
          pageIndex: 0,
          project: {
            name: 'xcoach',
            directory: '/Users/aaditya/Projects/xcoach',
            pages: [{ name: 'LOGIN', status: 'active' }],
            builder: 'Antigravity',
            manager: 'codex',
            builderModel: 'gemini-2.5-pro',
            managerModel: 'o3-mini'
          },
          usage: {
            input: 55790,
            output: 16000,
            builder: { input: 32450, output: 9200 },
            manager: { input: 23340, output: 6800 }
          },
          message: 'Manager Is Reviewing Login Component Screenshot.....'
        },
        activeRuns: {}
      }),
      onState: () => () => {},
      onTerminal: () => () => {},
      attach: (role) => {
        if (role === 'builder') {
          return Promise.resolve(
            '\n' +
            '  \x1b[1;37mAntigravity Builder v1.2.2\x1b[0m\n' +
            '  \x1b[38;5;244mSession: ses-9418a · Project: ~/xcoach\x1b[0m\n\n' +
            '  \x1b[32m✔\x1b[0m Parsed Figma Dev Mode vectors & token references\n' +
            '  \x1b[32m✔\x1b[0m Generated components/LoginForm.jsx with clean inputs\n' +
            '  \x1b[32m✔\x1b[0m Verified 1:1 color inversions for light & dark mode\n' +
            '  \x1b[32m✔\x1b[0m Built production bundle: dist/index.html (1.36 kB)\n' +
            '  \x1b[36m➜\x1b[0m \x1b[1;37mLocal Preview:\x1b[0m \x1b[4mhttp://localhost:5173/\x1b[0m\n' +
            '  \x1b[32m✔\x1b[0m Handoff ready for Manager verification.\n'
          );
        }
        return Promise.resolve(
          '\n' +
          '  \x1b[1;37mCodex Design Manager v2.0\x1b[0m\n' +
          '  \x1b[38;5;244mEvaluating Page 1/2 (LOGIN)\x1b[0m\n\n' +
          '  \x1b[32m✔\x1b[0m Retrieved screenshot from http://localhost:5173\n' +
          '  \x1b[32m✔\x1b[0m Visual alignment check: 0 layout shifts detected\n' +
          '  \x1b[32m✔\x1b[0m Typography check: Iosevka Charon + SF Pro matching\n' +
          '  \x1b[32m✔\x1b[0m Color check: High contrast 21:1 WCAG AAA passed\n' +
          '  \x1b[33m⚡\x1b[0m Status: Page approved. Proceeding to next page.\n'
        );
      },
      resize: () => {},
      input: () => {},
      models: () => Promise.resolve([])
    };
  });
  await workPage.goto(`http://127.0.0.1:${port}`);
  await workPage.waitForTimeout(1200);

  await workPage.screenshot({
    path: path.join(landingAssetsDir, 'workspace.png')
  });
  console.log('Saved landing/dist/assets/workspace.png');
  await workContext.close();

  await browser.close();
  server.close();
  process.exit(0);
});
