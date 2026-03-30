/**
 * Unit tests for chat database queries
 * Tests CRUD operations and error handling for chat-related database queries
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "@/lib/db/drizzle-schema";
import { ChatSDKError } from "@/lib/errors";

// Mock server-only module
vi.mock("server-only", () => ({}));

// Mock the database
vi.mock("@/lib/db/queries/base", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
}));

import { db } from "@/lib/db/queries/base";
// Import after mocking
import {
  deleteChatById,
  getChatById,
  getChatsByUserId,
  saveChat,
  updateChatLastContextById,
  updateChatVisiblityById,
} from "@/lib/db/queries/chat";

describe("Chat Query Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("saveChat", () => {
    it("should create a new chat successfully", async () => {
      const chatData = {
        id: "660e8400-e29b-41d4-a716-446655440001",
        userId: "550e8400-e29b-41d4-a716-446655440001",
        title: "Test Chat",
        visibility: "private" as const,
      };

      const mockInsertResult = { insertId: chatData.id };

      // Mock the database chain
      const valuesMock = vi.fn().mockResolvedValue(mockInsertResult);
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      (db.insert as any) = insertMock;

      const result = await saveChat(chatData);

      expect(insertMock).toHaveBeenCalled();
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: chatData.id,
          user_id: chatData.userId,
          title: chatData.title,
          visibility: chatData.visibility,
        })
      );
      expect(result).toEqual(mockInsertResult);
    });

    it("should handle database errors during chat creation", async () => {
      const chatData = {
        id: "660e8400-e29b-41d4-a716-446655440001",
        userId: "550e8400-e29b-41d4-a716-446655440001",
        title: "Test Chat",
        visibility: "private" as const,
      };

      const dbError = new Error("Database connection failed");
      const valuesMock = vi.fn().mockRejectedValue(dbError);
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      (db.insert as any) = insertMock;

      // Suppress console.error during this test
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => { });

      await expect(saveChat(chatData)).rejects.toThrow(ChatSDKError);
      const error = await saveChat(chatData).catch((e) => e);
      expect(error).toBeInstanceOf(ChatSDKError);
      expect(error.cause).toContain("Database connection failed");

      consoleErrorSpy.mockRestore();
    });

    it("should create chat with public visibility", async () => {
      const chatData = {
        id: "660e8400-e29b-41d4-a716-446655440002",
        userId: "550e8400-e29b-41d4-a716-446655440001",
        title: "Public Chat",
        visibility: "public" as const,
      };

      const mockInsertResult = { insertId: chatData.id };
      const valuesMock = vi.fn().mockResolvedValue(mockInsertResult);
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      (db.insert as any) = insertMock;

      const result = await saveChat(chatData);

      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: "public",
        })
      );
      expect(result).toBeDefined();
    });
  });

  describe("getChatById", () => {
    it("should retrieve a chat by ID successfully", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const mockChat: Chat = {
        id: chatId,
        user_id: "550e8400-e29b-41d4-a716-446655440001",
        title: "Test Chat",
        visibility: "private",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        lastContext: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: "0",
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      };

      const whereMock = vi.fn().mockResolvedValue([mockChat]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      const result = await getChatById({ id: chatId });

      expect(selectMock).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalled();
      expect(whereMock).toHaveBeenCalled();
      expect(result).toEqual(mockChat);
    });

    it("should return null when chat is not found", async () => {
      const chatId = "non-existent-id";

      const whereMock = vi.fn().mockResolvedValue([]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      const result = await getChatById({ id: chatId });

      expect(result).toBeNull();
    });

    it("should handle database errors during retrieval", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const dbError = new Error("Database error");

      const whereMock = vi.fn().mockRejectedValue(dbError);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      const error = await getChatById({ id: chatId }).catch((e) => e);
      expect(error).toBeInstanceOf(ChatSDKError);
      expect(error.type).toBe("bad_request");
      expect(error.surface).toBe("database");
    });
  });

  describe("getChatsByUserId", () => {
    it("should retrieve chats for a user successfully", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440001";
      const mockChats: Chat[] = [
        {
          id: "660e8400-e29b-41d4-a716-446655440001",
          user_id: userId,
          title: "Chat 1",
          visibility: "private",
          createdAt: new Date("2024-01-02T00:00:00.000Z"),
          lastContext: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: "0",
          updatedAt: new Date("2024-01-02T00:00:00.000Z"),
        },
        {
          id: "660e8400-e29b-41d4-a716-446655440002",
          user_id: userId,
          title: "Chat 2",
          visibility: "private",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          lastContext: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: "0",
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ];

      const limitMock = vi.fn().mockResolvedValue(mockChats);
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      const result = await getChatsByUserId({
        id: userId,
        limit: 10,
        startingAfter: null,
        endingBefore: null,
      });

      expect(result.chats).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.chats[0].id).toBe("660e8400-e29b-41d4-a716-446655440001");
    });

    it("should handle pagination with startingAfter", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440001";
      const startingAfterChat: Chat = {
        id: "660e8400-e29b-41d4-a716-446655440001",
        user_id: userId,
        title: "Chat 1",
        visibility: "private",
        createdAt: new Date("2024-01-02T00:00:00.000Z"),
        lastContext: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: "0",
        updatedAt: new Date("2024-01-02T00:00:00.000Z"),
      };

      const mockChats: Chat[] = [
        {
          id: "660e8400-e29b-41d4-a716-446655440002",
          user_id: userId,
          title: "Chat 2",
          visibility: "private",
          createdAt: new Date("2024-01-03T00:00:00.000Z"),
          lastContext: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: "0",
          updatedAt: new Date("2024-01-03T00:00:00.000Z"),
        },
      ];

      let callCount = 0;
      const limitMock = vi.fn().mockImplementation(() => {
        callCount++;
        // First call for startingAfter chat, second call for filtered chats
        return Promise.resolve(
          callCount === 1 ? [startingAfterChat] : mockChats
        );
      });
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const whereMock = vi.fn().mockReturnValue({
        orderBy: orderByMock,
        limit: limitMock,
      });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      // Suppress console.error during this test
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => { });

      const result = await getChatsByUserId({
        id: userId,
        limit: 10,
        startingAfter: "660e8400-e29b-41d4-a716-446655440001",
        endingBefore: null,
      });

      expect(result.chats).toHaveLength(1);
      expect(result.hasMore).toBe(false);

      consoleErrorSpy.mockRestore();
    });

    it("should detect hasMore when results exceed limit", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440001";
      const mockChats: Chat[] = [
        {
          id: "660e8400-e29b-41d4-a716-446655440001",
          user_id: userId,
          title: "Chat 1",
          visibility: "private",
          createdAt: new Date("2024-01-03T00:00:00.000Z"),
          lastContext: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: "0",
          updatedAt: new Date("2024-01-03T00:00:00.000Z"),
        },
        {
          id: "660e8400-e29b-41d4-a716-446655440002",
          user_id: userId,
          title: "Chat 2",
          visibility: "private",
          createdAt: new Date("2024-01-02T00:00:00.000Z"),
          lastContext: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: "0",
          updatedAt: new Date("2024-01-02T00:00:00.000Z"),
        },
        {
          id: "660e8400-e29b-41d4-a716-446655440003",
          user_id: userId,
          title: "Chat 3",
          visibility: "private",
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          lastContext: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: "0",
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ];

      const limitMock = vi.fn().mockResolvedValue(mockChats);
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      const result = await getChatsByUserId({
        id: userId,
        limit: 2,
        startingAfter: null,
        endingBefore: null,
      });

      expect(result.chats).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it("should throw error when startingAfter chat not found", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440001";
      const invalidChatId = "non-existent-chat-id";

      const limitMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      await expect(
        getChatsByUserId({
          id: userId,
          limit: 10,
          startingAfter: invalidChatId,
          endingBefore: null,
        })
      ).rejects.toThrow(ChatSDKError);
    });

    it("should return empty array for user with no chats", async () => {
      const userId = "550e8400-e29b-41d4-a716-446655440001";

      const limitMock = vi.fn().mockResolvedValue([]);
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      const result = await getChatsByUserId({
        id: userId,
        limit: 10,
        startingAfter: null,
        endingBefore: null,
      });

      expect(result.chats).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("deleteChatById", () => {
    it("should delete a chat and related data successfully", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const deletedChat: Chat = {
        id: chatId,
        user_id: "550e8400-e29b-41d4-a716-446655440001",
        title: "Deleted Chat",
        visibility: "private",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        lastContext: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: "0",
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      };

      // Mock delete operations for related tables (vote, message, stream)
      const voteWhereMock = vi.fn().mockResolvedValue([]);
      const _voteDeleteMock = vi.fn().mockReturnValue({ where: voteWhereMock });

      const messageWhereMock = vi.fn().mockResolvedValue([]);
      const _messageDeleteMock = vi
        .fn()
        .mockReturnValue({ where: messageWhereMock });

      const streamWhereMock = vi.fn().mockResolvedValue([]);
      const _streamDeleteMock = vi
        .fn()
        .mockReturnValue({ where: streamWhereMock });

      // Mock chat delete
      const returningMock = vi.fn().mockResolvedValue([deletedChat]);
      const chatWhereMock = vi
        .fn()
        .mockReturnValue({ returning: returningMock });
      const _chatDeleteMock = vi.fn().mockReturnValue({ where: chatWhereMock });

      // Set up delete mock to return different chains based on call order
      let deleteCallCount = 0;
      (db.delete as any) = vi.fn().mockImplementation(() => {
        deleteCallCount++;
        if (deleteCallCount === 1) {
          return { where: voteWhereMock };
        }
        if (deleteCallCount === 2) {
          return { where: messageWhereMock };
        }
        if (deleteCallCount === 3) {
          return { where: streamWhereMock };
        }
        return { where: chatWhereMock };
      });

      const result = await deleteChatById({ id: chatId });

      expect(db.delete).toHaveBeenCalledTimes(4); // vote, message, stream, chat
      expect(result).toEqual(deletedChat);
    });

    it("should handle errors during deletion", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const dbError = new Error("Delete failed");

      const whereMock = vi.fn().mockRejectedValue(dbError);
      const deleteMock = vi.fn().mockReturnValue({ where: whereMock });
      (db.delete as any) = deleteMock;

      const error = await deleteChatById({ id: chatId }).catch((e) => e);
      expect(error).toBeInstanceOf(ChatSDKError);
      expect(error.type).toBe("bad_request");
      expect(error.surface).toBe("database");
    });
  });

  describe("updateChatVisiblityById", () => {
    it("should update chat visibility to public", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const mockUpdateResult = { rowCount: 1 };

      const whereMock = vi.fn().mockResolvedValue(mockUpdateResult);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      const updateMock = vi.fn().mockReturnValue({ set: setMock });
      (db.update as any) = updateMock;

      const result = await updateChatVisiblityById({
        chatId,
        visibility: "public",
      });

      expect(updateMock).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith({ visibility: "public" });
      expect(whereMock).toHaveBeenCalled();
      expect(result).toEqual(mockUpdateResult);
    });

    it("should update chat visibility to private", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const mockUpdateResult = { rowCount: 1 };

      const whereMock = vi.fn().mockResolvedValue(mockUpdateResult);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      const updateMock = vi.fn().mockReturnValue({ set: setMock });
      (db.update as any) = updateMock;

      const result = await updateChatVisiblityById({
        chatId,
        visibility: "private",
      });

      expect(setMock).toHaveBeenCalledWith({ visibility: "private" });
      expect(result).toEqual(mockUpdateResult);
    });

    it("should handle errors during visibility update", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const dbError = new Error("Update failed");

      const whereMock = vi.fn().mockRejectedValue(dbError);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      const updateMock = vi.fn().mockReturnValue({ set: setMock });
      (db.update as any) = updateMock;

      await expect(
        updateChatVisiblityById({ chatId, visibility: "public" })
      ).rejects.toThrow(ChatSDKError);
    });
  });

  describe("updateChatLastContextById", () => {
    it("should update chat last context successfully", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const context = {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        cost: 0.003,
        inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      };
      const mockUpdateResult = { rowCount: 1 };

      const whereMock = vi.fn().mockResolvedValue(mockUpdateResult);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      const updateMock = vi.fn().mockReturnValue({ set: setMock });
      (db.update as any) = updateMock;

      const result = await updateChatLastContextById({ chatId, context });

      expect(updateMock).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith({ lastContext: context });
      expect(whereMock).toHaveBeenCalled();
      expect(result).toEqual(mockUpdateResult);
    });

    it("should handle errors gracefully during context update", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const context = {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        cost: 0.003,
        inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      };
      const dbError = new Error("Update failed");

      const whereMock = vi.fn().mockRejectedValue(dbError);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      const updateMock = vi.fn().mockReturnValue({ set: setMock });
      (db.update as any) = updateMock;

      // This function returns undefined on error (doesn't throw)
      const result = await updateChatLastContextById({ chatId, context });

      expect(result).toBeUndefined();
    });

    it("should update with null context", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const context = null as any;
      const mockUpdateResult = { rowCount: 1 };

      const whereMock = vi.fn().mockResolvedValue(mockUpdateResult);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      const updateMock = vi.fn().mockReturnValue({ set: setMock });
      (db.update as any) = updateMock;

      const result = await updateChatLastContextById({ chatId, context });

      expect(setMock).toHaveBeenCalledWith({ lastContext: null });
      expect(result).toEqual(mockUpdateResult);
    });
  });

  describe("Error Handling", () => {
    it("should throw ChatSDKError with correct error code for database errors", async () => {
      const chatId = "660e8400-e29b-41d4-a716-446655440001";
      const dbError = new Error("Database error");

      const whereMock = vi.fn().mockRejectedValue(dbError);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const selectMock = vi.fn().mockReturnValue({ from: fromMock });
      (db.select as any) = selectMock;

      try {
        await getChatById({ id: chatId });
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(ChatSDKError);
        expect((error as ChatSDKError).type).toBe("bad_request");
        expect((error as ChatSDKError).surface).toBe("database");
      }
    });

    it("should preserve error messages in ChatSDKError", async () => {
      const chatData = {
        id: "660e8400-e29b-41d4-a716-446655440001",
        userId: "550e8400-e29b-41d4-a716-446655440001",
        title: "Test Chat",
        visibility: "private" as const,
      };

      const specificError = new Error("Connection timeout");
      const valuesMock = vi.fn().mockRejectedValue(specificError);
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      (db.insert as any) = insertMock;

      try {
        await saveChat(chatData);
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(ChatSDKError);
        expect((error as ChatSDKError).cause).toContain("Connection timeout");
      }
    });
  });
});
