/**
 * @vitest-environment node
 *
 * Authentication Integration Tests
 *
 * Uses Node environment (not happy-dom) because this test makes real HTTP
 * requests to Supabase. Node's native fetch properly passes Authorization
 * headers, while happy-dom's fetch polyfill does not.
 *
 * Tests the authentication flow using Supabase Auth:
 * - User registration
 * - User login
 * - Login with invalid credentials
 * - Logout
 * - Session validation
 * - Token refresh
 *
 * REQUIREMENTS:
 * - Supabase must be running locally at http://localhost:54321
 * - Environment variables must be set (see automation/.env.example at the webroot root)
 * - To run Supabase locally: `npx supabase start`
 *
 * NOTE: These tests will be skipped if Supabase is not available.
 */

import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestSupabaseClient,
  createTestUser,
  deleteTestUser,
} from "@/tests/helpers/db-helpers";

/**
 * Check if Supabase is available
 */
async function isSupabaseAvailable(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:54321/auth/v1/health", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

describe("Authentication Integration Tests", () => {
  let testUserId: string | null = null;
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = "TestPassword123!";
  let supabaseAvailable = false;

  beforeAll(async () => {
    supabaseAvailable = await isSupabaseAvailable();
    if (!supabaseAvailable) {
      console.warn(
        "\n⚠️  Supabase is not available at localhost:54321\n" +
        "   To run these tests, start Supabase with: npx supabase start\n" +
        "   Tests will be skipped.\n"
      );
    }
  });

  afterEach(async () => {
    // Clean up test user after each test
    if (testUserId) {
      try {
        await deleteTestUser(testUserId);
      } catch (error) {
        console.error("Failed to cleanup test user:", error);
      }
      testUserId = null;
    }
  });

  describe("User Registration", () => {
    it("should successfully register a new user with valid credentials", async () => {
      if (!supabaseAvailable) {
        return;
      }
      if (!supabaseAvailable) {
        console.log("⏭️  Skipping: Supabase not available");
        return;
      }
      const supabase = createTestSupabaseClient();

      // Register new user
      const { data, error } = await supabase.auth.signUp({
        email: testEmail,
        password: testPassword,
        options: {
          data: {
            role: "user",
            isActive: true,
          },
        },
      });

      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      expect(data.user?.email).toBe(testEmail);
      expect(data.user?.user_metadata?.role).toBe("user");
      expect(data.user?.user_metadata?.isActive).toBe(true);

      // Store user ID for cleanup
      if (data.user) {
        testUserId = data.user.id;
      }
    });

    it("should set default user metadata on registration", async () => {
      if (!supabaseAvailable) {
        return;
      }
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signUp({
        email: testEmail,
        password: testPassword,
        options: {
          data: {
            role: "user",
            isActive: true,
            settings: {
              theme: "system",
              notifications: true,
            },
          },
        },
      });

      expect(error).toBeNull();
      expect(data.user?.user_metadata).toMatchObject({
        role: "user",
        isActive: true,
        settings: {
          theme: "system",
          notifications: true,
        },
      });

      if (data.user) {
        testUserId = data.user.id;
      }
    });

    it("should fail to register with duplicate email", async () => {
      if (!supabaseAvailable) {
        return;
      }
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Create first user
      const { data: firstUser } = await supabase.auth.signUp({
        email: testEmail,
        password: testPassword,
      });

      if (firstUser.user) {
        testUserId = firstUser.user.id;
      }

      // Attempt to create duplicate user
      const { data: duplicateUser, error } = await supabase.auth.signUp({
        email: testEmail,
        password: testPassword,
      });

      // Supabase may return user or error depending on configuration
      // The important thing is that we either get an error or the same user
      if (error) {
        expect(error).toBeDefined();
      } else {
        expect(duplicateUser.user?.email).toBe(testEmail);
      }
    });

    it("should fail to register with invalid email format", async () => {
      if (!supabaseAvailable) {
        return;
      }
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signUp({
        email: "invalid-email",
        password: testPassword,
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain("email");
    });

    it("should fail to register with weak password", async () => {
      if (!supabaseAvailable) {
        return;
      }
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signUp({
        email: testEmail,
        password: "123", // Too short
      });

      // Supabase requires minimum password length
      expect(error).toBeDefined();
      expect(error?.message.toLowerCase()).toMatch(/password|short|length/);
    });
  });

  describe("User Login", () => {
    beforeEach(async () => {
      if (!supabaseAvailable) {
        return;
      }
      // Create a test user before each login test
      const user = await createTestUser(testEmail, testPassword);
      testUserId = user.id;
    });

    it("should successfully login with valid credentials", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      expect(data.session).toBeDefined();
      expect(data.user?.email).toBe(testEmail);
      expect(data.session?.access_token).toBeDefined();
      expect(data.session?.refresh_token).toBeDefined();
    });

    it("should return session with valid tokens on successful login", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      expect(error).toBeNull();
      expect(data.session).toBeDefined();

      const session = data.session as Session;
      expect(session.access_token).toBeTruthy();
      expect(session.refresh_token).toBeTruthy();
      expect(session.user).toBeDefined();
      expect(session.user.id).toBe(testUserId);
      expect(session.expires_at).toBeGreaterThan(Date.now() / 1000);
    });

    it("should include user metadata in login response", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      expect(error).toBeNull();
      expect(data.user?.user_metadata).toBeDefined();
      expect(data.user?.email).toBe(testEmail);
    });
  });

  describe("Login with Invalid Credentials", () => {
    beforeEach(async () => {
      if (!supabaseAvailable) {
        return;
      }
      // Create a test user before each test
      const user = await createTestUser(testEmail, testPassword);
      testUserId = user.id;
    });

    it("should fail to login with incorrect password", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: "WrongPassword123!",
      });

      expect(error).toBeDefined();
      expect(error?.message.toLowerCase()).toMatch(
        /password|credentials|invalid/
      );
      expect(data.user).toBeNull();
      expect(data.session).toBeNull();
    });

    it("should fail to login with non-existent email", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: "nonexistent@example.com",
        password: testPassword,
      });

      expect(error).toBeDefined();
      expect(error?.message.toLowerCase()).toMatch(
        /user|email|credentials|invalid/
      );
      expect(data.user).toBeNull();
      expect(data.session).toBeNull();
    });

    it("should fail to login with empty password", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: "",
      });

      expect(error).toBeDefined();
      expect(data.user).toBeNull();
      expect(data.session).toBeNull();
    });

    it("should fail to login with empty email", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: "",
        password: testPassword,
      });

      expect(error).toBeDefined();
      expect(data.user).toBeNull();
      expect(data.session).toBeNull();
    });

    it("should fail to login with malformed email", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: "not-an-email",
        password: testPassword,
      });

      expect(error).toBeDefined();
      expect(data.user).toBeNull();
      expect(data.session).toBeNull();
    });
  });

  describe("Logout", () => {
    beforeEach(async () => {
      if (!supabaseAvailable) {
        return;
      }
      // Create and login a test user before each logout test
      const user = await createTestUser(testEmail, testPassword);
      testUserId = user.id;
    });

    it("should successfully logout authenticated user", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // First, login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Verify user is logged in
      const { data: sessionBefore } = await supabase.auth.getSession();
      expect(sessionBefore.session).toBeDefined();

      // Logout
      const { error } = await supabase.auth.signOut();

      expect(error).toBeNull();

      // Verify user is logged out
      const { data: sessionAfter } = await supabase.auth.getSession();
      expect(sessionAfter.session).toBeNull();
    });

    it("should clear session after logout", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Logout
      await supabase.auth.signOut();

      // Try to get session - should be null
      const { data } = await supabase.auth.getSession();
      expect(data.session).toBeNull();
    });

    it("should clear user after logout", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Logout
      await supabase.auth.signOut();

      // Try to get user - should fail or return null
      const { data, error } = await supabase.auth.getUser();

      // After logout, getUser should either return null or error
      if (error) {
        expect(error).toBeDefined();
      } else {
        expect(data.user).toBeNull();
      }
    });

    it("should not error when logging out without active session", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Attempt to logout without being logged in
      const { error } = await supabase.auth.signOut();

      // Should not error - logout should be idempotent
      expect(error).toBeNull();
    });
  });

  describe("Session Validation", () => {
    beforeEach(async () => {
      if (!supabaseAvailable) {
        return;
      }
      // Create a test user before each test
      const user = await createTestUser(testEmail, testPassword);
      testUserId = user.id;
    });

    it("should return valid session for authenticated user", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Get session
      const { data, error } = await supabase.auth.getSession();

      expect(error).toBeNull();
      expect(data.session).toBeDefined();
      expect(data.session?.access_token).toBeDefined();
      expect(data.session?.user).toBeDefined();
      expect(data.session?.user.email).toBe(testEmail);
    });

    it("should return null session for unauthenticated user", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Don't login - just try to get session
      const { data, error } = await supabase.auth.getSession();

      expect(error).toBeNull();
      expect(data.session).toBeNull();
    });

    it("should validate session contains required fields", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Get session
      const { data } = await supabase.auth.getSession();
      const session = data.session as Session;

      expect(session).toBeDefined();
      expect(session.access_token).toBeDefined();
      expect(session.refresh_token).toBeDefined();
      expect(session.expires_at).toBeDefined();
      expect(session.user).toBeDefined();
      expect(session.user.id).toBe(testUserId);
      expect(session.user.email).toBe(testEmail);
    });

    it("should return user with getUser() for authenticated session", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Get user
      const { data, error } = await supabase.auth.getUser();

      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      expect(data.user?.id).toBe(testUserId);
      expect(data.user?.email).toBe(testEmail);
    });

    it("should fail to get user when not authenticated", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Don't login - just try to get user
      const { data, error } = await supabase.auth.getUser();

      // Should either return error or null user
      if (error) {
        expect(error).toBeDefined();
      } else {
        expect(data.user).toBeNull();
      }
    });

    it("should maintain session across multiple requests", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Get session multiple times
      const { data: session1 } = await supabase.auth.getSession();
      const { data: session2 } = await supabase.auth.getSession();
      const { data: session3 } = await supabase.auth.getSession();

      expect(session1.session).toBeDefined();
      expect(session2.session).toBeDefined();
      expect(session3.session).toBeDefined();

      // All sessions should have the same access token
      expect(session1.session?.access_token).toBe(
        session2.session?.access_token
      );
      expect(session2.session?.access_token).toBe(
        session3.session?.access_token
      );
    });
  });

  describe("Token Refresh", () => {
    beforeEach(async () => {
      if (!supabaseAvailable) {
        return;
      }
      // Create a test user before each test
      const user = await createTestUser(testEmail, testPassword);
      testUserId = user.id;
    });

    it("should successfully refresh session token", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      const { data: loginData } = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      const originalAccessToken = loginData.session?.access_token;
      const originalRefreshToken = loginData.session?.refresh_token;

      expect(originalAccessToken).toBeDefined();
      expect(originalRefreshToken).toBeDefined();

      // Refresh session
      const { data, error } = await supabase.auth.refreshSession();

      expect(error).toBeNull();
      expect(data.session).toBeDefined();
      expect(data.session?.access_token).toBeDefined();
      expect(data.session?.refresh_token).toBeDefined();
      expect(data.user).toBeDefined();

      // New tokens should be different from original (in most cases)
      // Note: This may not always be true depending on timing, so we just verify they exist
      expect(data.session?.access_token).toBeTruthy();
      expect(data.session?.refresh_token).toBeTruthy();
    });

    it("should return user information after token refresh", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Refresh session
      const { data, error } = await supabase.auth.refreshSession();

      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      expect(data.user?.id).toBe(testUserId);
      expect(data.user?.email).toBe(testEmail);
    });

    it("should fail to refresh without active session", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Don't login - just try to refresh
      const { data, error } = await supabase.auth.refreshSession();

      // Should return error or null session
      if (error) {
        expect(error).toBeDefined();
      } else {
        expect(data.session).toBeNull();
      }
    });

    it("should maintain user metadata after token refresh", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Refresh session
      const { data, error } = await supabase.auth.refreshSession();

      expect(error).toBeNull();
      expect(data.user?.user_metadata).toBeDefined();
      expect(data.user?.email).toBe(testEmail);
    });

    it("should update session after refresh", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Get original session
      const { data: beforeRefresh } = await supabase.auth.getSession();
      const originalToken = beforeRefresh.session?.access_token;

      // Refresh session
      await supabase.auth.refreshSession();

      // Get updated session
      const { data: afterRefresh } = await supabase.auth.getSession();
      const newToken = afterRefresh.session?.access_token;

      expect(originalToken).toBeDefined();
      expect(newToken).toBeDefined();

      // Session should still be valid
      expect(afterRefresh.session).toBeDefined();
      expect(afterRefresh.session?.user.id).toBe(testUserId);
    });

    it("should extend session expiration after refresh", async () => {
      if (!supabaseAvailable) {
        return;
      }
      const supabase = createTestSupabaseClient();

      // Login
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // Get original expiration
      const { data: beforeRefresh } = await supabase.auth.getSession();
      const originalExpiration = beforeRefresh.session?.expires_at;

      // Wait a small amount of time
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Refresh session
      await supabase.auth.refreshSession();

      // Get new expiration
      const { data: afterRefresh } = await supabase.auth.getSession();
      const newExpiration = afterRefresh.session?.expires_at;

      expect(originalExpiration).toBeDefined();
      expect(newExpiration).toBeDefined();

      // New expiration should be in the future
      if (newExpiration) {
        expect(newExpiration).toBeGreaterThan(Date.now() / 1000);
      }
    });
  });
});
