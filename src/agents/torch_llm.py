"""
GPU-Accelerated PyTorch LLM for SNAC v2
Uses local models with CUDA acceleration
"""

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import logging
import os

logger = logging.getLogger(__name__)

class TorchLLM:
    def __init__(self, model_name="microsoft/DialoGPT-medium", device=None):
        """
        Initialize the GPU-accelerated LLM
        
        Args:
            model_name: Hugging Face model identifier
            device: Force a specific device ('cuda' or 'cpu'), defaults to auto-detect
        """
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
                device_map="auto",  # Automatically distribute across available GPUs
                low_cpu_mem_usage=True,  # Reduce CPU memory usage during loading
            ).to(self.device)
            
            self.model.eval()  # Set to evaluation mode
            logger.info(f"Successfully loaded model {model_name} on {self.device}")
            
        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            raise

    @torch.no_grad()  # Disable gradient computation for inference
    def infer(self, prompt: str, max_new_tokens: int = 128, temperature: float = 0.7) -> str:
        """
        Generate a response to the given prompt
        
        Args:
            prompt: Input text to generate response for
            max_new_tokens: Maximum number of tokens to generate
            temperature: Sampling temperature (higher = more random)
            
        Returns:
            Generated text response
        """
        try:
            # Tokenize input
            inputs = self.tokenizer(
                prompt, 
                return_tensors="pt", 
                truncation=True,
                padding=True,
                max_length=1024  # Adjust based on model's context window
            ).to(self.device)
            
            # Generate response
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                do_sample=True,
                pad_token_id=self.tokenizer.eos_token_id,  # Prevent padding token generation
                eos_token_id=self.tokenizer.eos_token_id,  # Stop at end-of-sequence
                repetition_penalty=1.2,  # Discourage repetitive text
            )
            
            # Decode output
            generated_text = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            
            # Extract just the generated part (after the original prompt)
            if prompt in generated_text:
                response = generated_text[len(prompt):].strip()
            else:
                # If the model didn't echo the prompt, return the full generation
                response = generated_text[len(self.tokenizer.decode(inputs['input_ids'][0])):].strip()
                
            return response
            
        except Exception as e:
            logger.error(f"Error during inference: {e}")
            raise

    def batch_infer(self, prompts: list[str], max_new_tokens: int = 128, temperature: float = 0.7) -> list[str]:
        """
        Generate responses for multiple prompts in a batch
        
        Args:
            prompts: List of input texts
            max_new_tokens: Maximum number of tokens to generate per prompt
            temperature: Sampling temperature
            
        Returns:
            List of generated text responses
        """
        try:
            # Tokenize all prompts
            inputs = self.tokenizer(
                prompts,
                return_tensors="pt",
                truncation=True,
                padding=True,
                max_length=1024
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
            
            # Decode outputs
            responses = []
            for i, prompt in enumerate(prompts):
                generated_text = self.tokenizer.decode(outputs[i], skip_special_tokens=True)
                
                # Extract just the generated part
                if prompt in generated_text:
                    response = generated_text[len(prompt):].strip()
                else:
                    response = generated_text[len(prompt):].strip()
                    
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
                "available_gpus": torch.cuda.device_count()
            }
        else:
            return {
                "device": self.device
            }