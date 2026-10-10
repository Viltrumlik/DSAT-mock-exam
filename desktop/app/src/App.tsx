import { useState } from "react";
import { AuthProvider, useAuth } from "./lib/useAuth";
import { SignIn } from "./screens/SignIn";
import { YourTests } from "./screens/YourTests";
import { Offline } from "./screens/Offline";
import { useOnline } from "./lib/useOnline";
import { Spinner } from "./components/ui/Spinner";
import { ExamRunner } from "./exam/ExamRunner";
import { mockAttempt } from "./exam/mock";
import type { Attempt } from "./exam/types";

/**
 * The native app frame + router. The shell is bundled and always loads; connectivity gates only
 * the network screens, so "offline" is this native screen — never the webview's error page.
 *
 *   offline              → Offline
 *   deciding session     → boot splash
 *   signed in            → Your tests
 *   otherwise            → Sign in   (signed out, or mid browser hand-off)
 */
function Root() {
  const online = useOnline();
  const { status } = useAuth();
  const [runner, setRunner] = useState<Attempt | null>(null);

  if (status === "loading") return <BootSplash />;
  // The runner stays mounted through a brief connectivity blip — a dropped second must never
  // throw a student out of a test — so it is checked before the offline screen.
  if (status === "signedin" && runner) {
    return <ExamRunner attempt={runner} onExit={() => setRunner(null)} />;
  }
  if (!online) return <Offline onRetry={() => window.location.reload()} />;
  if (status === "signedin") return <YourTests onStart={(kind) => setRunner(mockAttempt(kind))} />;
  return <SignIn />;
}

function BootSplash() {
  return (
    <div className="ds-app flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <img src="/logo.png" alt="" className="h-14 w-14 object-contain" />
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
