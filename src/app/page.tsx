'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

interface BiometricProfile {
  f0: number;
  centroid: number;
  formantDiffs: number[];
}

// ============================================================================
// BIOMETRIC DSP ENGINE: SUB-HERTZ AUTOCORRELATION & FORMANT DIFFERENTIALS
// ============================================================================

// 1. Extracts exact vocal cord pitch in Hz (0.1 Hz precision) using Autocorrelation
function extractPitchHz(timeDomain: Float32Array, sampleRate: number): number | null {
  // Voice Activity Detection (VAD): Calculate RMS volume to ignore silence/breath
  let rms = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    rms += timeDomain[i] * timeDomain[i];
  }
  rms = Math.sqrt(rms / timeDomain.length);
  if (rms < 0.012) return null; // Sensitive threshold to capture soft or sore-throat speech while rejecting room noise

  // Search human vocal cord fundamental range: 75 Hz to 320 Hz
  const minLag = Math.floor(sampleRate / 320);
  const maxLag = Math.floor(sampleRate / 75);

  let bestCorr = 0;
  let bestLag = -1;
  const correlations = new Float32Array(maxLag + 2);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0, normA = 0, normB = 0;
    for (let i = 0; i < timeDomain.length - lag; i++) {
      sum += timeDomain[i] * timeDomain[i + lag];
      normA += timeDomain[i] * timeDomain[i];
      normB += timeDomain[i + lag] * timeDomain[i + lag];
    }
    const corr = sum / Math.sqrt((normA * normB) || 1);
    correlations[lag] = corr;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Accept frames with periodic vocal cord vibration (>= 0.60 accommodates slight vocal jitter/hoarseness from sore throat)
  if (bestCorr < 0.60 || bestLag <= minLag || bestLag >= maxLag) return null;

  // Check for subharmonic / octave error: prefer fundamental lag if correlation is strong
  const halfLag = Math.round(bestLag / 2);
  if (halfLag >= minLag && correlations[halfLag] >= 0.85 * bestCorr) {
    bestLag = halfLag;
  }

  // Parabolic interpolation for sub-Hz precision (0.1 Hz accuracy)
  const y1 = correlations[bestLag - 1];
  const y2 = correlations[bestLag];
  const y3 = correlations[bestLag + 1];
  const denom = y1 - 2 * y2 + y3;
  const shift = denom !== 0 ? (0.5 * (y1 - y3)) / denom : 0;

  const exactLag = bestLag + (Math.abs(shift) < 1 ? shift : 0);
  return sampleRate / exactLag;
}

// 2. Extracts Spectral Centroid (Hz) and Slope-Removed Formant Bands
function extractVocalTractFeatures(freqCancelDb: Float32Array, sampleRate: number, fftSize: number) {
  const binHz = sampleRate / fftSize;
  let weightedFreqSum = 0;
  let totalEnergy = 0;

  // Measure between 100 Hz and 3800 Hz (Core vocal tract formant zone)
  const startBin = Math.floor(100 / binHz);
  const endBin = Math.min(freqCancelDb.length - 1, Math.floor(3800 / binHz));

  for (let i = startBin; i <= endBin; i++) {
    // Sanitize non-finite values from Web Audio FFT
    const db = Number.isFinite(freqCancelDb[i]) ? Math.max(-100, freqCancelDb[i]) : -100;
    const amp = Math.pow(10, db / 20);
    const freq = i * binHz;
    weightedFreqSum += freq * amp;
    totalEnergy += amp;
  }

  const centroid = totalEnergy > 0 ? weightedFreqSum / totalEnergy : 0;

  // 16 Logarithmically spaced Mel-Formant bands from 100 Hz to 3600 Hz
  const bandEdgesHz = [
    100, 150, 210, 280, 360, 450, 560, 690,
    840, 1020, 1230, 1480, 1780, 2140, 2570, 3080, 3600
  ];
  const bandLogEnergies: number[] = [];

  for (let b = 0; b < 16; b++) {
    const bStart = Math.max(1, Math.floor(bandEdgesHz[b] / binHz));
    const bEnd = Math.min(freqCancelDb.length - 1, Math.ceil(bandEdgesHz[b + 1] / binHz));
    let sumDb = 0;
    let count = 0;
    for (let i = bStart; i <= bEnd; i++) {
      const db = Number.isFinite(freqCancelDb[i]) ? Math.max(-100, freqCancelDb[i]) : -100;
      sumDb += db;
      count++;
    }
    bandLogEnergies.push(count > 0 ? sumDb / count : -100);
  }

  // First-order differential (Band[i+1] - Band[i]) to DESTROY global spectral tilt / mic bias!
  const diffs: number[] = [];
  for (let i = 0; i < bandLogEnergies.length - 1; i++) {
    diffs.push(bandLogEnergies[i + 1] - bandLogEnergies[i]);
  }

  return { centroid, diffs };
}

