/**
 * ──────────────────────────────────────────────────────────────────────
 *  MODULE: security-middleware
 *  PURPOSE: Protect the SNAC backend from common web vulnerabilities by
 *           enforcing rate limits, security headers, and input sanitization.
 *
 *  RESPONSIBILITIES:
 *    • Rate-limit API requests to prevent abuse (100 req/15min per IP).
 *    • Set security headers (CSP, HSTS, X-Frame-Options) via Helmet.
 *    • Validate and sanitize user input to block XSS and injection attacks.
 *    • Prevent path traversal attacks through secure path resolution.
 *
 *  CONTEXT:
 *    • Belongs to: backend security layer.
 *    • Consumed by: server.js (main Express app), all API routes.
 *
 *  NOTES:
 *    • Rate limiter uses a 15-minute sliding window.
 *    • Input validation rejects payloads >10KB and blocks <script> tags.
 *    • Path traversal check uses path normalization + prefix validation.
 * ──────────────────────────────────────────────────────────────────────
 */

/**
 * Security Middleware for SNAC v2 Backend
 * Implements input validation, sanitization, and security protections
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const path = require('path');
const fs = require('fs').promises;

// Rate limiting configuration with proper cleanup
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Security headers configuration
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  hidePoweredBy: true,
});

// Input validation middleware
const validateInput = (req, res, next) => {
  try {
    // Validate input length
    if (req.body && req.body.input) {
      if (typeof req.body.input !== 'string') {
        return res.status(400).json({ 
          error: 'Invalid input: input must be a string' 
        });
      }
      
      if (req.body.input.length > 10000) { // Max 10k chars
        return res.status(400).json({ 
          error: 'Input too long: maximum 10000 characters allowed' 
        });
      }
      
      // Validate input contains no obvious script tags (basic XSS check)
      // Note: We do NOT escape/encode here - that corrupts legitimate code
      const scriptPattern = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
      if (scriptPattern.test(req.body.input)) {
        return res.status(400).json({
          error: 'Invalid input: script tags are not allowed'
        });
      }
    }
    
    // Validate options if present
    if (req.body.options) {
      // Ensure options is an object
      if (typeof req.body.options !== 'object' || Array.isArray(req.body.options)) {
        return res.status(400).json({ 
          error: 'Invalid options: options must be an object' 
        });
      }
      
      // Limit size of options
      const optionsSize = JSON.stringify(req.body.options).length;
      if (optionsSize > 5000) {
        return res.status(400).json({ 
          error: 'Options too large: maximum 5000 characters allowed' 
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Validation error:', error.message);
    return res.status(500).json({ 
      error: 'Internal server error during validation' 
    });
  }
};

// Secure path resolver to prevent traversal
const securePathJoin = (basePath, relativePath) => {
  // Normalize the path
  const normalizedPath = path.normalize(path.join(basePath, relativePath));
  
  // Verify the normalized path is within the base path
  const resolvedBase = path.resolve(basePath);
  const resolvedPath = path.resolve(normalizedPath);
  
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error('Path traversal detected');
  }
  
  return resolvedPath;
};

// Error sanitization middleware
const sanitizeError = (err, req, res, next) => {
  // Log the full error for internal use
  console.error('Error occurred:', err);
  
  // Return sanitized error to client
  const sanitizedError = {
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { details: err.message })
  };
  
  res.status(500).json(sanitizedError);
};

// Environment validation
const validateEnvironment = () => {
  const requiredEnvVars = [
    'KILO_WORKSPACE',
    'PCM_HOT',
    'PCM_WARM',
    'PCM_COLD',
    'PCM_AGENTS',
    'PCM_BLIP_SECRET'
  ];
  
  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

module.exports = {
  limiter,
  securityHeaders,
  validateInput,
  securePathJoin,
  sanitizeError,
  validateEnvironment
};