"use client";

import { BookOpen, Check, Globe, Library, Lock, MoreHorizontal, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useLocalStorage } from "usehooks-ts";
import { useRepos } from "@/hooks/use-repos";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Repo } from "@/lib/repos";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/sidebar-history";
import { SidebarUserNav } from "@/components/sidebar-user-nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth/hooks";
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

const TABS = [
  { id: "sources" as ActiveTab, icon: <Library size={15} />, label: "Sources" },
  { id: "chats" as ActiveTab, icon: <MessageSquare size={15} />, label: "List Chats" },
  { id: "kb" as ActiveTab, icon: <BookOpen size={15} />, label: "Knowledge Base" },
  { id: "visibility" as ActiveTab, icon: <Lock size={15} />, label: "Visibility" },
];

export function AppSidebar() {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { mutate } = useSWRConfig();
  const { user } = useAuth();

  const params = useParams<{ id?: string }>();
  const chatId = params?.id ?? "";

  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId,
    initialVisibilityType: "private",
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>("sources");
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [broadened, setBroadened] = useState(false);

  const { repos: availableRepos, isLoading: reposLoading } = useRepos();
  const [ragSelectedRepos, setRagSelectedRepos] = useLocalStorage<string[]>(
    "rag-selected-repos",
    []
  );

  const allSelected = ragSelectedRepos.length === 0;
  const repoCount = allSelected ? availableRepos.length : ragSelectedRepos.length;

  const isChecked = (repo: Repo) =>
    allSelected || ragSelectedRepos.includes(repo.name);

  const handleToggleRepo = (repo: Repo) => {
    if (allSelected) {
      const next = availableRepos.filter((r) => r.name !== repo.name).map((r) => r.name);
      setRagSelectedRepos(next);
    } else {
      const already = ragSelectedRepos.includes(repo.name);
      if (already) {
        const next = ragSelectedRepos.filter((r) => r !== repo.name);
        setRagSelectedRepos(next.length === 0 ? [] : next);
      } else {
        const next = [...ragSelectedRepos, repo.name];
        setRagSelectedRepos(next.length === availableRepos.length ? [] : next);
      }
    }
  };

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
      <Sidebar className="group-data-[side=left]:border-r-0">

        {/* ── Tab row ── */}
        <SidebarHeader className="border-b border-sidebar-border p-2">
          <div className="flex items-center gap-1.5">
            {TABS.map((tab) => (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex size-8 items-center justify-center rounded-full border transition-colors ${
                      activeTab === tab.id
                        ? "border-border bg-muted text-foreground"
                        : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {tab.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tab.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">

          {/* ── Sources ── */}
          {activeTab === "sources" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-sidebar-border">
                <span className="text-sm font-semibold">Sources</span>
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
                      onClick={() => setBroadened(false)}
                      className={!broadened ? "font-medium" : ""}
                    >
                      {!broadened && "✓ "}ModelEarth Repos
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setBroadened(true)}
                      className={broadened ? "font-medium" : ""}
                    >
                      {broadened && "✓ "}All Repos
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Select All */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
                <input
                  type="checkbox"
                  id="select-all-repos"
                  checked={allSelected}
                  onChange={() => allSelected ? setRagSelectedRepos(availableRepos.map((r) => r.name)) : setRagSelectedRepos([])}
                  className="size-4 cursor-pointer accent-primary"
                />
                <label
                  htmlFor="select-all-repos"
                  className="flex-1 cursor-pointer text-xs text-muted-foreground"
                >
                  Select All
                </label>
                <span className="text-xs text-muted-foreground">
                  {reposLoading ? "…" : `${repoCount} sources`}
                </span>
              </div>

              {/* Repo list */}
              <div className="flex-1 overflow-y-auto py-1">
                {reposLoading ? (
                  <div className="flex flex-col gap-1 px-3 py-2">
                    {[60, 45, 72, 55, 65].map((w) => (
                      <div
                        key={w}
                        className="h-5 rounded bg-muted animate-pulse"
                        style={{ width: `${w}%` }}
                      />
                    ))}
                  </div>
                ) : availableRepos.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    No repos configured.
                  </p>
                ) : (
                  availableRepos.map((repo) => (
                    <label
                      key={repo.name}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md mx-1 px-2 py-1.5 hover:bg-muted transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked(repo)}
                        onChange={() => handleToggleRepo(repo)}
                        className="size-4 flex-shrink-0 cursor-pointer accent-primary"
                      />
                      <span className="truncate text-sm">
                        {repo.name}
                        {repo.label.includes("(site)") && (
                          <span className="ml-1 text-xs text-blue-400">(site)</span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
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

          {/* ── Visibility ── */}
          {activeTab === "visibility" && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex items-center px-3 py-2 border-b border-sidebar-border">
                <span className="text-sm font-semibold">Visibility</span>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
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
