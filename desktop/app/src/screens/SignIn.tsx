import { Globe, LineChart, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useAuth } from "@/lib/useAuth";

/**
 * The native app's sign-in. Sign-in is handed to the student's real browser (Google refuses
 * embedded web-views and Telegram's popup is unreliable there — see backend/desktop/views.py),
 * so there is one way in: the browser opens, the student signs in however they like, and the app
 * takes the hand-off from there. Visual twin of the website's /login so the app reads as one
 * product. The flow is driven by useAuth (PKCE verifier in the shell, JWTs stored by the app).
 */
export function SignIn() {
  const { status, error, signIn } = useAuth();
  const connecting = status === "connecting";

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

      {/* Sign-in panel */}
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
              onClick={signIn}
              loading={connecting}
              fullWidth
              size="lg"
              leftIcon={<Globe />}
              className="!bg-[#2a68c0] hover:!bg-[#21539e]"
            >
              {connecting ? "Waiting for your browser…" : "Sign in with your browser"}
            </Button>

            <p className="-mt-1 text-center text-xs font-medium leading-relaxed text-muted-foreground">
              {connecting
                ? "Finish signing in in your browser, then come back — this screen updates on its own."
                : "Your browser opens so you can sign in with Google, Telegram or your email — whatever you use on the website. The app takes it from there."}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
