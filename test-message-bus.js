// Test the Inter-Agent Message Bus
const { MessageBus } = require('./src/agents/MessageBus');

async function test() {
    console.log('Testing Inter-Agent Message Bus...\n');
    
    // Create message bus for dev-kimi
    const bus = new MessageBus('dev-kimi');
    await bus.initialize();
    
    // Send message to dev-lingma
    console.log('1. Sending message to dev-lingma...');
    const result = await bus.send('dev-lingma', 'Hello from dev-kimi! Message Bus is working.', 'message');
    console.log('Result:', result);
    
    // Check dev-lingma's inbox
    console.log('\n2. Checking dev-lingma inbox...');
    const lingmaBus = new MessageBus('dev-lingma');
    await lingmaBus.initialize();
    const inbox = await lingmaBus.getInbox();
    console.log(`Found ${inbox.length} messages:`);
    inbox.forEach(m => {
        console.log(`  - From: ${m.from}, Type: ${m.type}`);
        console.log(`    Content: ${m.message.substring(0, 50)}...`);
    });
    
    // Send reply
    if (inbox.length > 0) {
        console.log('\n3. Sending reply from dev-lingma...');
        const reply = await lingmaBus.send('dev-kimi', 'Got your message! - dev-lingma', 'response');
        console.log('Reply sent:', reply);
    }
    
    // Check dev-kimi's inbox
    console.log('\n4. Checking dev-kimi inbox for reply...');
    const myInbox = await bus.getInbox();
    console.log(`Found ${myInbox.length} messages`);
    
    console.log('\n✅ Message Bus test complete!');
}

test().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
