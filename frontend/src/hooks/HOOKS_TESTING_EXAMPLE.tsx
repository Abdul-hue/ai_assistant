/**
 * Example Component for Testing React Query Hooks
 * 
 * Add this to Dashboard.tsx temporarily to test the hooks
 * Remove after verification
 */

import { useEffect } from 'react';
import { useAgents, useAgentDetails, useConnectWhatsApp, useDisconnectWhatsApp } from '@/hooks';

export function HooksTestingExample() {
  // Test 1: Fetch all agents
  const { data: agents, isLoading: agentsLoading, error: agentsError } = useAgents();

  // Test 2: Fetch details for first agent
  const firstAgentId = agents?.[0]?.id;
  const { data: details, isLoading: detailsLoading, error: detailsError } = useAgentDetails(firstAgentId);

  // Test 3: WhatsApp mutations
  const { mutate: connect, isPending: isConnecting } = useConnectWhatsApp();
  const { mutate: disconnect, isPending: isDisconnecting } = useDisconnectWhatsApp();

  // Log results to console
  useEffect(() => {
    if (agents) {
      console.log('📋 Agents List:', agents);
      console.log(`   Found ${agents.length} agents`);
    }
  }, [agents]);

  useEffect(() => {
    if (details) {
      console.log('📊 Agent Details:', details);
      console.log('   Agent Name:', details.agent.agent_name);
      console.log('   WhatsApp Session:', details.agent.whatsapp_session);
      console.log('   Total Messages:', details.statistics.total_messages);
    }
  }, [details]);

  if (agentsLoading) {
    return <div className="p-4">Loading agents...</div>;
  }

  if (agentsError) {
    return <div className="p-4 text-red-500">Error loading agents: {agentsError.message}</div>;
  }

  if (!agents || agents.length === 0) {
    return <div className="p-4">No agents found. Create one first!</div>;
  }

  return (
    <div className="p-4 space-y-4 border rounded bg-gray-50">
      <h2 className="text-xl font-bold">🧪 Hooks Testing</h2>
      
      {/* Agent List */}
      <div>
        <h3 className="font-semibold mb-2">Agents List:</h3>
        <ul className="space-y-1">
          {agents.map(agent => (
            <li key={agent.id} className="text-sm">
              • {agent.agent_name} ({agent.is_active ? '🟢 Active' : '🔴 Inactive'})
            </li>
          ))}
        </ul>
      </div>

      {/* Agent Details */}
      {firstAgentId && (
        <div>
          <h3 className="font-semibold mb-2">First Agent Details:</h3>
          {detailsLoading ? (
            <p className="text-sm">Loading details...</p>
          ) : detailsError ? (
            <p className="text-sm text-red-500">Error: {detailsError.message}</p>
          ) : details ? (
            <div className="text-sm space-y-1">
              <p><strong>Name:</strong> {details.agent.agent_name}</p>
              <p><strong>Description:</strong> {details.agent.description || 'None'}</p>
              <p><strong>WhatsApp:</strong> {
                details.agent.whatsapp_session 
                  ? `${details.agent.whatsapp_session.phone_number || 'Pending'} (${details.agent.whatsapp_session.status})`
                  : 'Not configured'
              }</p>
              <p><strong>Messages:</strong> {details.statistics.total_messages}</p>
              <p><strong>Last Message:</strong> {details.statistics.last_message_at || 'Never'}</p>
            </div>
          ) : null}
        </div>
      )}

      {/* Test Buttons */}
      {firstAgentId && (
        <div className="space-x-2">
          <button
            onClick={() => {
              console.log('🔌 Connecting WhatsApp for agent:', firstAgentId);
              connect(firstAgentId, {
                onSuccess: (data) => console.log('✅ Connect Success:', data),
                onError: (error) => console.error('❌ Connect Error:', error)
              });
            }}
            disabled={isConnecting}
            className="px-3 py-1 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            {isConnecting ? 'Connecting...' : 'Test Connect'}
          </button>

          <button
            onClick={() => {
              console.log('🔌 Disconnecting WhatsApp for agent:', firstAgentId);
              disconnect(firstAgentId, {
                onSuccess: (data) => console.log('✅ Disconnect Success:', data),
                onError: (error) => console.error('❌ Disconnect Error:', error)
              });
            }}
            disabled={isDisconnecting}
            className="px-3 py-1 bg-red-500 text-white rounded disabled:opacity-50"
          >
            {isDisconnecting ? 'Disconnecting...' : 'Test Disconnect'}
          </button>
        </div>
      )}

      <div className="text-xs text-gray-500 mt-4">
        💡 Open browser console to see detailed logs
      </div>
    </div>
  );
}

/**
 * HOW TO USE THIS TEST COMPONENT:
 * 
 * 1. Add to Dashboard.tsx:
 * 
 *    import { HooksTestingExample } from '@/hooks/HOOKS_TESTING_EXAMPLE';
 * 
 *    // Inside Dashboard component:
 *    return (
 *      <div>
 *        <HooksTestingExample />
 *        {/* ... rest of dashboard */}
 *      </div>
 *    );
 * 
 * 2. Login to your app
 * 
 * 3. Navigate to Dashboard
 * 
 * 4. Open DevTools → Console
 * 
 * 5. You should see:
 *    - 📋 Agents List: [...]
 *    - 📊 Agent Details: {...}
 * 
 * 6. Test the buttons:
 *    - Click "Test Connect" → Check console for success/error
 *    - Click "Test Disconnect" → Check console for success/error
 * 
 * 7. Verify in Network tab:
 *    - POST /api/agents/{id}/init-whatsapp (for connect)
 *    - GET /api/agents/{id}/disconnect-whatsapp (for disconnect)
 *    - Both should include Cookie header
 * 
 * 8. Check cache updates:
 *    - After mutation, queries should auto-refetch
 *    - Data should update without manual refresh
 * 
 * 9. Remove this component after testing
 */

export default HooksTestingExample;

