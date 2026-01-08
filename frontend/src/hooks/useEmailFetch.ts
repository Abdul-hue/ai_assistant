// @/hooks/useEmailFetch.ts - IMPROVED EMAIL FETCHING HOOK
import { useState, useCallback, useRef, useEffect } from 'react';
import { API_URL } from '@/config';
import type { EmailData, GmailMessagesResponse } from '@/lib/gmailApi';

/**
 * Email fetching state
 */
export interface EmailFetchState {
  emails: EmailData[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  totalLoaded: number;
  lastFetchTime: Date | null;
}

/**
 * Email fetch options
 */
export interface EmailFetchOptions {
  query?: string;
  pageToken?: string;
  maxResults?: number;
  silent?: boolean; // Don't show loading state
  signal?: AbortSignal; // For request cancellation
}

/**
 * Request cache to prevent duplicate requests
 */
const requestCache = new Map<string, Promise<GmailMessagesResponse>>();

/**
 * Generate cache key from fetch parameters
 */
function generateCacheKey(query: string, pageToken?: string): string {
  return `${query}::${pageToken || 'first'}`;
}

/**
 * Clear old cache entries
 */
function cleanupCache(): void {
  // Keep only recent 5 cache entries
  if (requestCache.size > 5) {
    const entries = Array.from(requestCache.entries());
    const toDelete = entries.slice(0, entries.length - 5);
    toDelete.forEach(([key]) => requestCache.delete(key));
  }
}

/**
 * Main hook for email fetching with comprehensive error handling
 */
export const useEmailFetch = () => {
  const [state, setState] = useState<EmailFetchState>({
    emails: [],
    loading: false,
    error: null,
    hasMore: false,
    totalLoaded: 0,
    lastFetchTime: null,
  });

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout>();
  const previousParamsRef = useRef<string>('');

  /**
   * Abort current request
   */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
  }, []);

  /**
   * Main fetch function with retry logic
   */
  const fetch = useCallback(
    async (
      query: string = 'in:inbox',
      options: EmailFetchOptions = {}
    ): Promise<EmailData[]> => {
      const {
        pageToken,
        maxResults = 30,
        silent = false,
        signal,
      } = options;

      // Prevent multiple simultaneous requests for same query
      const cacheKey = generateCacheKey(query, pageToken);
      if (requestCache.has(cacheKey)) {
        console.log(`📦 Using cached request for: ${query}`);
        try {
          const cachedResponse = await requestCache.get(cacheKey)!;
          
          if (!isMountedRef.current) return [];

          // Update state from cache
          setState(prev => ({
            ...prev,
            emails: pageToken 
              ? [...prev.emails, ...(cachedResponse.messages || [])]
              : cachedResponse.messages || [],
            hasMore: !!cachedResponse.nextPageToken,
            totalLoaded: pageToken
              ? prev.totalLoaded + (cachedResponse.messages?.length || 0)
              : cachedResponse.messages?.length || 0,
            lastFetchTime: new Date(),
            loading: false,
            error: null,
          }));
          return cachedResponse.messages || [];
        } catch (error: any) {
          if (!isMountedRef.current) return [];
          setState(prev => ({
            ...prev,
            error: error.message || 'Failed to fetch emails',
            loading: false,
          }));
          return [];
        }
      }

      // Abort previous request if different query
      const currentParams = `${query}::${maxResults}`;
      if (previousParamsRef.current !== currentParams) {
        abort();
        previousParamsRef.current = currentParams;
      }

      if (!silent) {
        setState(prev => ({
          ...prev,
          loading: true,
          error: null,
        }));
      }

      try {
        // Create abort controller for this request
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Set timeout (45 seconds)
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 45000);

        // Build query parameters
        const params = new URLSearchParams({
          query: query || 'in:inbox',
          maxResults: maxResults.toString(),
        });

        if (pageToken) {
          params.append('pageToken', pageToken);
        }

        // Create fetch promise
        const fetchPromise = (async () => {
          const response = await fetch(
            `${API_URL}/api/gmail/messages?${params.toString()}`,
            {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
              signal: signal || controller.signal,
            }
          );

          clearTimeout(timeoutId);

          if (!response.ok) {
            // Handle specific error cases
            if (response.status === 401) {
              throw new Error(
                'GMAIL_TOKEN_EXPIRED|Your Gmail session has expired. Please reconnect your account.'
              );
            }

            if (response.status === 403) {
              throw new Error(
                'GMAIL_PERMISSION_DENIED|Gmail permission denied. Please reconnect with proper permissions.'
              );
            }

            if (response.status >= 500) {
              throw new Error(
                `SERVER_ERROR|Server error: ${response.status}. Please try again.`
              );
            }

            const errorData = await response.json().catch(() => ({}));
            throw new Error(
              `HTTP_ERROR|${errorData.message || `HTTP ${response.status}`}`
            );
          }

          const data: GmailMessagesResponse = await response.json();

          if (!Array.isArray(data.messages)) {
            throw new Error('INVALID_RESPONSE|Invalid server response');
          }

          return data;
        })();

        // Store in cache
        requestCache.set(cacheKey, fetchPromise);
        cleanupCache();

        // Wait for response
        const response = await fetchPromise;

        if (!isMountedRef.current) return [];

        // Deduplicate emails
        const newEmails = response.messages || [];
        const existingIds = new Set(state.emails.map(e => e.id));
        const uniqueNewEmails = newEmails.filter(e => !existingIds.has(e.id));

        // Update state
        setState(prev => ({
          ...prev,
          emails: pageToken 
            ? [...prev.emails, ...uniqueNewEmails]
            : uniqueNewEmails,
          hasMore: !!response.nextPageToken,
          totalLoaded: pageToken
            ? prev.totalLoaded + uniqueNewEmails.length
            : uniqueNewEmails.length,
          loading: false,
          error: null,
          lastFetchTime: new Date(),
        }));

        abortControllerRef.current = null;
        return uniqueNewEmails;
      } catch (error: any) {
        // Don't update state if unmounted or request aborted
        if (!isMountedRef.current) return [];

        if (error.name === 'AbortError') {
          setState(prev => ({
            ...prev,
            loading: false,
            error: null, // Don't show error for aborted requests
          }));
          return [];
        }

        // Parse error message
        const errorMessage = parseErrorMessage(error.message);
        
        setState(prev => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));

        console.error('❌ Fetch emails error:', error);
        return [];
      } finally {
        abortControllerRef.current = null;
        // Remove from cache on completion
        requestCache.delete(cacheKey);
      }
    },
    [state.emails, abort]
  );

  /**
   * Clear all emails and errors
   */
  const clear = useCallback(() => {
    abort();
    setState({
      emails: [],
      loading: false,
      error: null,
      hasMore: false,
      totalLoaded: 0,
      lastFetchTime: null,
    });
  }, [abort]);

  /**
   * Load next page
   */
  const loadMore = useCallback(
    async (query: string, nextPageToken?: string) => {
      if (!nextPageToken || state.loading) return [];
      return fetch(query, { pageToken: nextPageToken });
    },
    [fetch, state.loading]
  );

  /**
   * Retry last fetch
   */
  const retry = useCallback(
    (query: string) => {
      if (state.loading) return Promise.resolve([]);
      return fetch(query, { silent: false });
    },
    [fetch, state.loading]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abort();
      requestCache.clear();
    };
  }, [abort]);

  return {
    ...state,
    fetch,
    clear,
    abort,
    loadMore,
    retry,
  };
};

/**
 * Parse error message with type
 */
function parseErrorMessage(message: string): string {
  if (!message) return 'Failed to load emails';

  // Format: TYPE|USER_MESSAGE
  const [type, userMessage] = message.split('|');

  switch (type) {
    case 'GMAIL_TOKEN_EXPIRED':
      return userMessage || 'Your Gmail session expired. Please reconnect.';
    case 'GMAIL_PERMISSION_DENIED':
      return userMessage || 'Gmail permission denied. Please reconnect.';
    case 'SERVER_ERROR':
      return userMessage || 'Server error. Please try again.';
    case 'INVALID_RESPONSE':
      return userMessage || 'Unexpected server response. Please try again.';
    case 'HTTP_ERROR':
      return userMessage || 'Request failed. Please try again.';
    default:
      // Check for timeout
      if (message.includes('timeout')) {
        return 'Request timed out. Check your connection and try again.';
      }
      // Check for network error
      if (message.includes('Network') || message.includes('TypeError')) {
        return 'Network error. Check your connection and try again.';
      }
      return message || 'Failed to load emails';
  }
}

