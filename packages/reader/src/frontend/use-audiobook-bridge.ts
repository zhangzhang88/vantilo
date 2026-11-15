import { useEffect, useRef } from "react";
import { isAudiobookAction, type AudiobookAction, type AudiobookSnapshot } from "../shared/audiobook-bridge";

function isDesktopOrigin(origin: string) {
  return origin === "null" || origin === "file://" || origin === "http://127.0.0.1:5173";
}

export function useAudiobookBridge(snapshot: AudiobookSnapshot | null, onAction: (action: AudiobookAction) => void) {
  const current = useRef({ snapshot, onAction });
  current.current = { snapshot, onAction };
  const host = useRef<{ token: string; origin: string } | null>(null);

  useEffect(() => {
    if (window.parent === window) return;
    function receive(event: MessageEvent) {
      if (event.source !== window.parent || !isDesktopOrigin(event.origin)) return;
      const data = event.data;
      if (data?.type === "vantilo:audiobook-connect" && typeof data.token === "string" && data.token.length <= 128 && data.token.length > 0) {
        host.current = { token: data.token, origin: event.origin === "http://127.0.0.1:5173" ? event.origin : "*" };
        window.parent.postMessage({ type: "vantilo:audiobook-state", token: data.token, snapshot: current.current.snapshot }, host.current.origin);
      } else if (data?.type === "vantilo:audiobook-control" && host.current && data.token === host.current.token
        && current.current.snapshot && data.sessionId === current.current.snapshot.sessionId && isAudiobookAction(data.action)) {
        current.current.onAction(data.action);
      }
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "vantilo:audiobook-ready" }, "*");
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (host.current) {
      window.parent.postMessage({ type: "vantilo:audiobook-state", token: host.current.token, snapshot }, host.current.origin);
    }
  }, [snapshot]);
}
