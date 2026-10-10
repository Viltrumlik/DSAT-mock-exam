import { useState } from "react";
import { Globe, LogIn, Mail, Lock, Eye, EyeOff, LineChart, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";

/**
 * The native app's sign-in. "Sign in with your browser" is the main way in (Google refuses
 * embedded web-views), with email + password alongside. Visual twin of the website's /login
 * so the app reads as one product. Auth wiring (PKCE + tokens) lands in a later phase; the
 * handlers here are placeholders so the screen is reviewable on its own.
 */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithBrowser = () => {
    setError(null);
    setWaiting(true);
    // TODO(phase 2): desktop.beginBrowserSignIn() via the Tauri bridge.
  };

  const signInWithPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    // TODO(phase 2): POST /api/auth → store tokens → enter app.
    setTimeout(() => setBusy(false), 600);
  };

  return (
    <div className="ds-app flex min-h-screen bg-background text-foreground">
      {/* Brand panel — wide windows only */}
      <aside
        className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: "linear-gradient(160deg,#2a68c0,#1f4d9a)" }}
      >
        <span aria-hidden className="pointer-events-none absolute -right-[70px] -top-[50px] h-[280px] w-[280px] rounded-full bg-white/10" style={{ animation: "dz-floatA 14s ease-in-out infinite" }} />
        <span aria-hidden className="pointer-events-none absolute -bottom-[90px] right-[60px] h-[200px] w-[200px] bg-white/[0.08]" style={{ borderRadius: 44, animation: "dz-floatB 16s ease-in-out infinite" }} />
        <span aria-hidden className="pointer-events-none absolute bottom-[120px] -left-[60px] h-[150px] w-[150px] rounded-full border-[18px] border-white/[0.11]" style={{ animation: "dz-floatC 13s ease-in-out infinite" }} />
        <span aria-hidden className="pointer-events-none absolute left-[40px] top-[180px] h-4 w-4 rounded-[5px] bg-white/30" style={{ animation: "dz-floatD 11s ease-in-out infinite" }} />

        <div className="relative flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-12 w-auto object-contain" style={{ filter: "brightness(0) invert(1)" }} />
          <p className="text-xl font-extrabold tracking-tight">MasterSAT</p>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[44px] font-extrabold leading-[1.05] tracking-tight">Your digital SAT, mastered.</h2>
          <ul className="mt-9 flex flex-col gap-4">
            {[
              { icon: LineChart, text: "Live readiness and score trends" },
              { icon: Sparkles, text: "Classroom assessments and monthly midterm exams" },
              { icon: ShieldCheck, text: "A real, locked-down exam environment" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px] font-medium">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs opacity-70">© {new Date().getFullYear()} MasterSAT Center</p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <img src="/logo.png" alt="" className="mx-auto h-16 w-16 object-contain" />
            <h1 className="ds-h2 mt-3">MasterSAT</h1>
          </div>

          <div className="mb-7 hidden lg:block">
            <h1 className="text-[34px] font-extrabold tracking-tight text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm font-medium text-muted-foreground">Sign in to see your tests.</p>
          </div>

          <div className="flex flex-col gap-4">
            {error ? <Alert tone="danger" title={error} /> : null}

            <Button
              type="button"
              onClick={signInWithBrowser}
              fullWidth
              size="lg"
              leftIcon={<Globe />}
              className="!bg-[#2a68c0] hover:!bg-[#21539e]"
            >
              Sign in with your browser
            </Button>
            <p className="-mt-1 text-center text-xs font-medium text-muted-foreground">
              {waiting
                ? "Finish signing in in your browser, then come back."
                : "Use Google, Telegram or your email — whatever you use on the website."}
            </p>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-border" />
              <span className="ds-overline">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <form className="flex flex-col gap-4" onSubmit={signInWithPassword}>
              <Field label="Email or username" htmlFor="email">
                <Input
                  id="email"
                  type="text"
                  placeholder="name@example.com or username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  autoComplete="username"
                  leftIcon={<Mail className="h-4 w-4" />}
                />
              </Field>
              <Field label="Password" htmlFor="password">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  autoComplete="current-password"
                  leftIcon={<Lock className="h-4 w-4" />}
                  rightSlot={
                    <button type="button" tabIndex={-1} aria-label={showPw ? "Hide password" : "Show password"}
                      onClick={() => setShowPw((v) => !v)}
                      className="ds-ring flex items-center justify-center rounded-md text-label-foreground hover:text-foreground">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />
              </Field>
              <Button type="submit" loading={busy} fullWidth size="lg" rightIcon={<LogIn />} variant="secondary">
                Sign in
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
