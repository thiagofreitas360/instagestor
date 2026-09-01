"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 8_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const sync = () => {
      const hidden = document.visibilityState !== "visible";
      setPaused(hidden);
      if (timer) clearInterval(timer);
      timer = undefined;
      if (!hidden) {
        timer = setInterval(() => router.refresh(), intervalMs);
      }
    };

    const onVisibilityChange = () => {
      const wasHidden = document.visibilityState === "visible";
      sync();
      if (wasHidden) router.refresh();
    };

    sync();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, router]);

  return (
    <span className={`auto-refresh-indicator ${paused ? "is-paused" : ""}`} role="status">
      <span aria-hidden="true" />
      {paused ? "Atualização pausada" : `Atualização automática · ${Math.round(intervalMs / 1_000)}s`}
    </span>
  );
}
