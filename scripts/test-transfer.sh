#!/bin/bash
# Ki0xk Test Transfer Flow
# Test address: 0x843914e5BBdbE92296F2c3D895D424301b3517fC

echo "=========================================="
echo "Ki0xk Transfer Test Flow"
echo "=========================================="
echo ""
echo "Test address: 0x843914e5BBdbE92296F2c3D895D424301b3517fC"
echo ""

# Step 1: Check balance
echo "Step 1: Checking unified balance..."
npm run cli balance

echo ""
echo "=========================================="

# Step 2: Check for blocking channels
echo "Step 2: Checking for blocking channels..."
npm run cli channels

echo ""
echo "=========================================="

# Step 3: Attempt transfer
echo "Step 3: Sending 0.01 ytest.usd to test address..."
npm run cli send 0x843914e5BBdbE92296F2c3D895D424301b3517fC 0.01

echo ""
echo "=========================================="
echo "Test complete!"
