import { useEffect, useRef, useState } from 'react';

const log = (...args) => {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
};

// Web Speech API hook. Captures the local microphone, fires `onFinalChunk`
// with each finalized phrase. The hook auto-restarts recognition on the
// transient `no-speech` / `aborted` errors Chrome throws periodically.
//
// Browser support: Chrome / Edge / Safari. Firefox is unsupported.
//
// Returns: { supported, listening, error, start, stop }

export function useTranscription({ enabled, lang = 'en-US', onFinalChunk }) {
  const recognitionRef = useRef(null);
  const enabledRef     = useRef(enabled);
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [error, setError]         = useState(null);
  // 'unknown' | 'prompt' | 'granted' | 'denied'
  const [permissionState, setPermissionState] = useState('unknown');

  const onFinalChunkRef = useRef(onFinalChunk);

  // Keep callback and enabled states in sync so they can be read dynamically
  // without triggering effect restarts.
  useEffect(() => { onFinalChunkRef.current = onFinalChunk; }, [onFinalChunk]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Track mic permission state via the Permissions API where it's supported.
  // Firing the `change` listener auto-clears `error` so the recognition
  // can resume after the user re-enables the mic in browser settings.
  useEffect(() => {
    let permStatus = null;
    let cancelled = false;
    (async () => {
      try {
        if (navigator.permissions?.query) {
          permStatus = await navigator.permissions.query({ name: 'microphone' });
          if (cancelled) return;
          setPermissionState(permStatus.state);
          permStatus.onchange = () => {
            setPermissionState(permStatus.state);
            if (permStatus.state === 'granted') setError(null);
          };
        }
      } catch {
        // Firefox <81 throws for { name: 'microphone' }. Ignore.
      }
    })();
    return () => {
      cancelled = true;
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  useEffect(() => {
    const SR = typeof window !== 'undefined' &&
               (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) {
      setSupported(false);
      return;
    }
    if (!enabled) return;

    let stopped = false;
    const recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = false;
    recognition.lang           = lang;

    recognition.onstart = () => {
      log(`[Speech Engine] Speech recognition started (${lang}). Listening...`);
      setListening(true);
    };
    recognition.onend   = () => {
      log("[Speech Engine] Speech recognition stopped.");
      setListening(false);
      // Auto-restart if we're still supposed to be running.
      if (!stopped && enabledRef.current && recognitionRef.current === recognition) {
        log("[Speech Engine] Auto-restarting engine...");
        try { recognition.start(); } catch (e) { console.warn("[Speech Engine] Auto-restart failed:", e.message); }
      }
    };
    recognition.onerror = (event) => {
      console.error("[Speech Engine] Error event fired:", event.error);
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Benign — onend will restart.
        return;
      }
      setError(event.error || 'speech_error');
      if (event.error === 'not-allowed') {
        stopped = true;
        recognitionRef.current = null;
      }
    };
    recognition.onresult = (event) => {
      log("[Speech Engine] onresult event fired.", event.results);
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = (result[0]?.transcript || '').trim();
          log(`[Speech Engine] Result is final: "${text}"`);
          if (text && onFinalChunkRef.current) {
            onFinalChunkRef.current(text, result[0]?.confidence ?? null);
          }
        } else {
          log(`[Speech Engine] Interim result: "${result[0]?.transcript}"`);
        }
      }
    };

    recognitionRef.current = recognition;
    log(`[Speech Engine] Initializing and starting SpeechRecognition instance in ${lang}...`);
    log("[Speech Hook] useEffect initialized. enabled:", enabled);
    try { recognition.start(); } catch (e) { console.error("[Speech Engine] Start error:", e.message); setError(e.message); }

    return () => {
      log("[Speech Hook] useEffect cleaning up...");
      stopped = true;
      recognitionRef.current = null;
      try { recognition.stop(); } catch {}
    };
  }, [enabled, lang]);

  // Trigger the browser's native permission prompt. Works while state is
  // 'prompt'; if state is already 'denied' the browser won't reshow the
  // prompt and getUserMedia rejects with NotAllowedError — caller should
  // surface inline help (e.g. "click the lock icon").
  const requestPermission = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('insecure_context');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We don't need the stream itself — SpeechRecognition opens its own.
      stream.getTracks().forEach(t => t.stop());
      setError(null);
      setPermissionState('granted');
      return true;
    } catch (e) {
      if (e.message === 'insecure_context') {
        setError('Your browser is blocking microphone access because this connection is not secure (requires HTTPS or localhost).');
        return false;
      }
      const name = e?.name || 'unknown';
      setError(name === 'NotAllowedError' ? 'Microphone access was denied. Please allow it in your browser settings.' : 'Could not access the microphone: ' + e.message);
      if (name === 'NotAllowedError') setPermissionState('denied');
      return false;
    }
  };

  return {
    supported,
    listening,
    error,
    permissionState,
    requestPermission,
    stop:  () => { try { recognitionRef.current?.stop(); } catch {} },
    start: () => { try { recognitionRef.current?.start(); } catch {} },
  };
}
