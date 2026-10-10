import { SignIn } from "./screens/SignIn";

// Phase 1: the native app frame currently opens on sign-in. A screen router
// (sign-in → Your tests → runner → finish → offline) lands as later phases arrive.
export default function App() {
  return <SignIn />;
}
