Kilocde Extension Troubleshooting Guide for 'requestinit failed to send body' Error

COMMON CAUSES & SOLUTIONS:

1. BACKEND SERVER NOT RUNNING
   - Check if your SNAC v2 backend is running:
     * Look for node processes: tasklist | findstr node
     * Check if server.js is running on port 3000: netstat -ano | findstr :3000
   - Start it if needed: npm start (from backend directory)

2. KILOSCDE CONFIGURATION ISSUES
   - Verify extension settings:
     * Open Kilocde settings (usually in IDE settings/preferences)
     * Check that 'Backend URL' points to http://localhost:3000
     * Ensure authentication tokens are properly configured
   - Try resetting extension to default settings

3. NETWORK/CONNECTIVITY PROBLEMS
   - Test basic connectivity:
     * Ping localhost: ping -n 1 localhost
     * Test HTTP endpoint: curl http://localhost:3000/health
       (If curl not installed, use PowerShell: Invoke-WebRequest http://localhost:3000/health)
   - Check firewall: Ensure port 3000 is allowed for localhost connections

4. EXTENSION STATE CORRUPTION
   - Try these steps:
     * Reload/restart the Kilocde extension
     * Disable and re-enable the extension
     * If available: 'Reset Extension State' command in Kilocde
     * As last resort: Uninstall/reinstall Kilocde extension

5. ENVIRONMENT VARIABLES
   - Check critical variables for your backend:
     * PCM_AGENTS, PCM_BLIP_SECRET, KILO_WORKSPACE
     * These should be set in your .env or system environment
   - Verify with: echo %PCM_AGENTS% (Windows) or printenv PCM_AGENTS (if using WSL)

DIAGNOSTIC COMMANDS TO RUN (Share output as plain text):

1. Check backend status:
   tasklist | findstr node
   netstat -ano | findstr :3000

2. Test endpoint (if curl available):
   curl -v http://localhost:3000/health

3. Check extension logs (location varies by IDE):
   * VS Code: %APPDATA%\Code\logs\extensionHostProcess.log
   * Look for lines containing 'kilocde' or 'requestinit'

4. Environment variables:
   set | findstr PCM
   set | findstr KILO

NEXT STEPS:
1. Run the diagnostic commands above
2. Share the output using PLAIN TEXT (no angle brackets)
3. Tell me:
   - Is your backend server running?
   * What does the health check return?
   * Any specific Kilocde error messages you see in logs?
   - Have you tried restarting the extension/IDE?

This error is almost always resolvable - we just need to identify whether it's a server issue, configuration problem, or extension state corruption.

