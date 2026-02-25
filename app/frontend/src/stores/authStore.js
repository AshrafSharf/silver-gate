import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isInitialized: false,
      isInitializing: false,
      initializationAttempts: 0,

      initialize: async (retryCount = 0) => {
        const { token, isInitializing, isInitialized } = get();

        // Prevent concurrent initialization calls
        if (isInitializing) {
          return;
        }

        // Don't re-initialize if already initialized (unless retrying)
        if (isInitialized && retryCount === 0) {
          return;
        }

        set({ isInitializing: true });

        // If no token exists, mark as initialized and return
        if (!token) {
          set({ isInitialized: true, isInitializing: false });
          return;
        }

        try {
          // Attempt to validate the token with the backend
          const response = await api.get('/auth/me');
          set({
            user: response.data,
            isInitialized: true,
            isInitializing: false,
            initializationAttempts: 0
          });
        } catch (error) {
          // Check if it's an authentication error (401/403) using ApiError properties
          const isAuthError = error.isAuthError || error.statusCode === 401 || error.statusCode === 403;

          if (isAuthError) {
            // Token is invalid or expired - clear authentication
            console.warn('Authentication failed: Invalid or expired token');
            set({
              user: null,
              token: null,
              isInitialized: true,
              isInitializing: false,
              initializationAttempts: 0
            });
          } else {
            // Network or other error - retry with exponential backoff
            const maxRetries = 3;
            const shouldRetry = retryCount < maxRetries;

            if (shouldRetry) {
              const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
              console.warn(`Authentication check failed (attempt ${retryCount + 1}/${maxRetries}), retrying in ${delay}ms...`);

              set({
                initializationAttempts: retryCount + 1,
                isInitializing: false
              });

              setTimeout(() => {
                get().initialize(retryCount + 1);
              }, delay);
            } else {
              // Max retries reached - assume network is unavailable but keep token
              console.error('Authentication check failed after max retries, keeping existing token');
              set({
                isInitialized: true,
                isInitializing: false,
                initializationAttempts: 0
              });
            }
          }
        }
      },

      login: async (username, password) => {
        const response = await api.post('/auth/login', { username, password });
        const { token, user } = response.data;
        set({ user, token, isInitialized: true });
        return user;
      },

      register: async (email, password, name) => {
        const response = await api.post('/auth/register', { email, password, name });
        const { token, user } = response.data;
        set({ user, token, isInitialized: true });
        return user;
      },

      logout: () => {
        set({ user: null, token: null, isInitialized: true });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
    }
  )
);

// Helper function for api.js to access the current token
export const getAuthToken = () => {
  const state = useAuthStore.getState();
  return state.token;
};
