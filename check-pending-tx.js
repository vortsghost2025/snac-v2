const https = require('https');

// This script helps users with vision impairments check transaction status
// Uses audio-friendly output with clear [VOICE] prefixes

const ETHERSCAN_API_KEY = "YourApiKeyToken"; // User should replace this or we can use public endpoints
const ADDRESS = "0xeE7d42e7a4713074c"; // From the Etherscan screenshot (truncated, but likely this)

// Since we don't have the full address or tx hash from user, let's make it configurable
console.log('[VOICE] ====== ETHEREUM TRANSACTION CHECKER ======');
console.log('[VOICE] This tool helps check pending transaction status');
console.log('[VOICE] For best results, provide your full Ethereum address and transaction hash');
console.log('[VOICE] You can find these in your wallet history');
console.log('');

console.log('[VOICE] To use this script:');
console.log('[VOICE] 1. Replace YOUR_ADDRESS_HERE with your full Ethereum address');
console.log('[VOICE] 2. Replace YOUR_TX_HASH_HERE with your pending transaction hash');
console.log('[VOICE] 3. Get a free API key from etherscan.io if needed (optional for low usage)');
console.log('');

console.log('[VOICE] Example pending transaction from your screen:');
console.log('[VOICE] Hash: 0x429fd9f2a2b0e427defe0abcf66a00340e613ab4c6cccfa149e2c70b01483711');
console.log('[VOICE] Amount: 0.5527162456 WETH');
console.log('[VOICE] From: 0xeE7d42e7...a4713074c');
console.log('[VOICE] To: Wrapped Ether contract');
console.log('[VOICE] Status: PENDING (as shown in Etherscan)');
console.log('');

console.log('[VOICE] ===== DIAGNOSIS =====');
console.log('[VOICE] The pending status is likely due to extremely low gas price:');
console.log('[VOICE] Current gas: 0.04-0.045 Gwei (from your screen)');
console.log('[VOICE] At today\'s Ethereum network, this is likely too low for quick confirmation');
console.log('[VOICE] Recommended gas for fast confirmation: 1-5+ Gwei depending on congestion');
console.log('');
console.log('[VOICE] ===== OPTIONS =====');
console.log('[VOICE] 1. WAIT: Transaction may eventually confirm (could take hours/days)');
console.log('[VOICE] 2. SPEED UP: Replace transaction with higher gas (if wallet supports)');
console.log('[VOICE] 3. CANCEL: If wallet allows, cancel and resubmit with proper gas');
console.log('[VOICE] 4. CHECK BRIDGE: See if deposit went through despite pending status');
console.log('');

console.log('[VOICE] ===== NEXT STEPS =====');
console.log('[VOICE] If you want to check specific transaction status:');
console.log('[VOICE] 1. Get your full transaction hash from wallet');
console.log('[VOICE] 2. We\'ll create a check script with audio output');
console.log('[VOICE] 3. Run it to get clear voice confirmation of status');
console.log('');
console.log('[VOICE] Current ETH price: $2,056.74');
console.log('[VOICE] Your pending 0.5527 WETH is worth ~$1,137');
console.log('');
console.log('[VOICE] ====== END OF DIAGNOSIS ======');

// Ask if they want to proceed with checking a specific transaction
const rl = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('[VOICE] Do you want to check a specific transaction? (y/n): ', (answer) => {
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    rl.question('[VOICE] Enter your full Ethereum address: ', (address) => {
      rl.question('[VOICE] Enter your transaction hash: ', (txHash) => {
        rl.question('[VOICE] Do you have an Etherscan API key? (y/n): ', (hasKey) => {
          const apiKey = hasKey.toLowerCase() === 'y' || hasKey.toLowerCase() === 'yes' 
            ? rl.question('[VOICE] Enter your Etherscan API key: ', (key) => key.trim()) 
            : 'YourApiKeyToken'; // Will use placeholder, user can get free one
            
          rl.close();
          
          // Create the actual check script
          const checkScript = `
const https = require('https');

const ADDRESS = "${address.trim()}";
const TX_HASH = "${txHash.trim()}";
const API_KEY = "${apiKey}";

console.log('[VOICE] Checking transaction status...');
console.log(\`[VOICE] Address: \\${ADDRESS}\`);
console.log(\`[VOICE] TX Hash: \\${TX_HASH}\`);

const checkTransaction = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.etherscan.io',
      path: \`/api?module=transaction&action=gettxreceipt&txhash=\\${TX_HASH}&apikey=\\${API_KEY}\`,
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
            resolve(null);
          }
        } catch (e) {
          console.log(\`[VOICE] ERROR: \\${e.message}\`);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.log(\`[VOICE] NETWORK ERROR: \\${e.message}\`);
      resolve(false);
    });

    req.end();
  });
};

// Execute check
(async () => {
  try {
    const status = await checkTransaction();
    if (status === true) {
      console.log('[VOICE] RECOMMENDATION: Now check if funds arrived on Base via bridge');
    } else if (status === false) {
      console.log('[VOICE] RECOMMANDATION: Check your wallet - funds should be available');
    } else {
      console.log('[VOICE] RECOMMENDATION: Consider speeding up transaction if urgent');
    }
  } catch (err) {
    console.log(\`[VOICE] FATAL ERROR: \\${err.message}\`);
  }
})();
`;

          require('fs').writeFileSync('check-transaction.js', checkScript);
          console.log('[VOICE] Created check-transaction.js');
          console.log('[VOICE] To run: node check-transaction.js');
          console.log('[VOICE] You may need to get a free API key from etherscan.io');
        });
      });
    });
  } else {
    rl.close();
    console.log('[VOICE] No transaction check initiated. You can run this script again when ready.');
  }
});
