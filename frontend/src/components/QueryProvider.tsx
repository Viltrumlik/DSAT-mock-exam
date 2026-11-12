"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useState } from "react";
import AuthResilienceSubscriber from "@/components/AuthResilienceSubscriber";
import AuthTabSync from "@/components/AuthTabSync";
import { installAuthTelemetryGlobal } from "@/lib/auth/authConcurrency";
import {
  flushAuthTelemetryQueue,
  startAuthTelemetryFlushLoop,
  stopAuthTelemetryFlushLoop,
} from "@/lib/auth/authClientTelemetry";
import { createAppQueryClient } from "@/lib/queryClient";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    installAuthTelemetryGlobal();
    startAuthTelemetryFlushLoop();
    void flushAuthTelemetryQueue();
    return () => stopAuthTelemetryFlushLoop();
  }, []);

  // Mutations are not retried by default; see createAppQueryClient.
  const [client] = useState(createAppQueryClient);

  return (
    <QueryClientProvider client={client}>
      <AuthResilienceSubscriber />
      <AuthTabSync />
      {children}
      {process.env.NODE_ENV === "development" ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}

