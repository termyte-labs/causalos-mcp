import { kernel } from '../src/client.js';
import { Sanitizer } from '../src/sanitizer.js';

async function testLogging() {
    console.log("Starting Failure Logging Verification...");
    
    const session_id = "verify_session_" + Date.now();
    
    try {
        console.log("1. Testing manual logSystemFailure...");
        const result = await kernel.logSystemFailure({
            session_id,
            label: "Test Verification Failure",
            error_message: "This is a simulated failure for verification purposes.",
            context: {
                test_id: "verify_123",
                secret_data: "REDACT_ME_PASSWORD"
            }
        });
        
        console.log("Log Result:", JSON.stringify(result, null, 2));
        
        if (result && result.id) {
            console.log("SUCCESS: Failure node created with ID:", result.id);
        } else {
            console.log("FAILURE: No node ID returned.");
        }
        
    } catch (err: any) {
        console.error("ERROR during verification:", err.message);
    }
}

testLogging();
