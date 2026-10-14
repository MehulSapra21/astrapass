'use client';

import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

export default function Home() {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });

  // 1. REGISTRATION FLOW
  const handleRegister = async () => {
    if (!username) {
      setStatus({ type: 'error', message: 'Please enter a username first.' });
      return;
    }
    setStatus({ type: 'info', message: 'Generating passkey...' });

    try {
      // Step A: Get the cryptographic challenge from our backend
      const resp = await fetch('/api/webauthn/register/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const optionsJSON = await resp.json();

      if (optionsJSON.error) throw new Error(optionsJSON.error);

      // Step B: Trigger the browser's native biometric prompt
      const attResp = await startRegistration({ optionsJSON });

      // Step C: Send the signature back to our backend for verification
      const verificationResp = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, registrationResponse: attResp }),
      });

      const verificationJSON = await verificationResp.json();
      
      // NEW: Catch the exact backend error message
      if (verificationJSON.error) {
        throw new Error(`Server Error: ${verificationJSON.error}`);
      }

      if (verificationJSON.verified) {
        setStatus({ type: 'success', message: '✅ Passkey registered successfully!' });
      } else {
        setStatus({ type: 'error', message: '❌ Registration failed verification.' });
      }
    } catch (error: any) {
      // If the user hits "Cancel" on the biometric prompt, it throws an error here
      setStatus({ type: 'error', message: error.message });
    }
  };

  // 2. LOGIN FLOW
  const handleLogin = async () => {
    if (!username) {
      setStatus({ type: 'error', message: 'Please enter a username first.' });
      return;
    }
    setStatus({ type: 'info', message: 'Waiting for passkey...' });

    try {
      // Step A: Get the login challenge from our backend
      const resp = await fetch('/api/webauthn/login/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const optionsJSON = await resp.json();

      if (optionsJSON.error) throw new Error(optionsJSON.error);

      // Step B: Trigger the biometric prompt to sign the challenge
      const asseResp = await startAuthentication({ optionsJSON });

      // Step C: Verify the login signature
      const verificationResp = await fetch('/api/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, authenticationResponse: asseResp }),
      });

      const verificationJSON = await verificationResp.json();
      
      if (verificationJSON.error) {
        throw new Error(`Server Error: ${verificationJSON.error}`);
      }
      
      if (verificationJSON.verified) {
        setStatus({ type: 'success', message: '🔓 Logged in successfully! Welcome back.' });
      } else {
        setStatus({ type: 'error', message: '❌ Login failed verification.' });
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-900">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-2xl shadow-xl border border-slate-700">
        <h1 className="text-3xl font-bold mb-2 text-center text-white">AstraPass</h1>
        <p className="text-slate-400 text-center mb-8 text-sm">FIDO2 Hardware Authentication</p>

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

          {status.message && (
            <div
              className={`mt-6 p-4 rounded-lg border ${
                status.type === 'success' ? 'bg-emerald-900/50 border-emerald-500/50 text-emerald-200' :
                status.type === 'error' ? 'bg-red-900/50 border-red-500/50 text-red-200' :
                'bg-blue-900/50 border-blue-500/50 text-blue-200'
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