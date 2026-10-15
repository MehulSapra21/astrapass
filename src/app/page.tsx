'use client';

import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

export default function Home() {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const [activeTab, setActiveTab] = useState<'passkey' | 'voice'>('passkey');

  // Voice Auth States
  const [voiceChallenge, setVoiceChallenge] = useState('');
  const [isListening, setIsListening] = useState(false);

  // --- 1. PASSKEY REGISTRATION ---
  const handleRegister = async () => {
    if (!username) {
      setStatus({ type: 'error', message: 'Please enter a username.' });
      return;
    }
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
      if (verifyJSON.verified) {
        setStatus({ type: 'success', message: '✅ Passkey registered successfully!' });
      } else {
        setStatus({ type: 'error', message: '❌ Registration failed verification.' });
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  // --- 2. PASSKEY LOGIN ---
  const handleLogin = async () => {
    if (!username) {
      setStatus({ type: 'error', message: 'Please enter a username.' });
      return;
    }
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
      if (verifyJSON.verified) {
        setStatus({ type: 'success', message: '🔓 Logged in securely with Passkey.' });
      } else {
        setStatus({ type: 'error', message: '❌ Login failed verification.' });
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  // --- 3. REQUEST VOICE CHALLENGE ---
  const requestVoiceChallenge = async () => {
    if (!username) {
      setStatus({ type: 'error', message: 'Please enter a username.' });
      return;
    }
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

  // --- 4. LISTEN AND VERIFY VOICE ---
  const listenAndVerify = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setStatus({
        type: 'error',
        message: 'Speech Recognition API is not supported in this browser. Please use Chrome.',
      });
      return;
    }

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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-900">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-2xl shadow-xl border border-slate-700">
        <h1 className="text-3xl font-bold mb-2 text-center text-white">AstraPass</h1>
        <p className="text-slate-400 text-center mb-6 text-sm">
          Next-Generation Passwordless Authentication
        </p>

        {/* TABS */}
        <div className="flex bg-slate-900 rounded-lg p-1 mb-6">
          <button
            onClick={() => {
              setActiveTab('passkey');
              setStatus({ type: '', message: '' });
            }}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
              activeTab === 'passkey'
                ? 'bg-slate-700 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            FIDO2 Hardware
          </button>
          <button
            onClick={() => {
              setActiveTab('voice');
              setStatus({ type: '', message: '' });
              setVoiceChallenge('');
            }}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
              activeTab === 'voice'
                ? 'bg-slate-700 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Basic Phone (Voice)
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="e.g. mehul_sapra"
            />
          </div>

          {/* PASSKEY TAB */}
          {activeTab === 'passkey' && (
            <div className="flex gap-4 mt-6">
              <button
                onClick={handleRegister}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                Register Passkey
              </button>
              <button
                onClick={handleLogin}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                Login
              </button>
            </div>
          )}

          {/* VOICE TAB */}
          {activeTab === 'voice' && (
            <div className="mt-6 flex flex-col gap-4">
              {!voiceChallenge ? (
                <button
                  onClick={requestVoiceChallenge}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                >
                  Trigger IVR Call (Generate Phrase)
                </button>
              ) : (
                <div className="bg-slate-900 border border-purple-500/50 p-4 rounded-lg text-center">
                  <p className="text-slate-400 text-sm mb-2">
                    Automated Voice: &quot;Please say the following phrase:&quot;
                  </p>
                  <p className="text-2xl font-bold tracking-widest text-purple-400 mb-4">
                    {voiceChallenge}
                  </p>
                  <button
                    type="button"
                    onClick={listenAndVerify} 
                    disabled={isListening}
                    className={`w-full font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-md ${
                      isListening
                        ? 'bg-red-600 text-white animate-pulse cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95'
                    }`}
                  >
                    {isListening ? '🎙️ Listening... Speak Now' : 'Click to Speak'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STATUS ALERTS */}
          {status.message && (
            <div
              className={`mt-6 p-4 rounded-lg border ${
                status.type === 'success'
                  ? 'bg-emerald-900/50 border-emerald-500/50 text-emerald-200'
                  : status.type === 'error'
                  ? 'bg-red-900/50 border-red-500/50 text-red-200'
                  : 'bg-blue-900/50 border-blue-500/50 text-blue-200'
              }`}
            >
              <p className="text-sm font-medium text-center">{status.message}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}