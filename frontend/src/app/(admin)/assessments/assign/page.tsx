"use client";

import AuthGuard from "@/components/AuthGuard";
import { OverlayFaceProvider } from "@/components/ui/OverlayFace";
import AssignAssessmentContainer from "@/features/assessments/containers/AssignAssessmentContainer";

/** Set in the body's Georgia, like the staff consoles, so its toasts are too — see OverlayFace. */
export default function AssignAssessmentRootPage() {
  return (
    <OverlayFaceProvider face="body">
      <AuthGuard adminOnly>
        <AssignAssessmentContainer />
      </AuthGuard>
    </OverlayFaceProvider>
  );
}

