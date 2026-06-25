import { useEffect, useRef, useState } from 'react';

// Web Speech API hook. Captures the local microphone, fires `onFinalChunk`
// with each finalized phrase. The hook auto-restarts recognition on the
// transient `no-speech` / `aborted` errors Chrome throws periodically.
//
// Browser support: Chrome / Edge / Safari. Firefox is unsupported.
//
// Returns: { supported, listening, error, start, stop }

export function useTranscription({ enabled, onFinalChunk }) {
  const recognitionRef = useRef(null);
  const enabledRef     = useRef(enabled);
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [error, setError]         = useState(null);
  // 'unknown' | 'prompt' | 'granted' | 'denied'
  const [permissionState, setPermissionState] = useState('unknown');

  // Keep enabledRef in sync so the auto-restart in `onend` can read latest.
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
    recognition.lang           = 'en-US';

    recognition.onstart = () => setListening(true);
    recognition.onend   = () => {
      setListening(false);
      // Auto-restart if we're still supposed to be running.
      if (!stopped && enabledRef.current && recognitionRef.current === recognition) {
        try { recognition.start(); } catch { /* already starting */ }
      }
    };
    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') {
        // Benign — onend will restart.
        return;
      }
      setError(e.error || 'speech_error');
      if (e.error === 'not-allowed') {
        stopped = true;
        recognitionRef.current = null;
      }
    };
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = (result[0]?.transcript || '').trim();
          if (text) onFinalChunk(text, result[0]?.confidence ?? null);
        }
      }
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch (e) { setError(e.message); }

    return () => {
      stopped = true;
      recognitionRef.current = null;
      try { recognition.stop(); } catch {}
    };
  }, [enabled, onFinalChunk]);

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
