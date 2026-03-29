"""
Python wrapper for CUDA kernels using ctypes
"""

import ctypes
import os
import numpy as np
from pathlib import Path
import logging

log = logging.getLogger(__name__)

_KERNEL_SO = None
_CUDA_AVAILABLE = False
_INITIALIZED = False

# Only search well-known, project-local paths for shared libraries
_KERNEL_SEARCH_PATHS = [
    Path(__file__).parent / "inference_kernel.so",
    Path(__file__).parent / "build" / "inference_kernel.so",
]


def _load_cuda_kernels():
    """Load compiled CUDA kernel library. Called lazily on first use."""
    global _KERNEL_SO, _CUDA_AVAILABLE, _INITIALIZED
    if _INITIALIZED:
        return _CUDA_AVAILABLE
    _INITIALIZED = True

    for p in _KERNEL_SEARCH_PATHS:
        try:
            p = Path(p)
            if not p.exists():
                continue

            # Validate the path is within the project directory
            resolved = p.resolve()
            project_root = Path(__file__).resolve().parent.parent.parent
            if not str(resolved).startswith(str(project_root)):
                log.warning(f"Refusing to load .so outside project root: {resolved}")
                continue

            log.info(f"Loading CUDA kernels from {resolved}")
            try:
                _KERNEL_SO = ctypes.CDLL(str(resolved))
            except OSError as e:
                log.warning(f"Failed to load shared library {resolved}: {e}")
                continue

            # Validate required symbols exist
            required_symbols = [
                "cuda_embed_lookup",
                "cuda_layer_norm",
                "cuda_softmax",
                "cuda_matmul",
            ]

            missing = [s for s in required_symbols if not hasattr(_KERNEL_SO, s)]
            if missing:
                log.warning(f"Library {resolved} missing required functions: {missing}")
                _KERNEL_SO = None
                continue

            _CUDA_AVAILABLE = True
            log.info("CUDA kernels loaded and validated")
            return True
        except Exception as e:
            log.warning(f"Unexpected error while loading {p}: {e}")

    log.info("CUDA kernel library not found. GPU acceleration disabled.")
    return False


def is_cuda_available():
    """Check if CUDA kernels are loaded and available."""
    _load_cuda_kernels()
    return _CUDA_AVAILABLE


def cuda_embed_lookup(
    token_ids, embedding_table, batch_size, seq_len, vocab_size, embed_dim
):
    """
    GPU-accelerated token embedding lookup

    Args:
        token_ids: np.array [batch_size * seq_len] int32
        embedding_table: np.array [vocab_size, embed_dim] float32
        batch_size, seq_len, vocab_size, embed_dim: dimensions

    Returns:
        embeddings: np.array [batch_size, seq_len, embed_dim] float32 or None if unavailable
    """
    if not is_cuda_available():
        return None

    try:
        embeddings = np.zeros((batch_size, seq_len, embed_dim), dtype=np.float32)

        token_ids_d = token_ids.astype(np.int32).ctypes.data_as(
            ctypes.POINTER(ctypes.c_int)
        )
        embed_table_d = embedding_table.astype(np.float32).ctypes.data_as(
            ctypes.POINTER(ctypes.c_float)
        )
        embeddings_d = embeddings.ctypes.data_as(ctypes.POINTER(ctypes.c_float))

        result = _KERNEL_SO.cuda_embed_lookup(
            token_ids_d,
            embed_table_d,
            embeddings_d,
            ctypes.c_int(batch_size),
            ctypes.c_int(seq_len),
            ctypes.c_int(vocab_size),
            ctypes.c_int(embed_dim),
        )

        if result != 0:
            log.error("CUDA embed_lookup kernel failed")
            return None

        return embeddings
    except Exception as e:
        log.error(f"cuda_embed_lookup failed: {e}")
        return None


def cuda_layer_norm(input_data, weight, bias, eps=1e-5):
    """
    GPU-accelerated layer normalization

    Args:
        input_data: np.array [N, hidden_size] float32
        weight: np.array [hidden_size] float32
        bias: np.array [hidden_size] float32
        eps: epsilon for numerical stability

    Returns:
        output: np.array [N, hidden_size] float32 or None if unavailable
    """
    if not is_cuda_available():
        return None

    try:
        N, hidden_size = input_data.shape
        output = np.zeros_like(input_data, dtype=np.float32)

        input_d = input_data.astype(np.float32).ctypes.data_as(
            ctypes.POINTER(ctypes.c_float)
        )
        weight_d = weight.astype(np.float32).ctypes.data_as(
            ctypes.POINTER(ctypes.c_float)
        )
        bias_d = bias.astype(np.float32).ctypes.data_as(ctypes.POINTER(ctypes.c_float))
        output_d = output.ctypes.data_as(ctypes.POINTER(ctypes.c_float))

        result = _KERNEL_SO.cuda_layer_norm(
            input_d,
            weight_d,
            bias_d,
            output_d,
            ctypes.c_int(N),
            ctypes.c_int(hidden_size),
            ctypes.c_float(eps),
        )

        if result != 0:
            log.error("CUDA layer_norm kernel failed")
            return None

        return output
    except Exception as e:
        log.error(f"cuda_layer_norm failed: {e}")
        return None


def cuda_softmax(scores):
    """
    GPU-accelerated softmax for attention scores

    Args:
        scores: np.array [batch_size * seq_len, seq_len] float32

    Returns:
        softmax_scores: np.array or None if unavailable
    """
    if not is_cuda_available():
        return None

    try:
        scores_out = scores.copy().astype(np.float32)
        if scores_out.ndim == 1:
            batch_size = 1
            seq_len = scores_out.shape[0]
        else:
            batch_seq_len, seq_len = scores_out.shape
            batch_size = max(1, batch_seq_len // max(1, seq_len))

        scores_d = scores_out.ctypes.data_as(ctypes.POINTER(ctypes.c_float))

        result = _KERNEL_SO.cuda_softmax(
            scores_d, ctypes.c_int(batch_size), ctypes.c_int(seq_len)
        )

        if result != 0:
            log.error("CUDA softmax kernel failed")
            return None

        return scores_out
    except Exception as e:
        log.error(f"cuda_softmax failed: {e}")
        return None


def cuda_matmul(A, B):
    """
    GPU-accelerated matrix multiplication C = A @ B

    Args:
        A: np.array [M, K] float32
        B: np.array [K, N] float32

    Returns:
        C: np.array [M, N] float32 or None if unavailable
    """
    if not is_cuda_available():
        return None

    try:
        M, K = A.shape
        K2, N = B.shape
        if K != K2:
            log.error(f"Dimension mismatch: {K} != {K2}")
            return None

        C = np.zeros((M, N), dtype=np.float32)

        A_d = A.astype(np.float32).ctypes.data_as(ctypes.POINTER(ctypes.c_float))
        B_d = B.astype(np.float32).ctypes.data_as(ctypes.POINTER(ctypes.c_float))
        C_d = C.ctypes.data_as(ctypes.POINTER(ctypes.c_float))

        result = _KERNEL_SO.cuda_matmul(
            A_d, B_d, C_d, ctypes.c_int(M), ctypes.c_int(K), ctypes.c_int(N)
        )

        if result != 0:
            log.error("CUDA matmul kernel failed")
            return None

        return C
    except Exception as e:
        log.error(f"cuda_matmul failed: {e}")
        return None