// Helper: Median calculation (immune to single-frame coughs/glitches)
function getMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState({ type: '', message: '' });
  const [activeTab, setActiveTab] = useState<'passkey' | 'voice' | 'recovery'>('passkey');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(false);

  // User Details & Voiceprint State
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [enrolledVoiceprint, setEnrolledVoiceprint] = useState<BiometricProfile | null>(null);

  // Voice & Recovery States
  const [voiceChallenge, setVoiceChallenge] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [guardians] = useState(['Alice', 'Bob', 'Charlie']);
  const [demoMasterKey, setDemoMasterKey] = useState('');
  const [recoveryInput1, setRecoveryInput1] = useState('');
  const [recoveryInput2, setRecoveryInput2] = useState('');
  const [recoveredKey, setRecoveredKey] = useState('');

  const onSuccessRedirect = (user: string, message: string) => {
    setStatus({ type: 'success', message });
    localStorage.setItem('astrapass_user', user);
    setTimeout(() => router.push('/dashboard'), 1800);
  };

  // --- REGISTRATION: SUB-HERTZ BIOMETRIC EXTRACTION ---
  const recordBaselineVoiceprint = async () => {
    try {
      setIsProcessing(true);
      setStatus({ type: 'info', message: '🎤 Speak continuously and clearly for 3.5 seconds...' });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
     
      analyser.fftSize = 4096; // High precision time & frequency buffer
      source.connect(analyser);

      const timeData = new Float32Array(analyser.fftSize);
      const freqData = new Float32Array(analyser.frequencyBinCount);

      const pitchSamples: number[] = [];
      const centroidSamples: number[] = [];
      const diffsAccumulator = new Float32Array(15);
      let voicedFrames = 0;

      const interval = setInterval(() => {
        analyser.getFloatTimeDomainData(timeData);
        const pitchHz = extractPitchHz(timeData, audioContext.sampleRate);

        // ONLY sample frames where vocal cords are actively vibrating!
        if (pitchHz !== null) {
          analyser.getFloatFrequencyData(freqData);
          const { centroid, diffs } = extractVocalTractFeatures(freqData, audioContext.sampleRate, analyser.fftSize);
         
          pitchSamples.push(pitchHz);
          centroidSamples.push(centroid);
          for (let i = 0; i < 15; i++) diffsAccumulator[i] += diffs[i];
          voicedFrames++;
        }
      }, 40);

      setTimeout(() => {
        clearInterval(interval);
        stream.getTracks().forEach(t => t.stop());
        audioContext.close();

        if (voicedFrames < 6) {
          setStatus({ type: 'error', message: '❌ Voice too quiet or brief. Please speak louder and continuously.' });
          setIsProcessing(false);
          return;
        }

        const profile: BiometricProfile = {
          f0: getMedian(pitchSamples),
          centroid: getMedian(centroidSamples),
          formantDiffs: Array.from(diffsAccumulator).map(v => v / voicedFrames),
        };

        setEnrolledVoiceprint(profile);
        setStatus({
          type: 'success',
          message: `🎙️ Biometrics Locked! Fundamental Pitch: ${profile.f0.toFixed(1)} Hz | Resonance: ${profile.centroid.toFixed(0)} Hz`
        });
        setIsProcessing(false);
      }, 3500);
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Microphone permission denied.' });
      setIsProcessing(false);
    }
  };

  // --- PASSKEY FLOWS ---
  const handleRegister = async () => {
    if (!username || !fullName || !email) return setStatus({ type: 'error', message: 'All text fields are required.' });
    if (!enrolledVoiceprint) return setStatus({ type: 'error', message: 'You must record your voiceprint first.' });
   
    setStatus({ type: 'info', message: 'Minting hardware passkey...' });
    setIsProcessing(true);
    try {
      const resp = await fetch('/api/webauthn/register/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, fullName, email, voiceprint: enrolledVoiceprint }),
      });
      const optionsJSON = await resp.json();
      if (optionsJSON.error) throw new Error(optionsJSON.error);

      const attResp = await startRegistration({ optionsJSON });

      const verifyResp = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, registrationResponse: attResp }),
      });
      const verifyJSON = await verifyResp.json();

      if (verifyJSON.error) throw new Error(verifyJSON.error);
      if (verifyJSON.verified) onSuccessRedirect(username, '✅ Passkey & Voiceprint secured! Redirecting...');
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
    setIsProcessing(false);
  };

  const handleLogin = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    setStatus({ type: 'info', message: 'Awaiting biometric verification...' });
    setIsProcessing(true);
    try {
      const resp = await fetch('/api/webauthn/login/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const optionsJSON = await resp.json();
      if (optionsJSON.error) throw new Error(optionsJSON.error);

      const asseResp = await startAuthentication({ optionsJSON });

      const verifyResp = await fetch('/api/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, authenticationResponse: asseResp }),
      });
      const verifyJSON = await verifyResp.json();

      if (verifyJSON.error) throw new Error(verifyJSON.error);
      if (verifyJSON.verified) onSuccessRedirect(username, '🔓 FIDO2 Verified. Redirecting...');
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
    setIsProcessing(false);
  };

  // --- IVR LOGIN FLOW: SUB-HERTZ VERIFICATION ---
  const requestVoiceChallenge = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    setStatus({ type: 'info', message: 'Generating acoustic cipher...' });
    setIsProcessing(true);
    try {
      const resp = await fetch('/api/ivr/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setVoiceChallenge(data.challengePhrase);
      setStatus({ type: 'info', message: 'Speak the cipher phrase clearly at your normal pitch.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
    setIsProcessing(false);
  };

  const listenAndVerify = async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return setStatus({ type: 'error', message: 'Use Chrome for Speech API.' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
     
      analyser.fftSize = 4096;
      source.connect(analyser);

      const timeData = new Float32Array(analyser.fftSize);
      const freqData = new Float32Array(analyser.frequencyBinCount);

      const pitchSamples: number[] = [];
      const centroidSamples: number[] = [];
      const diffsAccumulator = new Float32Array(15);
      let voicedFrames = 0;

      const interval = setInterval(() => {
        analyser.getFloatTimeDomainData(timeData);
        const pitchHz = extractPitchHz(timeData, audioContext.sampleRate);

        if (pitchHz !== null) {
          analyser.getFloatFrequencyData(freqData);
          const { centroid, diffs } = extractVocalTractFeatures(freqData, audioContext.sampleRate, analyser.fftSize);
         
          pitchSamples.push(pitchHz);
          centroidSamples.push(centroid);
          for (let i = 0; i < 15; i++) diffsAccumulator[i] += diffs[i];
          voicedFrames++;
        }
      }, 40);

      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
     
      recognition.onstart = () => {
        setIsListening(true);
        setStatus({ type: 'info', message: '🎤 Listening... Measuring vocal cord Hz & formants...' });
      };
     
      recognition.onresult = async (event: any) => {
        setIsListening(false);
        clearInterval(interval);
        stream.getTracks().forEach(t => t.stop());
        audioContext.close();
       
        if (voicedFrames < 3) {
          setStatus({ type: 'error', message: '❌ Audio too brief to extract Hz biometrics. Speak clearly.' });
          return;
        }

        const liveProfile: BiometricProfile = {
          f0: getMedian(pitchSamples),
          centroid: getMedian(centroidSamples),
          formantDiffs: Array.from(diffsAccumulator).map(v => v / voicedFrames),
        };

        const transcript = event.results[0][0].transcript;
        setStatus({ type: 'info', message: `Heard "${transcript}" (${liveProfile.f0.toFixed(1)} Hz). Verifying...` });

        try {
          const resp = await fetch('/api/ivr/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, transcript, voiceprint: liveProfile }),
          });
          const data = await resp.json();
          if (data.error) throw new Error(data.error);
          if (data.verified) {
            setVoiceChallenge('');
            onSuccessRedirect(username, data.message);
          }
        } catch (error: any) {
          setStatus({ type: 'error', message: error.message });
        }
      };
     
      recognition.onerror = (event: any) => {
        setIsListening(false);
        clearInterval(interval);
        stream.getTracks().forEach(t => t.stop());
        audioContext.close();
        setStatus({ type: 'error', message: `Audio stream lost: ${event.error}` });
      };
     
      recognition.start();
    } catch (e) {
      setStatus({ type: 'error', message: 'Mic permission denied.' });
    }
  };

  // --- RECOVERY FLOW ---
  const setupRecovery = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    setIsProcessing(true);
    setStatus({ type: 'info', message: 'Executing Shamir\'s Secret Sharing...' });
    try {
      const resp = await fetch('/api/recovery/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, guardians }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setDemoMasterKey(data.demo_master_key);
      setStatus({ type: 'success', message: 'Shards distributed.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
    setIsProcessing(false);
  };

  const reconstructKey = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    if (!recoveryInput1 || !recoveryInput2) return setStatus({ type: 'error', message: 'Need 2 shards.' });
    setIsProcessing(true);
    setStatus({ type: 'info', message: 'Recombining cryptographic shards...' });
    try {
      const resp = await fetch('/api/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, submittedShares: [recoveryInput1, recoveryInput2] }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setRecoveredKey(data.recoveredKey);
      setStatus({ type: 'success', message: '✅ Key Reconstructed.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
    setIsProcessing(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 font-sans selection:bg-blue-500/30">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl transition-all">
       
        {/* HEADER */}
        <div className="mb-8 text-center relative">
          <Link href="/admin" className="absolute right-0 top-0 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-blue-400 transition-colors border border-slate-800 rounded-lg px-2.5 py-1 bg-slate-950/60">
            Admin 🛡️
          </Link>
          <h1 className="mb-2 mt-4 text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 drop-shadow-md">
            AstraPass
          </h1>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Zero-Knowledge Identity</p>
        </div>

        {/* TABS */}
        <div className="mb-8 flex rounded-xl bg-slate-950/50 p-1 shadow-inner ring-1 ring-slate-800/50">
          {(['passkey', 'voice', 'recovery'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setStatus({type:'', message:''}); }}
              className={`flex-1 rounded-lg py-2.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeTab === tab ? 'bg-slate-800 text-white shadow-md ring-1 ring-slate-700' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
              }`}
            >
              {tab === 'passkey' ? 'FIDO2' : tab === 'voice' ? 'IVR' : 'Recovery'}
            </button>
          ))}
        </div>

        <div className="space-y-4">
         
          {/* USERNAME INPUT */}
          <div className="group">
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400 group-focus-within:text-blue-400 transition-colors">
              Subject Identifier (Username)
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-white shadow-inner transition-all placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              placeholder="e.g. agent_007"
            />
          </div>

          {/* PASSKEY TAB */}
          {activeTab === 'passkey' && (
            <>
              <div className="flex items-center justify-end mb-2">
                <button
                  onClick={() => setIsLoginMode(!isLoginMode)}
                  className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors underline underline-offset-4"
                >
                  {isLoginMode ? 'Need to register an account?' : 'Already have an account? Log in.'}
                </button>
              </div>

              {!isLoginMode && (
                <div className="space-y-3 pb-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400">Full Name</label>
                      <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full mt-1 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none" placeholder="James Bond" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400">Email Address</label>
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mt-1 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none" placeholder="007@mi6.gov" />
                    </div>
                  </div>
                  <button
                    onClick={recordBaselineVoiceprint}
                    disabled={isProcessing}
                    className={`w-full py-2.5 rounded-lg border border-purple-500/50 text-sm font-bold transition-all ${
                      enrolledVoiceprint ? 'bg-purple-900/50 text-purple-200' : 'bg-slate-900 text-purple-400 hover:bg-slate-800'
                    }`}
                  >
                    {enrolledVoiceprint
                      ? `✅ Voice Locked (${enrolledVoiceprint.f0.toFixed(1)} Hz)`
                      : '🎙️ Record Voiceprint (Required)'}
                  </button>
                </div>
              )}

              <div className="flex gap-4 pt-2">
                {!isLoginMode ? (
                  <button onClick={handleRegister} disabled={isProcessing} className="w-full rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-900/20 transition-all hover:scale-[1.02] hover:shadow-blue-900/40 active:scale-95 disabled:opacity-50 disabled:hover:scale-100">
                    Register New Account
                  </button>
                ) : (
                  <button onClick={handleLogin} disabled={isProcessing} className="w-full rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/20 transition-all hover:scale-[1.02] hover:shadow-emerald-900/40 active:scale-95 disabled:opacity-50 disabled:hover:scale-100">
                    Authenticate & Log In
                  </button>
                )}
              </div>
            </>
          )}

          {/* VOICE TAB */}
          {activeTab === 'voice' && (
            <div className="flex flex-col gap-4 pt-2">
              {!voiceChallenge ? (
                <button onClick={requestVoiceChallenge} disabled={isProcessing} className="w-full rounded-xl bg-gradient-to-br from-purple-600 to-purple-700 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-purple-900/20 transition-all hover:scale-[1.02] hover:shadow-purple-900/40 active:scale-95 disabled:opacity-50">
                  Generate Acoustic Cipher
                </button>
              ) : (
                <div className="overflow-hidden rounded-xl border border-purple-500/30 bg-purple-950/20 shadow-inner">
                  <div className="bg-purple-900/20 px-4 py-2 border-b border-purple-500/20"><p className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Incoming Transmission</p></div>
                  <div className="p-6 text-center">
                    <p className="mb-6 text-3xl font-black tracking-widest text-white drop-shadow-md">{voiceChallenge}</p>
                    <button type="button" onClick={listenAndVerify} disabled={isListening} className={`w-full rounded-xl px-4 py-3.5 text-sm font-bold text-white transition-all shadow-lg ${isListening ? 'bg-red-600 animate-pulse shadow-red-900/50 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 hover:scale-[1.02] active:scale-95 shadow-emerald-900/30'}`}>
                      {isListening ? 'Intercepting Audio...' : 'Initialize Microphone'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RECOVERY TAB */}
          {activeTab === 'recovery' && (
            <div className="flex flex-col gap-5 pt-2">
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 shadow-inner">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-blue-400">1. Distribute Shards</h3>
                <button onClick={setupRecovery} disabled={isProcessing} className="mb-4 w-full rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-slate-600 active:scale-95 disabled:opacity-50">
                  Split Key (3 Guardians)
                </button>
                {demoMasterKey && (
                  <div className="rounded-md border border-green-900/50 bg-black/50 p-3 text-center shadow-inner">
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Master Cipher (Destroyed on Server)</p>
                    <p className="break-all font-mono text-xs text-green-400">{demoMasterKey}</p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 shadow-inner">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-400">2. Combine Shards</h3>
                <div className="space-y-3">
                  <input type="text" value={recoveryInput1} onChange={e => setRecoveryInput1(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2.5 font-mono text-xs text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="Enter Shard Alpha..." />
                  <input type="text" value={recoveryInput2} onChange={e => setRecoveryInput2(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2.5 font-mono text-xs text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="Enter Shard Beta..." />
                  <button onClick={reconstructKey} disabled={isProcessing} className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-emerald-500 active:scale-95 disabled:opacity-50">
                    Reconstruct Origin Key
                  </button>
                </div>
                {recoveredKey && (
                  <div className="mt-4 rounded-md border border-emerald-900/50 bg-black/50 p-3 text-center shadow-inner">
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Reconstructed Cipher</p>
                    <p className="break-all font-mono text-xs text-emerald-400">{recoveredKey}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STATUS CONSOLE */}
          {status.message && (
            <div className={`overflow-hidden rounded-xl border text-sm backdrop-blur-sm transition-all duration-300 ${
                status.type === 'success' ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-200' :
                status.type === 'error' ? 'border-red-500/30 bg-red-950/40 text-red-200' :
                'border-blue-500/30 bg-blue-950/40 text-blue-200'
              }`}>
              <div className="px-4 py-3 flex items-center justify-center gap-2">
                <span className={`h-2 w-2 rounded-full animate-pulse ${
                  status.type === 'success' ? 'bg-emerald-400' : status.type === 'error' ? 'bg-red-400' : 'bg-blue-400'
                }`}></span>
                <p className="font-medium text-center">{status.message}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}