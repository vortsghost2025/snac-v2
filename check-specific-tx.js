const https = require('https');

// SPECIFICALLY FOR THE PENDING TRANSACTION FROM USER'S ETHERSCAN SCREEN
const ADDRESS = "0xeE7d42e7a4713074c";
const TX_HASH = "0x429fd9f2a2b0e427defe0abcf66a00340e613ab4c6cccfa149e2c70b01483711";
// Using a free tier API key placeholder - user may need to get their own from etherscan.io
const API_KEY = "YourApiKeyToken"; 

console.log('[VOICE] ====== SPECIFIC TRANSACTION CHECK ======');
console.log(`[VOICE] Checking transaction: ${TX_HASH}`);
console.log(`[VOICE] From address: ${ADDRESS}`);
console.log('[VOICE] Amount: 0.5527162456 WETH');
console.log('[VOICE] Current gas price: 0.04 Gwei (from your screen)');
console.log('');

const checkTransaction = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.etherscan.io',
      path: `/api?module=transaction&action=gettxreceipt&txhash=${TX_HASH}&apikey=${API_KEY}`,
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === '1') {
            console.log('[VOICE] ✅ TRANSACTION SUCCESSFUL: Deposit confirmed on Ethereum');
            console.log('[VOICE] Your WETH has been deposited and should be available for bridging');
            resolve(true);
          } else if (parsed.status === '0') {
            console.log('[VOICE] ❌ TRANSACTION FAILED: Deposit reverted on Ethereum');
            console.log('[VOICE] Your funds should still be in your wallet');
            resolve(false);
          } else {
            console.log('[VOICE] ⏳ TRANSACTION PENDING: Still awaiting confirmation');
            console.log('[VOICE] This is expected due to extremely low gas price (0.04 Gwei)');
            resolve(null);
          }
        } catch (e) {
          console.log(`[VOICE] ERROR: ${e.message}`);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.log(`[VOICE] NETWORK ERROR: ${e.message}`);
      resolve(false);
    });

    req.end();
  });
};

// Execute check and provide recommendations
(async () => {
  try {
    console.log('[VOICE] Checking transaction status...');
    const status = await checkTransaction();
    
    console.log('');
    console.log('[VOICE] ===== RECOMMENDATIONS =====');
    
    if (status === true) {
      console.log('[VOICE] 1. Your deposit has succeeded on Ethereum');
      console.log('[VOICE] 2. Now check if funds arrived on Base via the bridge interface');
      console.log('[VOICE] 3. If not visible on Base, look for a "Claim" button in the bridge');
    } else if (status === false) {
      console.log('[VOICE] 1. Your deposit failed on Ethereum');
      console.log('[VOICE] 2. Your 0.5527 WETH (~$1,137) should still be in your wallet');
      console.log('[VOICE] 3. Check your Ethereum wallet balance directly');
    } else {
      console.log('[VOICE] 1. Transaction is still pending due to extremely low gas price');
      console.log('[VOICE] 2. Current gas: 0.04 Gwei is likely too slow for confirmation');
      console.log('[VOICE] 3. Recommended actions:');
      console.log('[VOICE]    a) WAIT: May eventually confirm (could take hours/days)');
      console.log('[VOICE]    b) SPEED UP: Use wallet feature to "speed up" or "cancel and resubmit"');
      console.log('[VOICE]    c) CHECK BRIDGE: See if bridge processed it despite pending status');
      console.log('[VOICE] 4. Your funds are SAFE - they\'re either in your wallet or in the deposit contract');
    }
    
    console.log('');
    console.log('[VOICE] ===== BRIDGE CHECK =====');
    console.log('[VOICE] To check if funds arrived on Base:');
    console.log('[VOICE] 1. Switch your wallet to Base network');
    console.log('[VOICE] 2. Look for token: 0x4200000000000000000000000000000000000006 (Base WETH)');
    console.log('[VOICE] 3. If not visible, manually add token with that address');
    console.log('[VOICE] 4. Check bridge interface for claimable funds');
    
  } catch (err) {
    console.log(`[VOICE] FATAL ERROR: ${err.message}`);
  }
})();
