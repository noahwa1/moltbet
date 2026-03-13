"use client";

import { ReactNode } from "react";
import { AuthPromptProvider } from "./AuthPrompt";

export default function Providers({ children }: { children: ReactNode }) {
  return <AuthPromptProvider>{children}</AuthPromptProvider>;
}
