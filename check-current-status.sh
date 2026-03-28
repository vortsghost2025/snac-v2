#!/bin/bash
# Check current status of user's address on both chains

ADDRESS="0xC649A2F94AFc4E5649D3d575d16E739e70b2ba2f"
ETHEREUM_WETH="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
BASE_WETH="0x4200000000000000000000000000000000000006"

echo "[VOICE] ======== CURRENT STATUS CHECK ========"
echo ""

# Check Ethereum WETH balance
echo "[VOICE] Checking Ethereum WETH balance..."
eth_response=$(curl -s "https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=$ETHEREUM_WETH&address=$ADDRESS&tag=latest")
if [[ $eth_response =~ \"result\":\"([^\"]+)\" ]]; then
    eth_balance_wei="${BASH_REMATCH[1]}"
    eth_balance=$(echo "scale=18; $eth_balance_wei / 1000000000000000000" | bc)
    echo "[VOICE] Ethereum WETH balance: $eth_balance WETH"
else
    echo "[VOICE] Could not retrieve Ethereum balance"
fi

# Check Base WETH balance
echo "[VOICE] Checking Base WETH balance..."
base_response=$(curl -s "https://api.basescan.org/api?module=account&action=tokenbalance&contractaddress=$BASE_WETH&address=$ADDRESS&tag=latest")
if [[ $base_response =~ \"result\":\"([^\"]+)\" ]]; then
    base_balance_wei="${BASH_REMATCH[1]}"
    base_balance=$(echo "scale=18; $base_balance_wei / 1000000000000000000" | bc)
    echo "[VOICE] Base WETH balance: $base_balance WETH"
else
    echo "[VOICE] Could not retrieve Base balance"
fi

echo ""
echo "[VOICE] ======== RECENT BRIDGE TRANSACTIONS ========"
echo ""

# Check recent bridge transactions on Ethereum
echo "[VOICE] Looking for bridge transactions on Ethereum..."
echo "[VOICE] (This would require parsing internal transactions - checking simple approach)"
echo "[VOICE] For detailed bridge history, visit:"
echo "[VOICE] https://brid.gg/base or https://superbridge.app/base"
echo ""

echo "[VOICE] ======== RECOMMENDATIONS ========"
echo ""

if [[ ! -z "$eth_balance" && $(echo "$eth_balance > 0" | bc) -eq 1 ]]; then
    echo "[VOICE] You have WETH on Ethereum: $eth_balance WETH"
else
    echo "[VOICE] Your Ethereum WETH balance appears to be 0"
fi

if [[ ! -z "$base_balance" && $(echo "$base_balance > 0" | bc) -eq 1 ]]; then
    echo "[VOICE] You have WETH on Base: $base_balance WETH"
    echo "[VOICE] If you don't see it in your wallet, add custom token:"
    echo "[VOICE]   Contract: $BASE_WETH"
    echo "[VOICE]   Symbol: WETH"
    echo "[VOICE]   Decimals: 18"
else
    echo "[VOICE] Your Base WETH balance appears to be 0"
    echo "[VOICE] This suggests your bridged funds may have been:"
    echo "[VOICE]   1. Already claimed and then sent/swapped (as shown in your Base activity)"
    echo "[VOICE]   2. Still in the bridge contract awaiting claim"
    echo "[VOICE]   3. Partially claimed with remainder pending"
fi

echo ""
echo "[VOICE] ======== NEXT STEPS ========"
echo ""
echo "[VOICE] 1. Check your Base transaction history more carefully"
echo "[VOICE]    You show: Sent -0.04954 WETH (-$101.48) on Base"
echo "[VOICE]    This is MORE than your total bridged amount (0.06 WETH)"
echo "[VOICE]    Suggesting you may have claimed AND then swapped/sent additional funds"
echo ""
echo "[VOICE] 2. To see exactly what happened:"
echo "[VOICE]    - Go to https://basescan.org/address/$ADDRESS"
echo "[VOICE]    - Look at your token transfers and swap transactions"
echo "[VOICE]    - The Mar 20 'Sent WETH -0.04954' likely includes:"
echo "[VOICE]      * Your claimed bridged WETH (~0.06 WETH)"
echo "[VOICE]      * Plus some additional WETH you may have acquired or swapped"
echo ""
echo "[VOICE] 3. If you believe funds are missing:"
echo "[VOICE]    - Review each transaction on Basescan/Etherscan"
echo "[VOICE]    - Check if any were unauthorized"
echo "[VOICE]    - If all transactions look familiar, your funds may just be in different forms"
echo ""
echo "[VOICE] ======== END OF CHECK ========"
