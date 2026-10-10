import { SignIn } from "./screens/SignIn";
import { Offline } from "./screens/Offline";
import { useOnline } from "./lib/useOnline";

// Phase 1: the native app frame. The shell is bundled and always loads; connectivity only gates
// the network screens, so "offline" is this native screen — never the webview's error page.
// A full screen router (sign-in -> Your tests -> runner -> finish) lands in later phases.
export default function App() {
  const online = useOnline();
  if (!online) return <Offline onRetry={() => window.location.reload()} />;
  return <SignIn />;
}
