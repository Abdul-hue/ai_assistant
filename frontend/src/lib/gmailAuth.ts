// Gmail OAuth Authentication Library (Backend API Integration)
import { API_URL } from "@/config";

/**
 * Initiates Gmail OAuth flow via backend
 * Redirects user to Google login page
 */
export const initiateGmailOAuth = async () => {
  try {
    const response = await fetch(`${API_URL}/api/gmail/auth`, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to initiate OAuth");
    }

    const data = await response.json();
    
    if (data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      throw new Error("No auth URL received from server");
    }
  } catch (error: any) {
    console.error("Gmail OAuth initiation error:", error);
    throw error;
  }
};

/**
 * Checks if Gmail is connected for current user
 */
export const isGmailConnected = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_URL}/api/gmail/status`, {
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.connected === true;
  } catch (error) {
    console.error("Gmail status check error:", error);
    return false;
  }
};

/**
 * Disconnects Gmail (removes tokens)
 */
export const disconnectGmail = async () => {
  try {
    const response = await fetch(`${API_URL}/api/gmail/disconnect`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to disconnect Gmail");
    }

    return await response.json();
  } catch (error: any) {
    console.error("Gmail disconnect error:", error);
    throw error;
  }
};

