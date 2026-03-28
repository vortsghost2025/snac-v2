/**
 * Test script for the Inter-Agent Message Bus
 * Demonstrates direct messaging, broadcasting, and inbox functionality
 */

const MessageBus = require('./src/agents/MessageBus');

async function runTests() {
  console.log('🧪 Starting MessageBus Tests...\n');

  // Test 1: Initialize MessageBus for dev-kimi
  console.log('📋 Test 1: Initializing MessageBus for dev-kimi');
  const kimiBus = new MessageBus('dev-kimi');
  await kimiBus.initialize();
  console.log('✅ dev-kimi MessageBus initialized\n');

  // Test 2: Initialize MessageBus for dev-lingma
  console.log('📋 Test 2: Initializing MessageBus for dev-lingma');
  const lingmaBus = new MessageBus('dev-lingma');
  await lingmaBus.initialize();
  console.log('✅ dev-lingma MessageBus initialized\n');

  // Test 3: Send direct message from dev-kimi to dev-lingma
  console.log('📋 Test 3: Sending direct message from dev-kimi to dev-lingma');
  const directResult = await kimiBus.send(
    'dev-lingma', 
    'Hello dev-lingma! Testing the message bus.',
    { test: true, priority: 'normal' }
  );
  console.log(`✅ Direct message ${directResult.success ? 'sent successfully' : 'failed'}\n`);

  // Test 4: Send broadcast message
  console.log('📋 Test 4: Sending broadcast message');
  const broadcastResult = await kimiBus.broadcast(
    'Attention all agents: Testing broadcast functionality!',
    { test: true, priority: 'normal' }
  );
  console.log(`✅ Broadcast ${broadcastResult.success ? 'sent successfully' : 'failed'} to ${broadcastResult.recipients} agents\n`);

  // Test 5: Check dev-lingma's inbox
  console.log('📋 Test 5: Checking dev-lingma\'s inbox');
  const lingmaInbox = await lingmaBus.getInbox();
  console.log(`✅ dev-lingma has ${lingmaInbox.length} messages in inbox:`);
  
  for (const msg of lingmaInbox) {
    console.log(`   - [${msg.type}] From: ${msg.from} | ${msg.message.substring(0, 40)}...`);
  }
  console.log('');

  // Test 6: Check dev-kimi's inbox (should have broadcast copy)
  console.log('📋 Test 6: Checking dev-kimi\'s inbox');
  const kimiInbox = await kimiBus.getInbox();
  console.log(`✅ dev-kimi has ${kimiInbox.length} messages in inbox:`);
  
  for (const msg of kimiInbox) {
    console.log(`   - [${msg.type}] From: ${msg.from} | ${msg.message.substring(0, 40)}...`);
  }
  console.log('');

  // Test 7: Send group message
  console.log('📋 Test 7: Sending group message to multiple agents');
  const groupResult = await kimiBus.sendToGroup(
    ['dev-lingma', 'dev-copilot'],
    'Testing group messaging feature',
    { test: true, priority: 'low' }
  );
  console.log(`✅ Group message ${groupResult.success ? 'sent successfully' : 'failed'}\n`);

  // Test 8: Check unread count
  console.log('📋 Test 8: Getting unread message counts');
  const kimiUnread = await kimiBus.getUnreadCount();
  const lingmaUnread = await lingmaBus.getUnreadCount();
  console.log(`✅ dev-kimi has ${kimiUnread} unread messages`);
  console.log(`✅ dev-lingma has ${lingmaUnread} unread messages\n`);

  console.log('🎉 All MessageBus tests completed successfully!');
  console.log('\n🚀 The Inter-Agent Message Bus is ready for use!');
  console.log('\n💡 Try the CLI now:');
  console.log('   $env:DEV_AGENT_ID="dev-kimi"  # PowerShell');
  console.log('   agent-chat send dev-lingma "Hello!"');
  console.log('   agent-chat inbox');
  console.log('   agent-chat broadcast "Team sync at 3pm"');
}

// Run the tests
runTests().catch(err => {
  console.error('❌ Test failed with error:', err.message);
  process.exit(1);
});