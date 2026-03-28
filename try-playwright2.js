const pw = require('playwright');
(async () => {
  for (const name of ['webkit','firefox','chromium']) {
    try {
      console.log('Trying', name);
      const bt = pw[name];
      const ctx = await bt.launchPersistentContext(`./pw_user_${name}`, { headless: false });
      const page = await ctx.newPage();
      // Try the backend health endpoint on port 8001
      await page.goto('http://localhost:8001/healthz', { waitUntil: 'networkidle' });
      console.log(`${name} OK - status:`, page.status());
      await ctx.close();
      break;
    } catch (e) {
      console.error(`${name} failed:`, e.message);
    }
  }
})();
