import { WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** The app's own offline screen — native, on-brand, never the webview's grey "No internet" page.
 *  Shown whenever there is no connection (sign-in and loading tests both need the server). */
export function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ds-app flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-soft text-primary">
        <WifiOff className="h-10 w-10" />
      </div>
      <h1 className="mt-7 text-2xl font-extrabold tracking-tight">You&rsquo;re offline</h1>
      <p className="mt-2 max-w-sm text-sm font-medium text-muted-foreground">
        The MasterSAT app needs an internet connection to sign in and load your tests. Check your
        connection and try again.
      </p>
      <Button
        onClick={onRetry}
        size="lg"
        leftIcon={<RefreshCw />}
        className="mt-7 !bg-[#2a68c0] hover:!bg-[#21539e]"
      >
        Try again
      </Button>
    </div>
  );
}
