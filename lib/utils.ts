import type {
  ModelMessage,
  UIMessage,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document } from '@/lib/db/drizzle-schema';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, CustomUIDataTypes } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new ChatSDKError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type ResponseMessage = ModelMessage & { id: string };

export function getMostRecentUserMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Document[],
  index: number,
) {
  if (!documents) { return new Date(); }
  if (index > documents.length) { return new Date(); }

  return documents[index].createdAt;
}

export function getTrailingMessageId({
  messages,
}: {
  messages: ResponseMessage[];
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) { return null; }

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as any[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

export function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function buildArtifactContext(
  allArtifacts: Array<{
    id: string;
    title: string;
    kind: string;
    version_number: number;
    parent_version_id: string | null;
    createdAt: Date;
  }>,
  lastDocument: Document | null
): string {
  if (allArtifacts.length === 0) {
    return '';
  }

  let context = '\n\n## Artifacts in This Conversation\n\n';

  // Add all documents section (metadata only)
  context += '### All Documents\n';
  allArtifacts.forEach((doc, index) => {
    context += `${index + 1}. **[${doc.id}]** "${doc.title}" (v${doc.version_number}, ${doc.kind})\n`;
  });

  // Add last document section with full content
  if (lastDocument && lastDocument.content) {
    context += '\n### Last Document (Most Recent)\n';
    context += `**ID:** ${lastDocument.id}\n`;
    context += `**Title:** ${lastDocument.title}\n`;
    context += `**Version:** ${lastDocument.version_number}\n`;
    context += `**Kind:** ${lastDocument.kind}\n`;
    context += `**Content:**\n\n${lastDocument.content}\n`;
  }

  return context;
}

/**
 * Strip markdown code fences from LLM output
 * Removes ```markdown, ```text, ``` at start and ``` at end
 * This fixes the issue where LLMs wrap markdown content in code fences
 */
export function stripMarkdownCodeFences(content: string): string {
  if (!content || typeof content !== 'string') {
    return content;
  }

  let cleaned = content.trim();

  // Remove opening code fence (```markdown, ```text, ```)
  // Match: optional whitespace, ```, optional language identifier, newline
  cleaned = cleaned.replace(/^\s*```(?:markdown|text|md)?\s*\n/, '');

  // Remove closing code fence (```)
  // Match: newline (optional), ```, optional whitespace at end
  cleaned = cleaned.replace(/\n?\s*```\s*$/, '');

  return cleaned.trim();
}
