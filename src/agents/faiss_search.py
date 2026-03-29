"""
GPU-Accelerated FAISS Vector Search for SNAC v2
Provides fast similarity search using GPU acceleration
"""

import faiss
import numpy as np
import logging
from typing import List, Tuple, Optional
import time

logger = logging.getLogger(__name__)


class FaissGPUSearch:
    def __init__(self, dimension: int, metric_type: int = faiss.METRIC_INNER_PRODUCT):
        """
        Initialize GPU-accelerated FAISS index

        Args:
            dimension: Dimensionality of vectors to store
            metric_type: Distance metric (INNER_PRODUCT, L2, etc.)
        """
        self.dimension = dimension
        self.metric_type = metric_type
        self.gpu_resources = None
        self.gpu_index = None
        self.cpu_index = None

        # Check GPU availability before attempting GPU operations
        num_gpus = faiss.get_num_gpus()
        if num_gpus <= 0:
            logger.warning("No GPU detected by FAISS. Falling back to CPU index.")
            self.cpu_index = faiss.IndexFlat(dimension, metric_type)
            self.gpu_index = self.cpu_index
        else:
            self.gpu_resources = faiss.StandardGpuResources()
            self.cpu_index = faiss.IndexFlat(dimension, metric_type)
            self.gpu_index = faiss.index_cpu_to_gpu(
                self.gpu_resources, 0, self.cpu_index
            )
            logger.info(
                f"FAISS GPU index initialized on {num_gpus} GPU(s) with dimension {dimension}"
            )

        self.is_trained = True
        self.vector_count = 0

    def add_vectors(self, vectors: np.ndarray, ids: Optional[np.ndarray] = None):
        """
        Add vectors to the index

        Args:
            vectors: Array of shape (n, dimension) containing vectors to add
            ids: Optional array of IDs for the vectors (must be unique)
        """
        if vectors.dtype != np.float32:
            vectors = vectors.astype(np.float32)

        if ids is not None:
            if len(ids) != len(vectors):
                raise ValueError("IDs and vectors must have same length")
            self.gpu_index.add_with_ids(vectors, ids.astype(np.int64))
        else:
            self.gpu_index.add(vectors)

        self.vector_count += len(vectors)
        logger.info(
            f"Added {len(vectors)} vectors to index. Total: {self.vector_count}"
        )

    def search(
        self, query_vectors: np.ndarray, k: int
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Search for k nearest neighbors to the query vectors
        """
        if query_vectors.dtype != np.float32:
            query_vectors = query_vectors.astype(np.float32)

        distances, indices = self.gpu_index.search(query_vectors, k)

        return distances, indices

    def search_with_filter(
        self, query_vector: np.ndarray, k: int, filter_fn=None
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Search with post-filtering capability
        """
        if filter_fn is None:
            return self.search(query_vector.reshape(1, -1), k)

        distances, indices = self.search(
            query_vector.reshape(1, -1), min(k * 3, self.vector_count)
        )

        if filter_fn:
            valid_mask = [filter_fn(idx) for idx in indices[0]]
            filtered_distances = distances[0][valid_mask]
            filtered_indices = indices[0][valid_mask]

            # Sort direction depends on metric type
            if self.metric_type == faiss.METRIC_INNER_PRODUCT:
                # Higher is better for inner product
                sorted_idx = np.argsort(filtered_distances)[::-1]
            else:
                # Lower is better for L2
                sorted_idx = np.argsort(filtered_distances)

            top_k_idx = sorted_idx[: min(k, len(sorted_idx))]

            return filtered_distances[top_k_idx], filtered_indices[top_k_idx]

        return distances, indices

    def remove_vectors(self, ids: List[int]):
        """
        Remove vectors by ID (not supported for flat indexes)
        """
        logger.warning(
            "Removing vectors requires recreating index - consider using IndexIDMap"
        )
        raise NotImplementedError(
            "Deletion from flat index not supported. Consider using IndexIDMap."
        )

    def get_stats(self) -> dict:
        """Get statistics about the index"""
        return {
            "dimension": self.dimension,
            "vector_count": self.vector_count,
            "metric_type": self.metric_type,
            "is_trained": self.is_trained,
            "gpu_available": faiss.get_num_gpus() > 0,
        }

    def save(self, filepath: str):
        """Save the index to disk (will save CPU version)"""
        if self.gpu_index is not self.cpu_index:
            cpu_version = faiss.index_gpu_to_cpu(self.gpu_index)
            faiss.write_index(cpu_version, filepath)
        else:
            faiss.write_index(self.gpu_index, filepath)
        logger.info(f"Index saved to {filepath}")

    def load(self, filepath: str):
        """Load index from disk and transfer to GPU"""
        cpu_index = faiss.read_index(filepath)
        num_gpus = faiss.get_num_gpus()
        if num_gpus > 0 and self.gpu_resources is not None:
            self.gpu_index = faiss.index_cpu_to_gpu(self.gpu_resources, 0, cpu_index)
        else:
            self.gpu_index = cpu_index
        self.cpu_index = cpu_index
        self.vector_count = cpu_index.ntotal
        logger.info(f"Index loaded from {filepath}")

    def cleanup(self):
        """Explicitly release GPU resources."""
        self.gpu_index = None
        self.cpu_index = None
        self.gpu_resources = None


def normalize_vectors(vectors: np.ndarray) -> np.ndarray:
    """
    Normalize vectors to unit length (important for cosine similarity)
    """
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    return vectors / norms


if __name__ == "__main__":
    DIMENSION = 768

    search_engine = FaissGPUSearch(DIMENSION)

    num_vectors = 10000
    test_vectors = np.random.rand(num_vectors, DIMENSION).astype("float32")

    start_time = time.time()
    search_engine.add_vectors(test_vectors)
    print(f"Added {num_vectors} vectors in {time.time() - start_time:.3f}s")

    query = np.random.rand(1, DIMENSION).astype("float32")
    start_time = time.time()
    distances, indices = search_engine.search(query, k=5)
    print(f"Search completed in {time.time() - start_time:.3f}s")
    print(f"Top 5 distances: {distances[0]}")
    print(f"Top 5 indices: {indices[0]}")
