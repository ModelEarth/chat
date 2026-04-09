"use client";

import { useCallback, useEffect, useState } from "react";
import type { Repo } from "@/lib/repos";

type UseReposResult = {
  repos: Repo[];
  isLoading: boolean;
  error: string | null;
};

export function useRepos(): UseReposResult {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/repos");
      if (!response.ok) {
        throw new Error(`Failed to fetch repos: ${response.status}`);
      }
      const data = await response.json();
      setRepos(data.repos ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch repos";
      console.error("Failed to fetch repos:", err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  return { repos, isLoading, error };
}
