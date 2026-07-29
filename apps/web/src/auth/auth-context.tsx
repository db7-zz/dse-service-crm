"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthenticatedUser } from "@dse/shared";
import { apiClient } from "./api";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthenticatedUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const current = await apiClient.request<AuthenticatedUser>("/auth/me");
      setUser(current);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiClient.request<{ user: AuthenticatedUser; expiresAt: string }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
    );
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    await apiClient.request<{ loggedOut: true }>("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
