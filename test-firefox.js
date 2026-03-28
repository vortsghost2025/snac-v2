const { firefox } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await firefox.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto('https://snac.deliberatefederation.cloud:9090/health', { waitUntil: 'networkidle', timeout: 15000 });
    console.log('Status:', page.status());
    const content = await page.textContent('body');
    console.log('Response:', content);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
