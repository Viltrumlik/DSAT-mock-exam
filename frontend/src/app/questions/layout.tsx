import AuthGuard from "@/components/AuthGuard";
import { OverlayFaceProvider } from "@/components/ui/OverlayFace";

/** Set in the body's Georgia, like the other staff consoles, so its overlays are too — see OverlayFace. */
export default function QuestionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <OverlayFaceProvider face="body">
      <AuthGuard adminOnly>{children}</AuthGuard>
    </OverlayFaceProvider>
  );
}
