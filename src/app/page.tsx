'use client';

import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

export default function Home() {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const [activeTab, setActiveTab] = useState<'passkey' | 'voice' | 'recovery'>('passkey');

  // --- VOICE STATE ---
  const [voiceChallenge, setVoiceChallenge] = useState('');
  const [isListening, setIsListening] = useState(false);

  // --- RECOVERY STATE ---
  const [guardians] = useState(['Alice', 'Bob', 'Charlie']);
  const [demoMasterKey, setDemoMasterKey] = useState('');
  const [recoveryInput1, setRecoveryInput1] = useState('');
  const [recoveryInput2, setRecoveryInput2] = useState('');
  const [recoveredKey, setRecoveredKey] = useState('');

  // --- 1. PASSKEY FLOWS ---
  const handleRegister = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    setStatus({ type: 'info', message: 'Generating passkey...' });
    try {
      const resp = await fetch('/api/webauthn/register/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const optionsJSON = await resp.json();
      if (optionsJSON.error) throw new Error(`Server: ${optionsJSON.error}`);

      const attResp = await startRegistration({ optionsJSON });

      const verifyResp = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, registrationResponse: attResp }),
      });
      const verifyJSON = await verifyResp.json();

      if (verifyJSON.error) throw new Error(verifyJSON.error);
      if (verifyJSON.verified) setStatus({ type: 'success', message: '✅ Passkey registered successfully!' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  const handleLogin = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    setStatus({ type: 'info', message: 'Waiting for passkey...' });
    try {
      const resp = await fetch('/api/webauthn/login/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const optionsJSON = await resp.json();
      if (optionsJSON.error) throw new Error(`Server: ${optionsJSON.error}`);

      const asseResp = await startAuthentication({ optionsJSON });

      const verifyResp = await fetch('/api/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, authenticationResponse: asseResp }),
      });
      const verifyJSON = await verifyResp.json();

      if (verifyJSON.error) throw new Error(verifyJSON.error);
      if (verifyJSON.verified) setStatus({ type: 'success', message: '🔓 Logged in securely with Passkey.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  // --- 2. VOICE FLOWS ---
  const requestVoiceChallenge = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    setStatus({ type: 'info', message: 'Generating acoustic challenge...' });
    try {
      const resp = await fetch('/api/ivr/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setVoiceChallenge(data.challengePhrase);
      setStatus({ type: 'info', message: 'Audio challenge generated. Speak the phrase below.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  const listenAndVerify = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return setStatus({ type: 'error', message: 'Speech API not supported.' });

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setStatus({ type: 'info', message: '🎤 Listening... Please speak the phrase.' });
    };

    recognition.onresult = async (event: any) => {
      setIsListening(false);
      const transcript = event.results[0][0].transcript;
      setStatus({ type: 'info', message: `Heard: "${transcript}". Verifying...` });

      try {
        const resp = await fetch('/api/ivr/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, transcript }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        if (data.verified) {
          setStatus({ type: 'success', message: '🎙️ Voice verified! Logged in successfully.' });
          setVoiceChallenge('');
        }
      } catch (error: any) {
        setStatus({ type: 'error', message: error.message });
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      setStatus({ type: 'error', message: `Microphone error: ${event.error}` });
    };

    recognition.start();
  };

  // --- 3. RECOVERY FLOWS ---
  const setupRecovery = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    setStatus({ type: 'info', message: 'Splitting master key...' });
    try {
      const resp = await fetch('/api/recovery/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, guardians }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      
      setDemoMasterKey(data.demo_master_key);
      setStatus({ type: 'success', message: 'Recovery network established!' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  const reconstructKey = async () => {
    if (!username) return setStatus({ type: 'error', message: 'Enter a username.' });
    if (!recoveryInput1 || !recoveryInput2) return setStatus({ type: 'error', message: 'Provide 2 shares.' });
    
    setStatus({ type: 'info', message: 'Reconstructing key...' });
    try {
      const resp = await fetch('/api/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          submittedShares: [recoveryInput1, recoveryInput2] 
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      
      setRecoveredKey(data.recoveredKey);
      setStatus({ type: 'success', message: '✅ Threshold met! Master Key Recovered.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center py-12 px-6 bg-slate-900 overflow-y-auto">
      <div className="w-full max-w-xl p-8 bg-slate-800 rounded-2xl shadow-xl border border-slate-700">
        <h1 className="text-3xl font-bold mb-2 text-center text-white">AstraPass</h1>
        <p className="text-slate-400 text-center mb-6 text-sm">Next-Generation Passwordless Authentication</p>

        {/* TABS */}
        <div className="flex bg-slate-900 rounded-lg p-1 mb-6">
          <button onClick={() => { setActiveTab('passkey'); setStatus({type: '', message: ''}); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === 'passkey' ? 'bg-slate-700 text-white shadow' : 'text-slate-400'}`}>
            FIDO2 Hardware
          </button>
          <button onClick={() => { setActiveTab('voice'); setStatus({type: '', message: ''}); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === 'voice' ? 'bg-slate-700 text-white shadow' : 'text-slate-400'}`}>
            Basic Phone
          </button>
          <button onClick={() => { setActiveTab('recovery'); setStatus({type: '', message: ''}); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === 'recovery' ? 'bg-slate-700 text-white shadow' : 'text-slate-400'}`}>
            Social Recovery
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Target Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="e.g. mehul_sapra" />
          </div>

          {/* PASSKEY TAB */}
          {activeTab === 'passkey' && (
            <div className="flex gap-4 mt-6">
              <button onClick={handleRegister} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg">Register Passkey</button>
              <button onClick={handleLogin} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-lg">Login</button>
            </div>
          )}

          {/* VOICE TAB */}
          {activeTab === 'voice' && (
            <div className="mt-6 flex flex-col gap-4">
              {!voiceChallenge ? (
                <button onClick={requestVoiceChallenge} className="w-full bg-purple-600 text-white font-semibold py-3 px-4 rounded-lg">Trigger IVR Call</button>
              ) : (
                <div className="bg-slate-900 border border-purple-500/50 p-4 rounded-lg text-center">
                  <p className="text-2xl font-bold tracking-widest text-purple-400 mb-4">{voiceChallenge}</p>
                  <button type="button" onClick={listenAndVerify} disabled={isListening}
                    className={`w-full font-semibold py-3 px-4 rounded-lg text-white transition-all ${isListening ? 'bg-red-600 animate-pulse' : 'bg-emerald-600'}`}>
                    {isListening ? '🎙️ Listening... Speak Now' : 'Click to Speak'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* RECOVERY TAB */}
          {activeTab === 'recovery' && (
            <div className="mt-6 flex flex-col gap-6">
              {/* Setup Section */}
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                <h3 className="text-white font-semibold mb-2">1. Split Key (3 Guardians)</h3>
                <button onClick={setupRecovery} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg mb-4">Generate & Split Key</button>
                
                {demoMasterKey && (
                  <div className="text-xs font-mono break-all bg-black p-3 rounded text-green-400 mb-2 border border-green-900">
                    Original Master: {demoMasterKey}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-2">Check your Supabase database `recovery_shares` table to see the 3 split shares assigned to Alice, Bob, and Charlie!</p>
              </div>

              {/* Reconstruct Section */}
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                <h3 className="text-white font-semibold mb-2">2. Reconstruct (Need 2 of 3)</h3>
                <p className="text-xs text-slate-400 mb-4">Paste any 2 share strings from your database here.</p>
                
                <input 
                  type="text" 
                  value={recoveryInput1} 
                  onChange={(e) => setRecoveryInput1(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-xs font-mono mb-2 focus:outline-none focus:border-blue-500" 
                  placeholder="Paste Guardian 1 share here..." 
                />
                
                <input 
                  type="text" 
                  value={recoveryInput2} 
                  onChange={(e) => setRecoveryInput2(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-xs font-mono mb-4 focus:outline-none focus:border-blue-500" 
                  placeholder="Paste Guardian 2 share here..." 
                />
                
                <button onClick={reconstructKey} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-lg">
                  Reconstruct Master Key
                </button>

                {recoveredKey && (
                  <div className="mt-4 text-xs font-mono break-all bg-black p-3 rounded text-emerald-400 border border-emerald-900">
                    Recovered Master: {recoveredKey}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STATUS ALERTS */}
          {status.message && (
            <div className={`mt-4 p-3 rounded-lg border text-sm text-center ${
                status.type === 'success' ? 'bg-emerald-900/50 border-emerald-500/50 text-emerald-200' :
                status.type === 'error' ? 'bg-red-900/50 border-red-500/50 text-red-200' :
                'bg-blue-900/50 border-blue-500/50 text-blue-200'
              }`}>
              {status.message}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}