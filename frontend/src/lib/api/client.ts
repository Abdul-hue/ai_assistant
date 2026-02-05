/**
 * Centralized API Client Utility
 * 
 * Provides a consistent way to make API calls with proper URL construction,
 * credentials handling, and error management.
 */

import { API_URL, buildApiUrl } from '@/config';

/**
 * Default fetch options for API calls
 * Ensures credentials are always included for cookie-based authentication
 */
const defaultFetchOptions: RequestInit = {
  credentials: 'include', // CRITICAL: Required for HttpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
};

/**
 * Build a complete API URL from an endpoint
 * Handles both relative and absolute URLs correctly
 * 
 * @param endpoint - API endpoint (e.g., '/api/auth/me' or 'api/auth/me')
 * @returns Complete API URL
 */
export function getApiUrl(endpoint: string): string {
  return buildApiUrl(endpoint);
}

/**
 * Make an API request with proper error handling
 * 
 * @param endpoint - API endpoint
 * @param options - Fetch options (will be merged with defaults)
 * @returns Promise<Response>
 */
export async function apiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = getApiUrl(endpoint);
  
  // Merge options with defaults (options take precedence)
  const mergedOptions: RequestInit = {
    ...defaultFetchOptions,
    ...options,
    headers: {
      ...defaultFetchOptions.headers,
      ...options.headers,
    },
  };

  const response = await fetch(url, mergedOptions);
  return response;
}

/**
 * Make an API GET request
 * 
 * @param endpoint - API endpoint
 * @param options - Additional fetch options
 * @returns Promise<Response>
 */
export async function apiGet(endpoint: string, options: RequestInit = {}): Promise<Response> {
  return apiRequest(endpoint, {
    method: 'GET',
    ...options,
  });
}

/**
 * Make an API POST request
 * 
 * @param endpoint - API endpoint
 * @param data - Request body data (will be JSON stringified)
 * @param options - Additional fetch options
 * @returns Promise<Response>
 */
export async function apiPost(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<Response> {
  return apiRequest(endpoint, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
    ...options,
  });
}

/**
 * Make an API PUT request
 * 
 * @param endpoint - API endpoint
 * @param data - Request body data (will be JSON stringified)
 * @param options - Additional fetch options
 * @returns Promise<Response>
 */
export async function apiPut(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<Response> {
  return apiRequest(endpoint, {
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
    ...options,
  });
}

/**
 * Make an API PATCH request
 * 
 * @param endpoint - API endpoint
 * @param data - Request body data (will be JSON stringified)
 * @param options - Additional fetch options
 * @returns Promise<Response>
 */
export async function apiPatch(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<Response> {
  return apiRequest(endpoint, {
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined,
    ...options,
  });
}

/**
 * Make an API DELETE request
 * 
 * @param endpoint - API endpoint
 * @param options - Additional fetch options
 * @returns Promise<Response>
 */
export async function apiDelete(endpoint: string, options: RequestInit = {}): Promise<Response> {
  return apiRequest(endpoint, {
    method: 'DELETE',
    ...options,
  });
}

/**
 * Handle API response with error checking
 * Automatically parses JSON and throws errors for non-OK responses
 * 
 * @param response - Fetch response
 * @returns Promise with parsed JSON data
 */
export async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: { error?: string; message?: string } = {};
    try {
      errorData = await response.json();
    } catch {
      // If response is not JSON, use status text
      errorData = { message: response.statusText };
    }
    
    const error = new Error(errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    (error as Error & { status?: number; data?: unknown }).status = response.status;
    (error as Error & { status?: number; data?: unknown }).data = errorData;
    throw error;
  }
  
  // Handle empty responses
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    return {} as T;
  }
  
  return response.json();
}

/**
 * Make an API GET request and parse JSON response
 * 
 * @param endpoint - API endpoint
 * @param options - Additional fetch options
 * @returns Promise with parsed JSON data
 */
export async function apiGetJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await apiGet(endpoint, options);
  return handleApiResponse<T>(response);
}

/**
 * Make an API POST request and parse JSON response
 * 
 * @param endpoint - API endpoint
 * @param data - Request body data
 * @param options - Additional fetch options
 * @returns Promise with parsed JSON data
 */
export async function apiPostJson<T>(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiPost(endpoint, data, options);
  return handleApiResponse<T>(response);
}

/**
 * Make an API PUT request and parse JSON response
 * 
 * @param endpoint - API endpoint
 * @param data - Request body data
 * @param options - Additional fetch options
 * @returns Promise with parsed JSON data
 */
export async function apiPutJson<T>(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiPut(endpoint, data, options);
  return handleApiResponse<T>(response);
}

/**
 * Make an API PATCH request and parse JSON response
 * 
 * @param endpoint - API endpoint
 * @param data - Request body data
 * @param options - Additional fetch options
 * @returns Promise with parsed JSON data
 */
export async function apiPatchJson<T>(
  endpoint: string,
  data?: unknown,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiPatch(endpoint, data, options);
  return handleApiResponse<T>(response);
}

/**
 * Make an API DELETE request and parse JSON response
 * 
 * @param endpoint - API endpoint
 * @param options - Additional fetch options
 * @returns Promise with parsed JSON data
 */
export async function apiDeleteJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await apiDelete(endpoint, options);
  return handleApiResponse<T>(response);
}
