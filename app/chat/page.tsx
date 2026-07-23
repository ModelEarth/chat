import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";

// Default model constant
const DEFAULT_CHAT_MODEL = "gemini-2.5-flash";

import { getCurrentUser, isAuthRequired, isEmailPasswordUser } from "@/lib/auth/server";
import { getConfiguredSocialProviders } from "@/lib/auth/social-providers";
import { generateUUID } from "@/lib/utils";

// Force dynamic rendering for authenticated pages
export const dynamic = "force-dynamic";

export default async function ChatPage() {
	const user = await getCurrentUser();

	// Redirect unauthenticated users to login when this host requires auth.
	if (!user && (await isAuthRequired())) {
		redirect("/login?returnTo=/chat");
	}

	const [emailUser, socialProviders] = await Promise.all([
		isEmailPasswordUser(),
		Promise.resolve(getConfiguredSocialProviders()),
	]);

	const id = generateUUID();

	const cookieStore = await cookies();
	const modelIdFromCookie = cookieStore.get("chat-model");

	// Get default model from cookie or use hardcoded default
	const defaultModel = modelIdFromCookie?.value || DEFAULT_CHAT_MODEL;

	// Model selection completed

	return (
		<>
			<Chat
				autoResume={false}
				hasSocialProviders={socialProviders.length > 0}
				id={id}
				initialChatModel={defaultModel}
				initialMessages={[]}
				initialVisibilityType="private"
				isEmailUser={emailUser}
				isReadonly={false}
				key={id}
			/>
			<DataStreamHandler />
		</>
	);
}
