import "server-only";

import { callProvider, type LLMApiKeys, type LLMProvider } from "./llm-provider-call";

/**
 * The "final LLM call": combines the repo-docs answer(s)
 * and the normal chat answer into one summary. User-triggered via a
 * "Combine these" button (his answer to our question on this), not run
 * automatically — see repo-docs-panel.tsx for where that button lives.
 */

export type RepoDocsAnswerInput = {
  provider: LLMProvider;
  modelId: string;
  answer: string;
};

export type CombineResult = {
  answer?: string;
  error?: string;
};

/**
 * `repoDocsAnswers` is only the successful ones — the caller (the route)
 * filters out any that errored, since there's nothing useful to combine
 * from those.
 */
export async function combineAnswers(params: {
  query: string;
  repoDocsAnswers: RepoDocsAnswerInput[];
  chatAnswer: string;
  provider?: LLMProvider;
  apiKeys?: LLMApiKeys;
}): Promise<CombineResult> {
  if (params.repoDocsAnswers.length === 0 && !params.chatAnswer.trim()) {
    return { error: "Nothing to combine yet" };
  }

  const sections = [
    ...params.repoDocsAnswers.map(
      (a) => `Answer from ${a.provider} (${a.modelId}), based only on repo docs:\n${a.answer}`
    ),
    params.chatAnswer.trim()
      ? `Normal chat answer:\n${params.chatAnswer}`
      : null,
  ].filter((s): s is string => Boolean(s));

  const prompt = `The question below was answered separately by ${sections.length} different sources. Write one combined answer that keeps what's useful from each and resolves any disagreement between them — don't just concatenate them.\n\nQuestion: ${params.query}\n\n${sections.join(
    "\n\n---\n\n"
  )}`;

  const result = await callProvider(params.provider ?? "google", prompt, params.apiKeys);
  return result.error ? { error: result.error } : { answer: result.answer };
}
