// Legacy WhatsApp service - now uses Baileys service
const baileysService = require('./baileysService');

// Re-export Baileys functions with legacy names for compatibility
async function connectWithGuard(userId, agentId) {
  const result = await baileysService.safeInitializeWhatsApp(agentId, userId);
  if (!result?.success) {
    const errorMessage =
      result?.error ||
      (result?.status === 'connecting'
        ? 'Connection already in progress'
        : result?.status === 'cooldown'
        ? 'Please wait before retrying the connection'
        : 'Failed to initialize WhatsApp');
    const error = new Error(errorMessage);
    error.status = result?.status;
    throw error;
  }
  return result;
}

module.exports = {
  connectToWhatsApp: connectWithGuard,
  getSessionStatus: baileysService.getSessionStatus,
  getQRCode: baileysService.getQRCode,
  sendMessage: baileysService.sendMessage,
  disconnectWhatsApp: baileysService.disconnectWhatsApp,
  initializeExistingSessions: baileysService.initializeExistingSessions,
  activeSessions: baileysService.activeSessions,
};