const pw = require('playwright');

(async () => {
  const target = process.env.TARGET_URL || 'http://localhost:8000';
  console.log('TARGET_URL ->', target);
  for (const name of ['webkit', 'firefox', 'chromium']) {
    try {
      console.log('\nTrying', name);
      const bt = pw[name];
      const userData = `./pw_user_${name}`;
      const ctx = await bt.launchPersistentContext(userData, { headless: false });
      const page = await ctx.newPage();
      await page.goto(target, { waitUntil: 'load', timeout: 30000 });
      console.log(`${name} launched and navigated OK`);
      await ctx.close();
      process.exit(0);
    } catch (err) {
      console.error(`${name} failed:`, err.message || err);
    }
  }
  console.error('All browser attempts failed');
  process.exit(2);
})();
const pw = require('playwright');
(async () => {
  for (const name of ['webkit', 'firefox', 'chromium']) {
    try {
      console.log('Trying', name);
      const bt = pw[name];
      const ctx = await bt.launchPersistentContext(`./pw_user_${name}`, { headless: false });
      const page = await ctx.newPage();
      await page.goto('http://localhost:8000'); // adjust target
      console.log(`${name} OK`);
      await ctx.close();
      break;
    } catch (e) {
      console.error(`${name} failed:`, e.message);
    }
  }
})();
