import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface BiometricProfile {
  f0: number;           // Exact vocal cord fundamental frequency in Hz
  centroid: number;     // Vocal tract resonant center of mass in Hz
  formantDiffs: number[]; // Slope-removed vocal tract throat resonances
}

// Cosine similarity on slope-removed formant differentials
function formantSimilarity(vecA: number[], vecB: number[]) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function POST(request: Request) {
  try {
    const { username, transcript, voiceprint } = await request.json();
    if (!username || !transcript || !voiceprint) {
      return NextResponse.json({ error: 'Missing required biometric data.' }, { status: 400 });
    }

    const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user || !user.current_challenge) {
      return NextResponse.json({ error: 'No active challenge. Generate a cipher first.' }, { status: 400 });
    }

    const enrolled = user.voiceprint as BiometricProfile;
    if (!enrolled || typeof enrolled.f0 !== 'number') {
      return NextResponse.json({ 
        error: 'Legacy account detected. Please register a new account to enroll Hz-level biometrics.' 
      }, { status: 403 });
    }

    const incoming = voiceprint as BiometricProfile;

    // 1. Check Challenge Expiration
    const parts = user.current_challenge.split(':');
    const expectedPhrase = parts[1].trim().toUpperCase();
    if (Date.now() > parseInt(parts[2], 10)) {
      await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
      return NextResponse.json({ error: 'Challenge expired. Generate a new cipher.' }, { status: 401 });
    }

    // 2. Verify Spoken Words
    const normalizedSpoken = transcript.trim().toUpperCase().replace(/[^A-Z\s]/g, '');
    if (!normalizedSpoken.includes(expectedPhrase)) {
      return NextResponse.json({ 
        verified: false, 
        error: `Phrase mismatch. Expected "${expectedPhrase}", heard "${normalizedSpoken}"` 
      }, { status: 401 });
    }

    // =========================================================================
    // 3. STRICT 3-GATE BIOMETRIC VERIFICATION
    // =========================================================================

    // GATE 1: Fundamental Frequency (F0) Pitch Lock (1 Hz sensitivity)
    const pitchDiffHz = Math.abs(enrolled.f0 - incoming.f0);
    const MAX_ALLOWED_HZ_DIFF = 10.0; // Strict 10 Hz window

    if (pitchDiffHz > MAX_ALLOWED_HZ_DIFF) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Pitch Mismatch)! Owner: ${enrolled.f0.toFixed(1)} Hz | Speaker: ${incoming.f0.toFixed(1)} Hz (Δ ${pitchDiffHz.toFixed(1)} Hz > ${MAX_ALLOWED_HZ_DIFF} Hz limit).`,
      }, { status: 403 });
    }

    // GATE 2: Vocal Tract Spectral Centroid Lock (Timbre Brightness in Hz)
    const centroidDiffHz = Math.abs(enrolled.centroid - incoming.centroid);
    const MAX_CENTROID_DIFF = 130.0; // Strict vocal resonance center window

    if (centroidDiffHz > MAX_CENTROID_DIFF) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Vocal Tract Timbre Mismatch)! Owner Resonance: ${enrolled.centroid.toFixed(0)} Hz | Speaker: ${incoming.centroid.toFixed(0)} Hz (Δ ${centroidDiffHz.toFixed(0)} Hz).`,
      }, { status: 403 });
    }

    // GATE 3: Slope-Removed Formant Shape Match
    const shapeSim = formantSimilarity(enrolled.formantDiffs, incoming.formantDiffs);
    if (shapeSim < 0.78) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Throat Formant Mismatch)! Formant structure similarity: ${(shapeSim * 100).toFixed(1)}% (Minimum 78% required).`,
      }, { status: 403 });
    }

    // Compute composite confidence score for display
    const pitchScore = Math.max(0, 1 - pitchDiffHz / 30);
    const compositeMatch = ((pitchScore * 0.5 + shapeSim * 0.5) * 100).toFixed(1);

    await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
    return NextResponse.json({ 
      verified: true, 
      message: `Identity Confirmed! Pitch: ${incoming.f0.toFixed(1)} Hz (Δ ${pitchDiffHz.toFixed(1)} Hz) | Biometric Match: ${compositeMatch}%` 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}