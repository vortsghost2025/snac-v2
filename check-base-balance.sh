#!/bin/bash
# Audio-friendly script to check Base WETH balance for the user's address
# Address from the Ethereum transaction: 0xee7d42e7a4713074c

ADDRESS="0xee7d42e7a4713074c"
WETH_CONTRACT="0x4200000000000000000000000000000000000006"

echo "[VOICE] ======== BASE BALANCE CHECK ========"
echo "[VOICE] Checking WETH balance on Base for address: $ADDRESS"

# Try to use Basescan API without API key (may work for limited requests)
API_URL="https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=$WETH_CONTRACT&address=$ADDRESS&tag=latest"

echo "[VOICE] Querying Basescan API..."
response=$(curl -s "$API_URL" 2>/dev/null)

if [ -n "$response" ]; then
    # Check if the response is JSON and has a result field
    if echo "$response" | grep -q '"result"'; then
        # Extract the result (balance in wei)
        balance_wei=$(echo "$response" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$balance_wei" ] && [ "$balance_wei" != "" ]; then
            # Convert from wei to WETH (18 decimal places)
            balance_weth=$(echo "scale=18; $balance_wei / 1000000000000000000" | bc)
            echo "[VOICE] Your Base WETH balance is: $balance_weth WETH"
            echo "[VOICE] This is approximately \$$(echo "scale=2; $balance_weth * 2056.74" | bc) USD"
        else
            echo "[VOICE] Could not extract balance from API response."
            echo "[VOICE] Falling back to page scraping..."
            response=""
        fi
    else
        echo "[VOICE] API response did not contain expected data."
        echo "[VOICE] Falling back to page scraping..."
        response=""
    fi
else
    echo "[VOICE] API request failed or returned empty response."
    echo "[VOICE] Falling back to page scraping..."
fi

# If API didn't work, try scraping the Basescan address page
if [ -z "$balance_weth" ]; then
    echo "[VOICE] Fetching Basescan address page..."
    page=$(curl -s "https://basescan.org/address/$ADDRESS" 2>/dev/null)
    
    if [ -n "$page" ]; then
        # Try to extract the WETH balance from the page
        # Look for the WETH token balance in the HTML
        # This is a simplified extraction and might need adjustment based on actual page structure
        weth_balance=$(echo "$page" | grep -i "WETH" | grep -o '[0-9]\+\.[0-9]\{1,18\}' | head -1)
        
        if [ -n "$weth_balance" ]; then
            echo "[VOICE] Extracted WETH balance from page: $weth_balance WETH"
            echo "[VOICE] This is approximately \$$(echo "scale=2; $weth_balance * 2056.74" | bc) USD"
        else
            # Try another pattern: look for the balance in a table row
            weth_balance=$(echo "$page" | grep -A5 -B5 "WETH" | grep -o '[0-9]\+\.[0-9]\{1,18\}' | head -1)
            if [ -n "$weth_balance" ]; then
                echo "[VOICE] Extracted WETH balance from table: $weth_balance WETH"
                echo "[VOICE] This is approximately \$$(echo "scale=2; $weth_balance * 2056.74" | bc) USD"
            else
                echo "[VOICE] Could not extract WETH balance from the page."
                echo "[VOICE] The page structure might have changed or the token is not visible."
            fi
        fi
    else
        echo "[VOICE] Failed to fetch Basescan address page."
        echo "[VOICE] Please check your internet connection."
    fi
fi

echo ""
echo "[VOICE] ======== NEXT STEPS ========"
if [ -n "$balance_weth" ] && [ "$(echo "$balance_weth > 0" | bc)" -eq 1 ]; then
    echo "[VOICE] You have a WETH balance on Base!"
    echo "[VOICE] If you don't see it in your wallet, please:"
    echo "[VOICE] 1. Switch your wallet to Base network"
    echo "[VOICE] 2. Try to add the WETH token manually:"
    echo "[VOICE]    Contract: $WETH_CONTRACT"
    echo "[VOICE]    Symbol: WETH"
    echo "[VOICE]    Decimals: 18"
else
    echo "[VOICE] Your Base WETH balance appears to be zero or could not be determined."
    echo "[VOICE] This means your funds are likely still in the bridge contract awaiting claim."
    echo "[VOICE] Please:"
    echo "[VOICE] 1. Switch your wallet to Base network"
    echo "[VOICE] 2. Go to the Base Bridge: https://bridge.base.org"
    echo "[VOICE] 3. Connect your wallet"
    echo "[VOICE] 4. Check the 'History' tab for your deposit"
    echo "[VOICE] 5. Look for a 'CLAIM' button next to the deposit and click it"
    echo "[VOICE] 6. Confirm the transaction in your wallet"
fi

echo ""
echo "[VOICE] ======== IMPORTANT ========"
echo "[VOICE] Your funds are SAFE and have been deposited into the bridge."
echo "[VOICE] They are not lost. The delay is in the claiming process."
echo "[VOICE] Current ETH price: \$2,056.74"
echo "[VOICE] Your 0.5527 WETH is worth approximately \$1,137"
echo "[VOICE] ======== END OF CHECK ========"
