import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";

// Default model constant
const DEFAULT_CHAT_MODEL = "gemini-2.5-flash";

import { getCurrentUser, isAuthRequired, isEmailPasswordUser } from "@/lib/auth/server";
import { getConfiguredSocialProviders } from "@/lib/auth/social-providers";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import {
  ActivityCategory,
  logUserActivity,
  UserActivityType,
} from "@/lib/logging/activity-logger";
import { convertToUIMessages } from "@/lib/utils";

// Force dynamic rendering for authenticated pages
export const dynamic = "force-dynamic";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  // Reject IDs that look like file paths (e.g., stackframe.js, *.map, etc.)
  if (id.includes(".") || id.includes("/")) {
    notFound();
  }

  // When the DB is offline these throw — render an empty chat shell instead
  // of crashing the page, so the user can still talk to a model.
  let chat: Awaited<ReturnType<typeof getChatById>> | null = null;
  let dbAvailable = true;
  try {
    chat = await getChatById({ id });
  } catch (err) {
    console.warn("Database unavailable in chat page, rendering offline shell:", err);
    dbAvailable = false;
  }

  if (dbAvailable && !chat) {
    notFound();
  }

  const user = await getCurrentUser();

  // Redirect unauthenticated users to login when this host requires auth.
  if (!user && (await isAuthRequired())) {
    redirect(`/login?returnTo=/chat/${id}`);
  }

  // Check if user can access this chat (only when DB is reachable and we have one)
  if (chat && chat.visibility === "private") {
    if (!user) {
      return notFound();
    }

    if (user.id !== chat.user_id) {
      return notFound();
    }
  }

  // Log chat view activity (async, non-blocking)
  if (user && chat) {
    logUserActivity({
      user_id: user.id,
      activity_type: UserActivityType.CHAT_VIEW,
      activity_category: ActivityCategory.CHAT,
      resource_id: id,
      resource_type: "chat",
      request_path: `/chat/${id}`,
      request_method: "GET",
      success: true,
    }).catch((err) => {
      console.error("Failed to log chat view:", err);
    });
  }

  let uiMessages: ReturnType<typeof convertToUIMessages> = [];
  try {
    const messagesFromDb = await getMessagesByChatId({ id });
    uiMessages = convertToUIMessages(messagesFromDb);
  } catch (err) {
    console.warn("Failed to load messages (DB offline?), starting empty:", err);
  }

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get("chat-model");

  // Readonly only when we have a real chat and the viewer doesn't own it.
  // When DB is offline we treat the page as a fresh editable session.
  const isReadonly = !!chat && (!user || user.id !== chat.user_id);
  const chatId = chat?.id ?? id;
  const visibility = (chat?.visibility as any) ?? "private";
  const lastContext = (chat?.lastContext as any) ?? undefined;
  const initialChatModel = chatModelFromCookie?.value ?? DEFAULT_CHAT_MODEL;

  const [emailUser, socialProviders] = await Promise.all([
    isEmailPasswordUser(),
    Promise.resolve(getConfiguredSocialProviders()),
  ]);

  return (
    <>
      <Chat
        autoResume={true}
        hasSocialProviders={socialProviders.length > 0}
        id={chatId}
        initialChatModel={initialChatModel}
        initialLastContext={lastContext}
        initialMessages={uiMessages}
        initialVisibilityType={visibility}
        isEmailUser={emailUser}
        isReadonly={isReadonly}
      />
      <DataStreamHandler />
    </>
  );
}
