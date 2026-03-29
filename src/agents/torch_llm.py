"""
GPU-Accelerated PyTorch LLM for SNAC v2
Uses local models with CUDA acceleration
"""

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import logging
import os
import re

logger = logging.getLogger(__name__)

# Allowed model name patterns to prevent arbitrary path loading
ALLOWED_MODEL_PREFIXES = [
    "microsoft/",
    "meta-llama/",
    "HuggingFace/",
    "EleutherAI/",
    "stabilityai/",
    "google/",
    "openai/",
    "mistralai/",
    "bigscience/",
    "facebook/",
    "tiiuae/",
    "THUDM/",
    "Qwen/",
    "deepseek-ai/",
]

# Allow local paths that exist on disk (for development)
ALLOWED_LOCAL_PATHS = [
    os.path.expanduser("~/models"),
    "/opt/models",
    "./models",
]


def _validate_model_name(model_name: str) -> bool:
    """Validate that model_name is from an allowed source."""
    if not model_name or not isinstance(model_name, str):
        return False

    # Check against allowed HF prefixes
    for prefix in ALLOWED_MODEL_PREFIXES:
        if model_name.startswith(prefix):
            return True

    # Check against allowed local paths
    resolved = os.path.realpath(model_name)
    for allowed_path in ALLOWED_LOCAL_PATHS:
        if resolved.startswith(os.path.realpath(allowed_path)):
            return True

    # Reject anything that looks like path traversal
    if ".." in model_name or model_name.startswith("/"):
        logger.warning(f"Rejected model name with path traversal: {model_name}")
        return False

    return False


class TorchLLM:
    def __init__(self, model_name="microsoft/DialoGPT-medium", device=None):
        """
        Initialize the GPU-accelerated LLM

        Args:
            model_name: Hugging Face model identifier (must match allowed prefixes)
            device: Force a specific device ('cuda' or 'cpu'), defaults to auto-detect
        """
        if not _validate_model_name(model_name):
            raise ValueError(
                f"Model name '{model_name}' is not in the allowed list. "
                f"Allowed prefixes: {ALLOWED_MODEL_PREFIXES}"
            )

        self.model_name = model_name
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        logger.info(f"Initializing TorchLLM on device: {self.device}")

        # Configure tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)

        # Add padding token if missing (needed for some models)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # Load model with optimized settings for GPU
        try:
            self.model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
                device_map="auto",
                low_cpu_mem_usage=True,
            ).to(self.device)

            self.model.eval()
            logger.info(f"Successfully loaded model {model_name} on {self.device}")

        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            raise

    def __del__(self):
        """Cleanup GPU memory on destruction."""
        try:
            if hasattr(self, "model") and self.model is not None:
                del self.model
            if hasattr(self, "tokenizer") and self.tokenizer is not None:
                del self.tokenizer
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    @torch.no_grad()
    def infer(
        self, prompt: str, max_new_tokens: int = 128, temperature: float = 0.7
    ) -> str:
        """
        Generate a response to the given prompt

        Args:
            prompt: Input text to generate response for
            max_new_tokens: Maximum number of tokens to generate
            temperature: Sampling temperature (higher = more random)

        Returns:
            Generated text response
        """
        if temperature <= 0:
            temperature = 0.01  # Avoid division by zero in sampling
        if max_new_tokens < 1:
            max_new_tokens = 1

        try:
            # Tokenize input
            inputs = self.tokenizer(
                prompt,
                return_tensors="pt",
                truncation=True,
                padding=True,
                max_length=1024,
            ).to(self.device)

            # Generate response
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                do_sample=True,
                pad_token_id=self.tokenizer.eos_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
                repetition_penalty=1.2,
            )

            # Decode output
            generated_text = self.tokenizer.decode(outputs[0], skip_special_tokens=True)

            # Extract just the generated part (after the original prompt)
            input_len = len(
                self.tokenizer.decode(inputs["input_ids"][0], skip_special_tokens=True)
            )
            response = generated_text[input_len:].strip()

            return response

        except Exception as e:
            logger.error(f"Error during inference: {e}")
            raise

    def batch_infer(
        self, prompts: list, max_new_tokens: int = 128, temperature: float = 0.7
    ) -> list:
        """
        Generate responses for multiple prompts in a batch

        Args:
            prompts: List of input texts
            max_new_tokens: Maximum number of tokens to generate per prompt
            temperature: Sampling temperature

        Returns:
            List of generated text responses
        """
        if temperature <= 0:
            temperature = 0.01
        if max_new_tokens < 1:
            max_new_tokens = 1

        try:
            # Tokenize all prompts
            inputs = self.tokenizer(
                prompts,
                return_tensors="pt",
                truncation=True,
                padding=True,
                max_length=1024,
            ).to(self.device)

            # Generate responses
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                do_sample=True,
                pad_token_id=self.tokenizer.eos_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
                repetition_penalty=1.2,
            )

            # Decode outputs — use token-level comparison for accuracy
            responses = []
            input_ids = inputs["input_ids"]
            for i, output in enumerate(outputs):
                # Skip the input tokens to get only generated text
                generated_tokens = output[input_ids.shape[1] :]
                response = self.tokenizer.decode(
                    generated_tokens, skip_special_tokens=True
                ).strip()
                responses.append(response)

            return responses

        except Exception as e:
            logger.error(f"Error during batch inference: {e}")
            raise

    def get_device_info(self) -> dict:
        """Get information about the device being used"""
        if self.device == "cuda":
            return {
                "device": self.device,
                "gpu_name": torch.cuda.get_device_name(0),
                "gpu_memory": f"{torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB",
                "available_gpus": torch.cuda.device_count(),
            }
        else:
            return {"device": self.device}
