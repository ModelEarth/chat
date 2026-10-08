// When this build was made, i.e. when it was deployed to Vercel, plus the
// commit. BUILD_TIME and BUILD_COMMIT are set in next.config.mjs.
const COMMIT_URL = "https://github.com/ModelEarth/chat/commit/";

export function DeployInfo(): React.JSX.Element | null {
  const built = process.env.BUILD_TIME;
  if (!built) {
    return null;
  }
  const commit = process.env.BUILD_COMMIT;
  const label = new Date(built).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <p className="text-center text-gray-400 text-xs dark:text-zinc-500">
      Updated <time dateTime={built}>{label} UTC</time>
      {commit && (
        <>
          {" · "}
          <a className="underline-offset-2 hover:underline" href={`${COMMIT_URL}${commit}`}>
            {commit}
          </a>
        </>
      )}
    </p>
  );
}
