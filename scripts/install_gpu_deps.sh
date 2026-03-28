#!/bin/bash
# Auto-install all GPU benchmark dependencies

echo "=========================================="
echo "Installing GPU Benchmark Dependencies..."
echo "=========================================="

# Detect Python
if command -v python3 &> /dev/null; then
    PYTHON_CMD=python3
elif command -v python &> /dev/null; then
    PYTHON_CMD=python
else
    echo "ERROR: Python not found"
    exit 1
fi

echo "Using: $PYTHON_CMD"

# Create venv if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    $PYTHON_CMD -m venv venv
fi

# Activate venv
source venv/bin/activate 2>/dev/null || source venv/Scripts/activate 2>/dev/null

# Install PyTorch with CUDA support
echo "Installing PyTorch with CUDA..."
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install other dependencies
echo "Installing ML/Optimization packages..."
pip install numpy scipy pandas scikit-learn xgboost optuna bayesian-optimization

echo "Installing visualization..."
pip install matplotlib seaborn

echo "Installing forecasting..."
pip install prophet statsmodels

echo "Installing quantum (optional)..."
pip install qiskit qiskit-optimization || echo "Warning: Quantum libs failed, skipping"

echo "Installing Web3 (optional)..."
pip install web3 eth-brownie || echo "Warning: Web3 libs failed, skipping"

echo "Installing utilities..."
pip install tqdm pyyaml requests

echo ""
echo "=========================================="
echo "Installation Complete!"
echo "=========================================="
echo ""
echo "To activate the environment:"
echo "  source venv/bin/activate  (Linux/Mac)"
echo "  venv\Scripts\activate     (Windows)"
echo ""
