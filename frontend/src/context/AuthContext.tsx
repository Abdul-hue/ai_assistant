import React, { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { fetchProfile as fetchProfileApi, type Profile } from '@/lib/api/profile';
import { API_URL } from '@/config';

// Types
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (profile: Profile | null) => void;
}

interface AuthProviderProps {
  children: ReactNode;
}

// Global state for session management (React Strict Mode proof)
let authSubscription: ReturnType<typeof supabase.auth.onAuthStateChange>['data']['subscription'] | null = null;
let pendingSessionCreation: Promise<{ user: User }> | null = null;
let sessionCreationInProgress = false;
let sessionCreationTimeout: ReturnType<typeof setTimeout> | null = null;

// Context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const mountCount = useRef(0);

  const loadProfile = useCallback(async () => {
    try {
      setProfileLoading(true);
      const data = await fetchProfileApi();
      setProfile(data);
    } catch (error) {
      console.warn('⚠️  Failed to load profile:', error instanceof Error ? error.message : 'Unknown error');
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (hasInitializedRef.current) {
      console.log('⏭️  AuthProvider effect already initialized – skipping duplicate (StrictMode)');
      return;
    }
    hasInitializedRef.current = true;

    mountCount.current += 1;
    const currentMount = mountCount.current;
    console.log(`🔧 AuthProvider mount #${currentMount}`);

    // Check for existing session on mount with proper error handling
    const initializeAuth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: 'include',
        });
        
        if (response.status === 429) {
          console.warn('⚠️  Session check returned 429: Too Many Requests');
          setUser(null);
          setProfile(null);
          return;
        }

        if (response.ok) {
          const data = await response.json() as { user: User };
          setUser(data.user);
          console.log('✅ Existing session restored:', data.user.email);
          
          // Restore Supabase client session from cookies
          try {
            const tokenResponse = await fetch(`${API_URL}/api/auth/session-token`, {
              credentials: 'include',
            });
            
            if (tokenResponse.ok) {
              const tokenData = await tokenResponse.json() as { access_token: string; refresh_token?: string };
              if (tokenData.access_token) {
                // Restore Supabase client session
                const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                  access_token: tokenData.access_token,
                  refresh_token: tokenData.refresh_token || '',
                });
                
                if (sessionError) {
                  console.warn('⚠️  Failed to restore Supabase session:', sessionError.message);
                } else {
                  console.log('✅ Supabase client session restored');
                  setSession(sessionData.session);
                }
              }
            } else {
              console.warn('⚠️  Failed to get session token:', tokenResponse.status);
            }
          } catch (tokenError) {
            console.warn('⚠️  Error restoring Supabase session:', tokenError instanceof Error ? tokenError.message : 'Unknown error');
            // Non-critical error - continue anyway
          }
          
          await loadProfile();
        } else if (response.status === 401) {
          // This is NORMAL when user is not logged in
          console.log('ℹ️  No active session (not logged in)');
          setUser(null);
          setProfile(null);
        } else {
          // Other unexpected status codes
          console.warn(`⚠️  Session check returned ${response.status}: ${response.statusText}`);
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        // Network error or server unreachable
        if (error instanceof Error && error.message.includes('Failed to fetch')) {
          console.error('❌ Failed to connect to backend - is it running on', API_URL + '?');
        } else {
          console.error('❌ Session check error:', error instanceof Error ? error.message : 'Unknown error');
        }
        setUser(null);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    // Create session cookies with promise deduplication and debouncing
    const createSessionCookies = async (session: Session): Promise<{ user: User }> => {
      // Debouncing: Cancel previous timeout
      if (sessionCreationTimeout) {
        clearTimeout(sessionCreationTimeout);
        sessionCreationTimeout = null;
      }
      
      // Prevent duplicate calls if already in progress
      if (sessionCreationInProgress) {
        console.log('⏭️  Session creation already in progress, skipping...');
        if (pendingSessionCreation) {
          return pendingSessionCreation;
        }
        throw new Error('Session creation in progress');
      }
      
      // If there's already a pending request, return that promise
      if (pendingSessionCreation) {
        console.log('⏭️  Reusing pending session creation (race condition prevented)');
        return pendingSessionCreation;
      }

      sessionCreationInProgress = true;
      
      // Create the promise and store it globally
      pendingSessionCreation = (async () => {
        try {
          console.log('✅ Creating session cookies...');

          const response = await fetch(`${API_URL}/api/auth/session`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Idempotency-Key': `${session.user.id}-${session.access_token.slice(-10)}`, // Idempotency protection
            },
            credentials: 'include',
            body: JSON.stringify({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            }),
          });

          if (response.status === 429) {
            const retryAfter = ((await response.json().catch(() => ({}))) as { retryAfter?: number })?.retryAfter ?? 60;
            console.warn(`⚠️  Session creation throttled. Retry after ${retryAfter}s`);
            throw new Error(JSON.stringify({
              error: 'Too many requests',
              message: `Please wait ${retryAfter} seconds before trying again`,
              retryAfter
            }));
          }

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; message?: string };
            console.error('❌ Session creation failed:', errorData);
            throw new Error(JSON.stringify(errorData));
          }

          const userData = await response.json() as { user: User };
          console.log('✅ Session cookies created for:', userData.user.email);
          
          setUser(userData.user);
          await loadProfile();

          // SECURITY: Clean up Supabase localStorage tokens
          Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
              localStorage.removeItem(key);
              console.log('✅ Cleared localStorage token:', key);
            }
          });

          return userData;

        } catch (error) {
          console.error('❌ Failed to create session cookies:', error instanceof Error ? error.message : 'Unknown error');
          throw error;
        } finally {
          // Reset flags after delay to allow future sessions (debounce cooldown)
          sessionCreationTimeout = setTimeout(() => {
            sessionCreationInProgress = false;
            pendingSessionCreation = null;
            console.log('🔧 Cleared session creation flags (1 second cooldown)');
          }, 1000); // 1 second cooldown
        }
      })();

      return pendingSessionCreation;
    };

    // Only create ONE subscription globally (singleton pattern)
    if (!authSubscription) {
      console.log('🔧 Creating NEW auth subscription (global singleton)');
      
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event: AuthChangeEvent, newSession: Session | null) => {
          console.log(`🔄 Auth event: ${event} (from global subscription)`);

          if (event === 'SIGNED_IN' && newSession) {
            // Use promise deduplication to prevent race conditions
            await createSessionCookies(newSession);
            setSession(newSession);
            await loadProfile();
          } else if (event === 'SIGNED_OUT') {
            console.log('👋 User signed out');
            setUser(null);
            setSession(null);
            pendingSessionCreation = null;
            setProfile(null);
            setProfileLoading(false);
          } else if (event === 'TOKEN_REFRESHED' && newSession) {
            console.log('⏭️  Token refreshed (no action needed - cookies still valid)');
            setSession(newSession);
          } else if (event === 'INITIAL_SESSION') {
            // This fires on page load - no action needed
            console.log('⏭️  INITIAL_SESSION event (no session creation needed)');
            setSession(newSession);
            if (newSession) {
              await loadProfile();
            }
          } else {
            // Other events (USER_UPDATED, PASSWORD_RECOVERY, etc.)
            console.log(`⏭️  Event ${event} (no action needed)`);
            setSession(newSession);
          }
        }
      );

      authSubscription = subscription;
    } else {
      console.log('⏭️  Reusing existing auth subscription (singleton already exists)');
    }

    // Cleanup on unmount
    return () => {
      console.log(`🔧 AuthProvider unmount #${currentMount}`);
      // Don't unsubscribe - keep singleton alive across remounts
      // Only React will clean this up when the entire app unmounts
    };
  }, [loadProfile]);

  // SECURITY: Login with Supabase OAuth (Google)
  const login = async (): Promise<void> => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      
      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('❌ Login error:', error);
      throw error;
    }
  };

  // SECURITY: Logout clears both backend cookies and Supabase session
  const logout = async (): Promise<void> => {
    try {
      // Step 1: Clear backend HttpOnly cookies
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });

      // Step 2: Sign out from Supabase (will trigger SIGNED_OUT event)
      await supabase.auth.signOut();

      // Step 3: Clean up any remaining localStorage tokens
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') || key === 'jwt_token' || key === 'user_data') {
          localStorage.removeItem(key);
        }
      });

      // Step 4: Reset state
      setUser(null);
      setSession(null);
      setProfile(null);
      setProfileLoading(false);
      pendingSessionCreation = null;
      
      console.log('✅ Logout complete');
    } catch (error) {
      console.error('❌ Logout error:', error);
      throw error;
    }
  };

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const value: AuthContextType = {
    user,
    session,
    loading,
    profile,
    profileLoading,
    login,
    logout,
    refreshProfile,
    setProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
