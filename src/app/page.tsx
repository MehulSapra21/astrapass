'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

interface WavLMProfile {
  embedding: number[]; // 512-D X-Vector from Microsoft WavLM-Base-Plus-SV
  f0: number;          // Median vocal cord pitch in Hz
}

// Singleton cache so the pre-trained model only loads once per tab session
let wavlmProcessorPromise: Promise<any> | null = null;
let wavlmModelPromise: Promise<any> | null = null;

async function getWavLMEngine(onProgress?: (msg: string) => void) {
  if (!wavlmProcessorPromise || !wavlmModelPromise) {
    if (onProgress) {
      onProgress('🧠 Loading Microsoft WavLM-Base-Plus-SV Neural Network (~100MB, cached after 1st run)...');
    }
    const importModule = new Function('url', 'return import(url)');
    const { AutoProcessor, AutoModel, env } = await importModule(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1'
    );
    env.allowLocalModels = false;

    const modelId = 'Xenova/wavlm-base-plus-sv';
    wavlmProcessorPromise = AutoProcessor.from_pretrained(modelId);
    wavlmModelPromise = AutoModel.from_pretrained(modelId, { dtype: 'q8' });
  }
  const [processor, model] = await Promise.all([wavlmProcessorPromise, wavlmModelPromise]);
  return { processor, model };
}

// Decodes microphone audio Blob, resamples to exact 16,000 Hz mono, and trims silence
async function processAudioBlobTo16kHz(blob: Blob): Promise<{ pcm16k: Float32Array; f0: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();

  // Resample to exact 16,000 Hz mono required by Microsoft WavLM
  const targetRate = 16000;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  const rawPcm = rendered.getChannelData(0);

  // Voice Activity Detection (20ms = 320 samples at 16kHz) & Autocorrelation Pitch
  const frameSize = 320;
  const voicedSamples: number[] = [];
  const pitches: number[] = [];

  for (let i = 0; i + frameSize * 2 <= rawPcm.length; i += frameSize) {
    let sumSq = 0;
    for (let j = 0; j < frameSize; j++) sumSq += rawPcm[i + j] * rawPcm[i + j];
    const rms = Math.sqrt(sumSq / frameSize);

    if (rms > 0.015) {
      for (let j = 0; j < frameSize; j++) voicedSamples.push(rawPcm[i + j]);

      // Extract fundamental pitch (75 Hz - 300 Hz) on 640-sample window
      const minLag = Math.floor(targetRate / 300); // 53
      const maxLag = Math.floor(targetRate / 75);  // 213
      let bestCorr = 0;
      let bestLag = -1;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0, nA = 0, nB = 0;
        for (let k = 0; k < 640 - lag; k++) {
          const a = rawPcm[i + k];
          const b = rawPcm[i + k + lag];
          sum += a * b;
          nA += a * a;
          nB += b * b;
        }
        const corr = sum / Math.sqrt((nA * nB) || 1);
        if (corr > bestCorr) {
          bestCorr = corr;
          bestLag = lag;
        }
      }
      if (bestCorr > 0.70 && bestLag > 0) {
        pitches.push(targetRate / bestLag);
      }
    }
  }

  if (voicedSamples.length < 4000 || pitches.length < 3) {
    throw new Error('Voice too quiet or brief. Please speak clearly into the microphone.');
  }

  // Peak normalize active speech to [-1, 1]
  const pcm16k = new Float32Array(voicedSamples);
  let maxAbs = 0;
  for (let i = 0; i < pcm16k.length; i++) {
    if (Math.abs(pcm16k[i]) > maxAbs) maxAbs = Math.abs(pcm16k[i]);
  }
  if (maxAbs > 0) {
    for (let i = 0; i < pcm16k.length; i++) pcm16k[i] /= maxAbs;
  }

  pitches.sort((a, b) => a - b);
  const medianF0 = pitches[Math.floor(pitches.length / 2)];

  return { pcm16k, f0: medianF0 };
}

