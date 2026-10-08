"use client";

import { ArrowLeft, ArrowRight, BookOpen, BrainCog, Check, Globe, Key, Library, Loader2, Lock, Menu, MoreHorizontal, PanelLeft, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useLocalStorage } from "usehooks-ts";
import { RepoWikiLink } from "@/components/repo-wiki-link";
import { useRepos } from "@/hooks/use-repos";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Repo } from "@/lib/repos";
import { DEFAULT_CODECHAT_GITHUB_ACCOUNT } from "@/lib/repo-wiki";
import { storage } from "@/lib/storage";
import { GitHubContextIntegration } from "@/lib/github-components";
import type { GitHubRepo } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/sidebar-history";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { SidebarUserNav } from "@/components/sidebar-user-nav";
import { SidebarResizeHint } from "@/components/sidebar-resize-hint";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth/hooks";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { VisibilityType } from "./visibility-selector";

type ActiveTab = "sources" | "chats" | "kb" | "visibility";

const SUGGESTED_QUESTIONS = [
  "What are the advantages of using Next.js?",
  "Write code to demonstrate Dijkstra's algorithm",
  "Help me write an essay about Silicon Valley",
  "What is the weather in San Francisco?",
];

const VISIBILITY_OPTIONS: Array<{
  id: VisibilityType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: "private",
    label: "Private",
    description: "Only you can access this chat",
    icon: <Lock size={15} />,
  },
  {
    id: "public",
    label: "Public",
    description: "Anyone with the link can access this chat",
    icon: <Globe size={15} />,
  },
];

const CODECHAT_REPO_NAMES = ["team", "codechat", "localsite", "chat", "realitystream", "data-pipeline"];

const TABS = [
  { id: "sources" as ActiveTab, icon: <Library size={16} />, label: "Sources", description: "Choose local and GitHub code sources." },
  { id: "chats" as ActiveTab, icon: <MessageSquare size={16} />, label: "Chats", description: "Browse history and start a new chat." },
  { id: "kb" as ActiveTab, icon: <BookOpen size={16} />, label: "Knowledge Base", description: "Use common prompts and starter questions." },
  { id: "visibility" as ActiveTab, icon: <Key size={16} />, label: "Models & Keys", description: "Open model settings and key management." },
];

