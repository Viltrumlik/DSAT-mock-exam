"use client";
import { DesktopSignIn } from "@/features/desktop/DesktopSignIn";

/** The app's sign-in. The shell sends /login here too: the website's page can't work inside it. */
export default function DesktopLoginPage() {
  return <DesktopSignIn />;
}
