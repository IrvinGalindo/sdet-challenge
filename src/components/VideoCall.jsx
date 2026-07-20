import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export function VideoCall({ sessionId, role, displayName, onLeft, onMuteStatusChanged }) {
  const containerRef = useRef(null);
  const jitsiApiRef = useRef(null);
  const [jitsiReady, setJitsiReady] = useState(false);
  const [jitsiError, setJitsiError] = useState('');
  const [activeDomain, setActiveDomain] = useState(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const isInterviewer = role === 'interviewer';

  // Keep stable reference to callbacks to prevent iframe from restarting on parent re-renders
  const onLeftRef = useRef(onLeft);
  useEffect(() => {
    onLeftRef.current = onLeft;
  }, [onLeft]);

  const onMuteStatusChangedRef = useRef(onMuteStatusChanged);
  useEffect(() => {
    onMuteStatusChangedRef.current = onMuteStatusChanged;
  }, [onMuteStatusChanged]);


  // 1. Load Jitsi script and check until window.JitsiMeetExternalAPI is a constructor
  useEffect(() => {
    let pollInterval = null;
    let isCancelled = false;

    const checkReady = (domain) => {
      if (typeof window.JitsiMeetExternalAPI === 'function') {
        clearInterval(pollInterval);
        if (!isCancelled) {
          setActiveDomain(domain);
          setJitsiReady(true);
        }
        return true;
      }
      return false;
    };

    if (checkReady('meet.element.io')) {
      return;
    }

    const mirrors = [
      { domain: 'meet.element.io', src: 'https://meet.element.io/external_api.js' },
      { domain: 'meet.jit.si', src: 'https://meet.jit.si/external_api.js' }
    ];

    let timeoutId = null;

    const tryLoadMirror = (index) => {
      if (index >= mirrors.length) {
        if (!isCancelled) {
          setJitsiError('Video conference mirrors took too long to load or are blocked. Please check your network or adblocker settings.');
        }
        return;
      }

      const { domain, src } = mirrors[index];
      console.log(`[VideoCall] Attempting to load Jitsi API script from: ${src}`);

      // Clean up previous script tag with data-jitsi if any
      const existing = document.querySelector('script[data-jitsi]');
      if (existing) {
        existing.remove();
      }

      const script = document.createElement('script');
      script.src = src;
      script.setAttribute('data-jitsi', '1');
      script.async = true;
      document.body.appendChild(script);

      // Start polling for JitsiMeetExternalAPI to become available
      clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (checkReady(domain)) {
          clearTimeout(timeoutId);
        }
      }, 200);

      // Timeout for this specific mirror
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        clearInterval(pollInterval);
        console.warn(`[VideoCall] Timeout loading mirror: ${src}. Trying next mirror...`);
        if (!isCancelled) {
          tryLoadMirror(index + 1);
        }
      }, 10000); // 10 seconds per mirror
    };

    tryLoadMirror(0);

    return () => {
      isCancelled = true;
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  }, [retryTrigger]);

  // 2. Initialize Jitsi once the API constructor is available
  useEffect(() => {
    if (!jitsiReady || !activeDomain || !containerRef.current || !sessionId) return;
    if (typeof window.JitsiMeetExternalAPI !== 'function') return;

    containerRef.current.innerHTML = '';

    const roomDocRef = doc(db, 'sessions', sessionId, 'videoRoom', 'room');
    if (isInterviewer) {
      setDoc(roomDocRef, { interviewerLeft: false }).catch(() => {});
    }

    let api;
    try {
      api = new window.JitsiMeetExternalAPI(activeDomain, {
        roomName: `sdet-challenge-${sessionId}`,
        width: '100%',
        height: '100%',
        parentNode: containerRef.current,
        userInfo: { displayName },
        configOverwrite: {
          prejoinPageEnabled: false,
          startWithAudioMuted: false,
          startWithVideoMuted: true,
          disableDeepLinking: true,
          disableInviteFunctions: true,
          hideConferenceSubject: true,
          toolbarButtons: ['microphone', 'camera', 'hangup', 'tileview', 'settings'],
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
        },
      });
      jitsiApiRef.current = api;
    } catch (e) {
      console.error('[VideoCall] Failed to initialize Jitsi API:', e);
      setJitsiError('Video conference initialization failed.');
      return;
    }

    api.addEventListener('videoConferenceLeft', async () => {
      console.log(`[VideoCall] Local user hung up`);
      if (isInterviewer) {
        try { await updateDoc(roomDocRef, { interviewerLeft: true }); } catch (e) {}
      }
      if (onLeftRef.current) onLeftRef.current();
    });

    api.addEventListener('videoConferenceJoined', async () => {
      try {
        const muted = await api.isAudioMuted();
        console.log(`[VideoCall] Joined conference, initial mute state:`, muted);
        if (onMuteStatusChangedRef.current) {
          onMuteStatusChangedRef.current(muted);
        }
      } catch (e) {
        console.warn('[VideoCall] Failed to check initial mute status on join:', e);
      }
    });

    api.addEventListener('audioMuteStatusChanged', (event) => {
      console.log(`[VideoCall] audioMuteStatusChanged event:`, event.muted);
      if (onMuteStatusChangedRef.current) {
        onMuteStatusChangedRef.current(event.muted);
      }
    });

    return () => {
      try { api.dispose(); } catch (e) {}
      jitsiApiRef.current = null;
    };
  }, [jitsiReady, activeDomain, sessionId, displayName, isInterviewer]);


  // 3. Candidate: listen for interviewer leaving via Firestore
  useEffect(() => {
    if (!sessionId || isInterviewer) return;
    const roomDocRef = doc(db, 'sessions', sessionId, 'videoRoom', 'room');
    const unsub = onSnapshot(roomDocRef, (snap) => {
      if (snap.data()?.interviewerLeft && onLeftRef.current) {
        onLeftRef.current();
      }
    });
    return () => unsub();
  }, [sessionId, isInterviewer]);


  return (
    <div style={{ width: '100%', aspectRatio: '16/9', background: '#111214', position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      {jitsiError ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: 12, padding: 24, zIndex: 10 }}>
          <AlertTriangle size={32} style={{ color: '#fbbf24' }} />
          <p style={{ textAlignment: 'center', fontSize: 13, color: 'rgba(255,255,255,0.7)', maxWidth: 300 }}>{jitsiError}</p>
          <button onClick={() => { setJitsiError(''); setJitsiReady(false); setActiveDomain(null); setRetryTrigger(prev => prev + 1); }} style={{ padding: '8px 18px', borderRadius: 20, border: 'none', background: '#5b5fc7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Retry
          </button>
        </div>
      ) : !jitsiReady ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, gap: 8, zIndex: 5 }}>
          <RefreshCw size={14} style={{ animation: 'spin 1.5s linear infinite' }} />
          Loading video conference…
        </div>
      ) : null}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}