export function AppSidebar({ isWebroot = false }: { isWebroot?: boolean }) {
  const router = useRouter();
  const { isMobile, setOpenMobile, setOpen, state, toggleSidebar } = useSidebar();
  const { mutate } = useSWRConfig();
  const { user } = useAuth();

  const params = useParams<{ id?: string }>();
  const chatId = params?.id ?? "";

  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId,
    initialVisibilityType: "private",
  });

  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [broadened, setBroadened] = useState(false);
  // Persisted so chat.tsx can read it and tell the server to skip RAG entirely.
  // Default to "none selected" so the first prompt skips RAG retrieval and
  // gets a faster response; the user's persisted choice (if any) still wins.
  const [noneSelected, setNoneSelected] = useLocalStorage<boolean>(
    "rag-disabled",
    true
  );
  const [sourceMode, setSourceMode] = useState<"codechat" | "not_optimized" | "anyone">("codechat");
  const [githubSelectedRepos, setGithubSelectedRepos] = useState<GitHubRepo[]>([]);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage("sidebar-width", 256);

  const [githubPAT, setGithubPAT] = useState<string | undefined>(
    storage.github.getToken() || undefined
  );

  // If no browser-stored PAT, check whether the server has one in its .env
  useEffect(() => {
    if (githubPAT) return;
    fetch("/api/github-token")
      .then((r) => r.json())
      .then((data) => { if (data.token) setGithubPAT(data.token); })
      .catch(() => {});
  }, [githubPAT]);

  const { repos: availableRepos, isLoading: reposLoading } = useRepos();
  const [ragSelectedRepos, setRagSelectedRepos] = useLocalStorage<string[]>(
    "rag-selected-repos",
    []
  );

  const displayedRepos = sourceMode === "not_optimized"
    ? availableRepos.filter((r) => !CODECHAT_REPO_NAMES.includes(r.name))
    : availableRepos.filter((r) => CODECHAT_REPO_NAMES.includes(r.name));

  const allSelected = !noneSelected && ragSelectedRepos.length === 0;
  const repoCount = noneSelected ? 0 : (allSelected ? displayedRepos.length : ragSelectedRepos.length);

  const isChecked = (repo: Repo) =>
    !noneSelected && (allSelected || ragSelectedRepos.includes(repo.name));

  const handleToggleRepo = (repo: Repo) => {
  if (allSelected) {
    setNoneSelected(false);
    const next = displayedRepos.filter((r) => r.name !== repo.name).map((r) => r.name);
    setRagSelectedRepos(next);
  } else {
    const already = ragSelectedRepos.includes(repo.name);
    if (already) {
      const next = ragSelectedRepos.filter((r) => r !== repo.name);
      if (next.length === 0) {
        setNoneSelected(true);
        setRagSelectedRepos([]);
      } else {
        setRagSelectedRepos(next);
      }
    } else {
      setNoneSelected(false);
      const next = [...ragSelectedRepos, repo.name];
      setRagSelectedRepos(next.length === displayedRepos.length ? [] : next);
    }
  }
};

  // Keep --sidebar-width CSS variable in sync (used by any residual CSS; re-run on state change
  // so React's SidebarProvider re-render doesn't reset it back to the default 16rem)
  useEffect(() => {
    const wrapper = document.querySelector(".group\\/sidebar-wrapper") as HTMLElement | null;
    if (wrapper) wrapper.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  }, [sidebarWidth, state]);

  // Open the GitHub sources panel when the toolbar button dispatches the event
  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setActiveTab("sources");
      setSourceMode("anyone");
    };
    window.addEventListener("open-github-sources", handler);
    return () => window.removeEventListener("open-github-sources", handler);
  }, [setOpen]);

  // Broadcast GitHub repo selection changes so multimodal-input can sync
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("github-selection-changed", {
        detail: { repos: githubSelectedRepos, chatId },
      })
    );
  }, [githubSelectedRepos, chatId]);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      const onMove = (ev: PointerEvent) => {
        const maxWidth = Math.floor(window.innerWidth * 0.75);
        const w = Math.max(180, Math.min(maxWidth, startWidth + ev.clientX - startX));
        setSidebarWidth(w);
        const wrapper = document.querySelector(".group\\/sidebar-wrapper") as HTMLElement | null;
        if (wrapper) wrapper.style.setProperty("--sidebar-width", `${w}px`);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [sidebarWidth, setSidebarWidth]
  );

  const handleDeleteAll = () => {
    const deletePromise = fetch("/api/history", { method: "DELETE" });
    toast.promise(deletePromise, {
      loading: "Deleting all chats...",
      success: () => {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
        router.push("/");
        setShowDeleteAllDialog(false);
        return "All chats deleted successfully";
      },
      error: "Failed to delete all chats",
    });
  };

  return (
    <>
      {state === "collapsed" && !isMobile && (
        <Button
          className="fixed top-[84px] left-3 z-30 h-9 w-9 rounded-full border border-border bg-background shadow-sm"
          data-testid="sidebar-reopen-button"
          onClick={toggleSidebar}
          size="icon"
          variant="outline"
        >
          <PanelLeft size={16} />
          <span className="sr-only">Reopen Sidebar</span>
        </Button>
      )}

      <Sidebar className="group-data-[side=left]:border-r-0 top-[73px] h-[calc(100svh-73px)]">
        <SidebarHeader className="border-b border-sidebar-border p-2">
          <div className="flex items-center gap-1.5">
            {activeTab ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActiveTab(null)}
                    className="flex size-8 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ArrowLeft size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">All Topics</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleSidebar}
                    aria-label="Close sidebar"
                    className="flex size-8 items-center justify-center rounded-full border border-border bg-transparent text-foreground transition-colors hover:bg-muted dark:bg-background"
                  >
                    <Menu size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Toggle Sidebar</TooltipContent>
              </Tooltip>
            )}
            {TABS.map((tab) => (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-pressed={activeTab === tab.id}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border border-border transition-colors",
                      activeTab === tab.id
                        ? "bg-transparent text-foreground dark:bg-background"
                        : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {tab.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{tab.label}</TooltipContent>
              </Tooltip>
            ))}
            <div className="ml-auto">
              <SidebarToggle />
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">
          {!activeTab && (
            <div className="flex h-full flex-col overflow-y-auto p-2">
              <div className="space-y-2">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-sidebar-border bg-background px-3 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                      {tab.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{tab.label}</div>
                      <div className="text-xs text-muted-foreground">{tab.description}</div>
                    </div>
                    <ArrowRight size={15} className="shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Sources ── */}
          {activeTab === "sources" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
                <span className="text-sm font-semibold">
                  {sourceMode === "anyone"
                    ? "Anyone's Repos"
                    : sourceMode === "not_optimized"
                      ? "Sources (Not Optimized)"
                      : "Sources (CodeChat)"}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() => { setBroadened(false); setSourceMode("codechat"); }}
                      className={sourceMode === "codechat" ? "font-medium" : ""}
                    >
                      {sourceMode === "codechat" ? "✓ " : "\u00a0\u00a0 "}Sources (CodeChat)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setSourceMode("not_optimized")}
                      className={sourceMode === "not_optimized" ? "font-medium" : ""}
                    >
                      {sourceMode === "not_optimized" ? "✓ " : "\u00a0\u00a0 "}Sources (Not Optimized)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setSourceMode("anyone")}
                      className={sourceMode === "anyone" ? "font-medium" : ""}
                    >
                      {sourceMode === "anyone" ? "✓ " : "   "}Anyone's Repos
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* CodeChat RAG repos view */}
              {sourceMode !== "anyone" && (
                <>
                  {/* Loading spinner — shown before repos arrive */}
                  {reposLoading && (
                    <div className="relative flex-1">
                      <Loader2 size={40} className="animate-spin text-muted-foreground/40 absolute left-1/2 -translate-x-1/2" style={{ top: 40 }} />
                    </div>
                  )}

                  {/* Select All + repo list — hidden while loading */}
                  {!reposLoading && (
                    <>
                  {/* About CodeChat Submodules link — webroot only */}
                  {isWebroot && (
                    <div className="px-3 py-2 border-b border-sidebar-border">
                      <a
                        href="/codechat"
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        About CodeChat Submodules
                        <ArrowRight size={14} />
                      </a>
                    </div>
                  )}

                  {/* Select All */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
                    <input
                      type="checkbox"
                      id="select-all-repos"
                      checked={allSelected}
                      onChange={() => {
                        if (allSelected) {
                          setNoneSelected(true);
                        } else {
                          setNoneSelected(false);
                          setRagSelectedRepos([]);
                        }
                      }}
                      className="size-4 cursor-pointer accent-primary"
                    />
                    <label
                      htmlFor="select-all-repos"
                      className="flex-1 cursor-pointer text-xs text-muted-foreground"
                    >
                      Select All
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {`${repoCount} sources`}
                    </span>
                  </div>

                  {/* Repo list */}
                  <div className="flex-1 overflow-y-auto py-1">
                    {displayedRepos.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                        No repos configured.
                      </p>
                    ) : (
                      displayedRepos.map((repo) => (
                        <div
                          key={repo.name}
                          className="mx-1 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
                        >
                          <input
                            id={`select-repo-${repo.name}`}
                            type="checkbox"
                            checked={isChecked(repo)}
                            onChange={() => handleToggleRepo(repo)}
                            className="size-4 flex-shrink-0 cursor-pointer accent-primary"
                          />
                          <label
                            htmlFor={`select-repo-${repo.name}`}
                            className="min-w-0 flex-1 cursor-pointer truncate text-sm"
                          >
                            {repo.name}
                            {repo.label.includes("(site)") && (
                              <span className="ml-1 text-xs text-blue-400">(site)</span>
                            )}
                          </label>
                          <RepoWikiLink
                            repoName={repo.name}
                            githubAccount={DEFAULT_CODECHAT_GITHUB_ACCOUNT}
                          />
                        </div>
                      ))
                    )}
                  </div>
                    </>
                  )}
                </>
              )}

              {/* Anyone's Repo – GitHub context integration */}
              {sourceMode === "anyone" && (
                <div className="flex-1 overflow-y-auto">
                  <GitHubContextIntegration
                    githubPAT={githubPAT}
                    selectedRepos={githubSelectedRepos}
                    onRepoSelectionChange={setGithubSelectedRepos}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── List Chats ── */}
          {activeTab === "chats" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
                <span className="text-sm font-semibold">Chats</span>
                <div className="flex items-center gap-1">
                  {user && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setShowDeleteAllDialog(true)}
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Delete All Chats</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => { setOpenMobile(false); router.push("/chat"); router.refresh(); }}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">New Chat</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <SidebarHistory />
              </div>
            </div>
          )}

          {/* ── Knowledge Base ── */}
          {activeTab === "kb" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
                <span className="text-sm font-semibold">Knowledge Base</span>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Frequent Questions
                </p>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="w-full rounded-md px-3 py-2 text-left text-sm leading-snug hover:bg-muted transition-colors"
                    onClick={() => {
                      setOpenMobile(false);
                      router.push(`/chat?query=${encodeURIComponent(q)}`);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── AI Models & Keys ── */}
          {activeTab === "visibility" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex items-center px-3 py-2 border-b border-sidebar-border">
                <span className="text-sm font-semibold">AI Models &amp; Keys</span>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                <div className="px-3 py-2 border-b border-sidebar-border flex items-center gap-3">
                  <a
                    href="/settings"
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <BrainCog size={14} />
                    Settings
                  </a>
                  <span className="text-muted-foreground/40 select-none">·</span>
                  <a
                    href="/keys"
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Models and Keys
                    <ArrowRight size={13} />
                  </a>
                </div>
                <p className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Chat Visibility</p>
                {VISIBILITY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setVisibilityType(option.id)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md mx-1 px-2 py-2.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="text-muted-foreground">{option.icon}</span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    </div>
                    {visibilityType === option.id && (
                      <Check size={15} className="text-foreground shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

        </SidebarContent>

        <SidebarFooter>{user && <SidebarUserNav />}</SidebarFooter>

        {/* Drag handle for resizing the sidebar width */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-primary/30 active:bg-primary/50 transition-colors"
          onPointerDown={handleResizePointerDown}
        />
        <SidebarResizeHint onPointerDown={handleResizePointerDown} />
      </Sidebar>

      <AlertDialog onOpenChange={setShowDeleteAllDialog} open={showDeleteAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all
              your chats and remove them from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
