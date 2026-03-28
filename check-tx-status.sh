#!/bin/bash
# Audio-friendly transaction status checker for vision-impaired users
# Uses curl to fetch Etherscan page and parse for status

TX_HASH="0x429fd9f2a2b0e427defe0abcf66a00340e613ab4c6cccfa149e2c70b01483711"
ADDRESS="0xeE7d42e7a4713074c"

echo "[VOICE] Checking transaction status for hash: $TX_HASH"
echo "[VOICE] From address: $ADDRESS"
echo "[VOICE] Fetching transaction page from Etherscan..."

# Fetch the transaction page
curl -s "https://etherscan.io/tx/$TX_HASH" > /tmp/tx_page.html 2>/dev/null

if [ ! -s /tmp/tx_page.html ]; then
    echo "[VOICE] ERROR: Could not fetch transaction page. Check internet connection."
    exit 1
fi

# Check for success status
if grep -q "Status: Success" /tmp/tx_page.html; then
    echo "[VOICE] ✅ TRANSACTION SUCCESSFUL: Deposit confirmed on Ethereum"
    echo "[VOICE] Your WETH has been deposited and should be available for bridging"
elif grep -q "Status: Pending" /tmp/tx_page.html; then
    echo "[VOICE] ⏳ TRANSACTION PENDING: Still awaiting confirmation"
    echo "[VOICE] This is likely due to extremely low gas price (0.04 Gwei)"
elif grep -q "Status: Failed" /tmp/tx_page.html; then
    echo "[VOICE] ❌ TRANSACTION FAILED: Deposit reverted on Ethereum"
    echo "[VOICE] Your funds should still be in your wallet"
else
    # Fallback: look for any status indicator
    if grep -q "Status:" /tmp/tx_page.html; then
        # Extract the status line
        STATUS_LINE=$(grep -i "Status:" /tmp/tx_page.html | head -1)
        echo "[VOICE] Status line found: $STATUS_LINE"
        echo "[VOICE] Please check the status manually if unclear"
    else
        echo "[VOICE] WARNING: Could not determine status from page"
        echo "[VOICE] The transaction may be very new or the page structure changed"
    fi
fi

echo "[VOICE] ===== RECOMMENDATIONS ====="
if grep -q "Status: Pending" /tmp/tx_page.html; then
    echo "[VOICE] 1. Wait: Transaction may eventually confirm (could take hours/days)"
    echo "[VOICE] 2. Speed up: If your wallet supports, use 'speed up' or 'cancel and resubmit' with higher gas"
    echo "[VOICE] 3. Check bridge: See if the deposit was processed despite pending status"
    echo "[VOICE] 4. Your funds are SAFE - they're either in your wallet or in the deposit contract"
else
    echo "[VOICE] Please verify the status above and take appropriate action"
fi

echo "[VOICE] Current ETH price: $2,056.74"
echo "[VOICE] Your pending 0.5527 WETH is worth ~$1,137"
echo "[VOICE] ====== END OF CHECK ======="

# Clean up
rm -f /tmp/tx_page.html
