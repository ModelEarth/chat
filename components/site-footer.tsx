export function SiteFooter() {
  return (
    <footer className="border-t px-4 py-8 bg-muted/30">
      <div className="container mx-auto text-center text-sm text-muted-foreground">
        <p>
          Connect your{" "}
          <a className="underline underline-offset-2 hover:text-foreground" href="https://github.com/DesktopFolders/commons">
            Desktop Folders
          </a>{" "}
          to the commons
        </p>
      </div>
    </footer>
  );
}
