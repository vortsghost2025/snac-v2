/**
 * SNAC v2 Security & Performance Verification Script
 * Runs all checks mentioned in the code review
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

async function runVerification() {
  console.log("=== SNAC v2 Security & Performance Verification ===\n");

  // 1. Check for hardcoded Windows paths
  console.log("1. Checking for hardcoded Windows paths...");
  const serverJs = await fs.readFile('server.js', 'utf8');
  const hardcodedPaths = serverJs.match(/S:\\\\snac-v2\\\\snac-v2\\\\backend/g);
  if (hardcodedPaths) {
    console.log(`   ❌ Found ${hardcodedPaths.length} hardcoded Windows paths`);
  } else {
    console.log("   ✅ No hardcoded Windows paths found");
  }

  // 2. Check for secrets in .env
  console.log("\n2. Checking .env file for secrets...");
  try {
    const envContent = await fs.readFile('.env', 'utf8');
    const secretsFound = envContent.includes('SECRET') || envContent.includes('KEY') || envContent.includes('TOKEN');
    if (secretsFound) {
      console.log("   ⚠️  Secrets found in .env (this is expected)");
    } else {
      console.log("   ⚠️  No obvious secrets found in .env");
    }
  } catch (e) {
    console.log("   ⚠️  .env file not found");
  }

  // 3. Check .gitignore for .env exclusion
  console.log("\n3. Checking .gitignore for .env exclusion...");
  try {
    const gitignoreContent = await fs.readFile('.gitignore', 'utf8');
    const envIgnored = gitignoreContent.includes('.env');
    if (envIgnored) {
      console.log("   ✅ .env is excluded from git");
    } else {
      console.log("   ❌ .env is NOT in .gitignore - ADD NOW!");
    }
  } catch (e) {
    console.log("   ❌ .gitignore file not found");
  }

  // 4. Check if express-rate-limit is installed
  console.log("\n4. Checking for express-rate-limit installation...");
  try {
    const pkgJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    const hasRateLimit = pkgJson.dependencies && pkgJson.dependencies['express-rate-limit'];
    if (hasRateLimit) {
      console.log("   ✅ express-rate-limit is installed");
    } else {
      console.log("   ❌ express-rate-limit is NOT installed");
    }
  } catch (e) {
    console.log("   ⚠️  Could not read package.json");
  }

  // 5. Check for secure path resolution
  console.log("\n5. Checking for secure path resolution...");
  const securityMiddleware = await fs.readFile('security-middleware.js', 'utf8');
  const hasSecurePath = securityMiddleware.includes('securePathJoin');
  if (hasSecurePath) {
    console.log("   ✅ Secure path resolution is implemented");
  } else {
    console.log("   ❌ Secure path resolution NOT found");
  }

  // 6. Check for global.gc() usage
  console.log("\n6. Checking for global.gc() usage...");
  const meshJs = await fs.readFile('we/pcm/Mesh.js', 'utf8');
  const gcUsages = meshJs.match(/global\.gc\(\)/g);
  if (gcUsages) {
    console.log(`   ❌ Found ${gcUsages.length} uses of global.gc()`);
  } else {
    console.log("   ✅ No global.gc() usage found");
  }

  // 7. Check for graceful shutdown handler
  console.log("\n7. Checking for graceful shutdown handler...");
  const patchedServer = await fs.readFile('server.patched.js', 'utf8');
  const hasShutdownHandler = patchedServer.includes('SIGTERM') && patchedServer.includes('SIGINT');
  if (hasShutdownHandler) {
    console.log("   ✅ Graceful shutdown handler is implemented");
  } else {
    console.log("   ❌ Graceful shutdown handler NOT found");
  }

  // 8. Check for validation libraries
  console.log("\n8. Checking for validation libraries...");
  const hasValidator = securityMiddleware.includes('validator');
  if (hasValidator) {
    console.log("   ✅ Validation library (validator) is used");
  } else {
    console.log("   ❌ Validation library NOT found");
  }

  // 9. Check for optimized Mesh implementation
  console.log("\n9. Checking for optimized Mesh implementation...");
  try {
    const optimizedMesh = await fs.readFile('we/pcm/Mesh.optimized.js', 'utf8');
    const hasOptimizations = optimizedMesh.includes('pagination') && optimizedMesh.includes('cache');
    if (hasOptimizations) {
      console.log("   ✅ Optimized Mesh implementation found with pagination and caching");
    } else {
      console.log("   ❌ Optimized Mesh implementation found but lacks key optimizations");
    }
  } catch (e) {
    console.log("   ❌ Optimized Mesh implementation not found");
  }

  // 10. Check for test coverage
  console.log("\n10. Checking for test coverage...");
  try {
    const testExists = await fs.stat('__tests__/api.test.js');
    if (testExists) {
      console.log("   ✅ Test coverage exists");
    } else {
      console.log("   ❌ Test coverage not found");
    }
  } catch (e) {
    console.log("   ❌ Test coverage not found");
  }

  // 11. Check for CI/CD pipeline
  console.log("\n11. Checking for CI/CD pipeline...");
  try {
    const pipelineExists = await fs.stat('.github/workflows/ci-cd.yml');
    if (pipelineExists) {
      console.log("   ✅ CI/CD pipeline configuration found");
    } else {
      console.log("   ❌ CI/CD pipeline not found");
    }
  } catch (e) {
    console.log("   ❌ CI/CD pipeline not found");
  }

  // 12. Check for monitoring setup
  console.log("\n12. Checking for monitoring setup...");
  try {
    const monitoringExists = await fs.stat('monitoring/prometheus-setup.js');
    if (monitoringExists) {
      console.log("   ✅ Monitoring setup found");
    } else {
      console.log("   ❌ Monitoring setup not found");
    }
  } catch (e) {
    console.log("   ❌ Monitoring setup not found");
  }

  console.log("\n=== Verification Complete ===");
  console.log("\nReview the above results and address any ❌ or ⚠️ findings.");
  console.log("Most critical items are security-related (paths, secrets, validation).");
}

// Run the verification
runVerification().catch(console.error);