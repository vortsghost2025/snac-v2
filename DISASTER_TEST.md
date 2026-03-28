# SNAC v2 Chaos Test #1

## Objective
Test the resilience of the multi-agent coordination system under adverse conditions.

## Test Scenario: Lock Conflicts
Simulate what happens when two agents attempt to access conflicting resources.

### Step-by-step test procedure:

1. **Start all 4 agents working on their zones simultaneously**
   - dev-kimi works on src/agents/
   - dev-lingma works on src/memory/
   - dev-copilot works on infra/
   - dev-kilo works on src/orchestrator/

2. **While they're running, manually edit LOCKS.json to assign src/memory/ to dev-kimi**
   - This creates a conflict between dev-kimi and dev-lingma

3. **See if dev-lingma detects the stolen lock and halts gracefully**

4. **See if dev-kimi refuses to write to a zone not originally his**

5. **Measure recovery time — how long until human intervention restores order?**

## Expected outcome:
Within 60 seconds, both agents should detect inconsistency, halt operations, and emit loud error logs. No data corruption occurs.

---

## Implementation of Test Scenarios

### Test 1: Path Security Validation
```javascript
// Import the path resolver
const PathResolver = require('./src/agents/pathResolver');
const resolver = new PathResolver();

// Test cases for security
console.log(resolver.isValidPath('../../etc/passwd')); // Should be false
console.log(resolver.isValidPath('valid/path/file.js')); // Should be true
console.log(resolver.isValidPath('..%2F..%2Fetc%2Fpasswd')); // Should be false (encoded traversal)
```

### Test 2: Lease Expiration
```javascript
// Create message bus instance for testing
const MessageBus = require('./src/agents/MessageBus');
const bus = new MessageBus('dev-kimi');

// Simulate lease renewal
const result = await bus.renewLease('src/agents/');
console.log('Lease renewal result:', result);

// Check for expired locks
const released = await bus.checkExpiredLocks();
console.log('Released resources:', released);
```

### Test 3: Cross-Zone Access Prevention
```javascript
// Attempt to access a path outside of the agent's zone
try {
  resolver.resolvePath('dev-kimi', '../src/memory/dangerous-access.js');
} catch (error) {
  console.log('Security violation caught:', error.message);
  // This should throw an error as expected
}
```

## Running the Tests

1. Execute the path security validation:
```bash
node -e "
const PathResolver = require('./src/agents/pathResolver');
const resolver = new PathResolver();
console.log('Path security test:', resolver.isValidPath('../../etc/passwd'));
"
```

2. Test lease functionality:
```bash
node -e "
const MessageBus = require('./src/agents/MessageBus');
const bus = new MessageBus('dev-kimi');
(async () => {
  await bus.initialize();
  const result = await bus.renewLease('src/agents/');
  console.log('Lease renewal result:', result);
})();
"
```

3. Verify cross-zone protection:
```bash
node -e "
const PathResolver = require('./src/agents/pathResolver');
const resolver = new PathResolver();
try {
  const result = resolver.resolvePath('dev-kimi', '../src/memory/dangerous-access.js');
  console.log('ERROR: Should have thrown an exception');
} catch (error) {
  console.log('SUCCESS: Security violation caught:', error.message);
}
"
```

## Success Criteria

- ✅ No agent can access paths outside their designated zones
- ✅ Expired locks are automatically released
- ✅ Lease renewals work correctly
- ✅ Path traversal attempts are blocked
- ✅ No data corruption occurs during conflict scenarios
- ✅ Error logs are clear and actionable
- ✅ System recovers gracefully without human intervention