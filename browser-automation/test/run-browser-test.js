const { execSync } = require('child_process');

try {
    console.log('Installing Playwright browsers...');
    execSync('npx playwright install', { stdio: 'inherit' });

    console.log('Running a quick browser script check...');
    const code = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto('https://example.com');
      const title = await page.title();
      console.log('title:' + title);
      await browser.close();
    })();
  `;
    execSync(`node -e "${code.replace(/\n/g, ' ')}"`, { stdio: 'inherit' });
    console.log('Browser test succeeded.');
} catch (err) {
    console.error('Browser test failed.', err);
    process.exit(1);
}
