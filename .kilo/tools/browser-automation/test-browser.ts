// Test script for browser automation
import { BrowserTools } from './BrowserTools.js';

async function testBrowserAutomation() {
  console.log('🔍 Testing Kilo Browser Automation...');

  const tools = new BrowserTools();

  try {
    // First, check session status (should work without browser)
    console.log('📊 Checking session status...');
    const statusResult = await tools.executeTool('browser_session_status', {});
    console.log('Session status result:', statusResult);

    // Try to open a simple webpage
    console.log('🌐 Testing browser_open tool...');
    const openResult = await tools.executeTool('browser_open', {
      url: 'https://httpbin.org/html',
      name: 'test-page',
      headless: true
    });

    if (openResult.success) {
      console.log('✅ Browser opened successfully!');
      console.log('📄 Page description preview:', openResult.pageDescription?.substring(0, 200) + '...');

      // Try to describe the page
      console.log('📝 Testing browser_describe tool...');
      const describeResult = await tools.executeTool('browser_describe', {});
      if (describeResult.success) {
        console.log('📋 Page description length:', describeResult.pageDescription?.length);
      }

      // Close the browser
      console.log('🔒 Closing browser...');
      await tools.executeTool('browser_close', {});
      console.log('✅ Browser closed successfully!');
    } else {
      console.log('❌ Browser open failed:', openResult.error);
    }

  } catch (error) {
    console.error('💥 Test failed with error:', error);
  }
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testBrowserAutomation().catch(console.error);
}