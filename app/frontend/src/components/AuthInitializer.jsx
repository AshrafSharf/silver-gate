import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * AuthInitializer Component
 *
 * Handles authentication initialization after React has mounted.
 * This component ensures that the token validation happens at the
 * right time in the React lifecycle, preventing race conditions
 * and premature logout issues.
 *
 * Uses a ref to prevent double initialization in React StrictMode.
 */
export default function AuthInitializer({ children }) {
  const initialize = useAuthStore((state) => state.initialize);
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Prevent double initialization in React StrictMode
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initialize();
    }
  }, []); // Empty deps array - only run once

  return children;
}