// Runs Microsoft WavLM-Base-Plus-SV to extract L2-normalized 512-D X-Vector
async function extractWavLMProfile(blob: Blob, onStatus?: (msg: string) => void): Promise<WavLMProfile> {
  const { pcm16k, f0 } = await processAudioBlobTo16kHz(blob);
  const { processor, model } = await getWavLMEngine(onStatus);

  if (onStatus) onStatus('🧠 Computing 512-D Neural X-Vector Speaker Embedding...');
  const inputs = await processor(pcm16k);
  const output = await model(inputs);

  const rawVec = Array.from(output.embeddings.data as Float32Array);
  const norm = Math.sqrt(rawVec.reduce((acc, v) => acc + v * v, 0)) || 1;
  const l2Normalized = rawVec.map(v => v / norm);

  return { embedding: l2Normalized, f0 };
}

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState({ type: '', message: '' });
  const [activeTab, setActiveTab] = useState<'passkey' | 'voice' | 'recovery'>('passkey');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(false);

  // User Details & Neural Voiceprint State
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [enrolledVoiceprint, setEnrolledVoiceprint] = useState<WavLMProfile | null>(null);

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

  // --- REGISTRATION: WAVLM 512-D X-VECTOR ENROLLMENT ---
  const recordBaselineVoiceprint = async () => {
    try {
      setIsProcessing(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        try {
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
          const profile = await extractWavLMProfile(blob, (msg) => setStatus({ type: 'info', message: msg }));
          setEnrolledVoiceprint(profile);
          setStatus({
            type: 'success',
            message: `🎙️ 512-D WavLM Neural Voiceprint Locked! (Pitch: ${profile.f0.toFixed(1)} Hz)`,
          });
        } catch (err: any) {
          setStatus({ type: 'error', message: err.message });
        }
        setIsProcessing(false);
      };

      setStatus({
        type: 'info',
        message: '🎤 Recording for 4 seconds... Speak a full sentence continuously (e.g., "My voice is my secure passport").',
      });
      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 4000);
    } catch (err: any) {
      setStatus({ type: 'error', message: 'Microphone permission denied.' });
      setIsProcessing(false);
    }
  };

  // --- PASSKEY FLOWS ---
  const handleRegister = async () => {
    if (!username || !fullName || !email) return setStatus({ type: 'error', message: 'All text fields are required.' });
    if (!enrolledVoiceprint) return setStatus({ type: 'error', message: 'You must record your neural voiceprint first.' });

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
      if (verifyJSON.verified) onSuccessRedirect(username, '✅ Passkey & 512-D WavLM Voiceprint secured!');
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

  // --- IVR LOGIN FLOW: MICROSOFT WAVLM-BASE-PLUS-SV VERIFICATION ---
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
      setStatus({ type: 'info', message: 'Speak the cipher phrase clearly.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
    setIsProcessing(false);
  };

  const listenAndVerify = async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return setStatus({ type: 'error', message: 'Use Chrome for Speech API.' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      let recognizedTranscript = '';

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (!recognizedTranscript) return;

        try {
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
          const liveProfile = await extractWavLMProfile(blob, (msg) => setStatus({ type: 'info', message: msg }));

          setStatus({
            type: 'info',
            message: `Heard "${recognizedTranscript}" (${liveProfile.f0.toFixed(1)} Hz). Verifying 512-D X-Vector...`,
          });

          const resp = await fetch('/api/ivr/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, transcript: recognizedTranscript, voiceprint: liveProfile }),
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

      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
        mediaRecorder.start();
        setStatus({ type: 'info', message: '🎤 Listening... Speak the cipher phrase now.' });
      };

      recognition.onresult = (event: any) => {
        setIsListening(false);
        recognizedTranscript = event.results[0][0].transcript;
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
        stream.getTracks().forEach(t => t.stop());
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
    setStatus({ type: 'info', message: "Executing Shamir's Secret Sharing..." });
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
                      ? `✅ 512-D WavLM Embedded (${enrolledVoiceprint.f0.toFixed(1)} Hz)` 
                      : '🎙️ Record Neural Voiceprint (Required)'}
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