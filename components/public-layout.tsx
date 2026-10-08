import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { DataStreamProvider } from "@/components/data-stream-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TopNav } from "@/components/top-nav";
import { getCurrentUser } from "@/lib/auth/server";

export async function PublicLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  const isCollapsed = sidebarCookie === "false";
  const isWebroot = process.env.WEBROOT === "true";

  const user = await getCurrentUser();
  const isLoggedIn = !!user;

  return (
    <DataStreamProvider>
      <TopNav isWebroot={isWebroot} isLoggedIn={isLoggedIn} />
      <SidebarProvider defaultOpen={!isCollapsed}>
        <AppSidebar />
        <SidebarInset className="min-w-0 pt-[73px]">{children}</SidebarInset>
      </SidebarProvider>
    </DataStreamProvider>
  );
}
