import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface BiometricProfile {
  f0: number;           // Exact vocal cord fundamental frequency in Hz
  centroid: number;     // Vocal tract resonant center of mass in Hz
  formantDiffs: number[]; // Slope-removed vocal tract throat resonances
}

// Pearson correlation coefficient on slope-removed formant differentials.
// Zero-centering removes shared baseline spectral roll-off and mic gain/distance tilt,
// isolating individual speaker-specific anatomical vocal tract resonances.
function formantCorrelation(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < vecA.length; i++) {
    sumA += vecA[i];
    sumB += vecB[i];
  }
  const meanA = sumA / vecA.length;
  const meanB = sumB / vecB.length;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const da = vecA[i] - meanA;
    const db = vecB[i] - meanB;
    dot += da * db;
    normA += da * da;
    normB += db * db;
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
    // 3. STRICT 4-GATE BIOMETRIC VERIFICATION (INTRUDER-PROOF & SORE/LOUD RESILIENT)
    // =========================================================================

    // GATE 1: Fundamental Frequency (F0) Pitch Lock
    // Allows natural vocal effort (louder speech) or hoarseness (sore throat) pitch shifts (~15% of baseline),
    // but strictly blocks foreign speakers with distinct vocal cord anatomy.
    const pitchDiffHz = Math.abs(enrolled.f0 - incoming.f0);
    const MAX_ALLOWED_HZ_DIFF = Math.max(16.0, Math.min(22.0, enrolled.f0 * 0.15));

    if (pitchDiffHz > MAX_ALLOWED_HZ_DIFF) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Pitch Mismatch)! Owner: ${enrolled.f0.toFixed(1)} Hz | Speaker: ${incoming.f0.toFixed(1)} Hz (Δ ${pitchDiffHz.toFixed(1)} Hz > ${MAX_ALLOWED_HZ_DIFF.toFixed(1)} Hz limit).`,
      }, { status: 403 });
    }

    // GATE 2: Vocal Tract Spectral Centroid Lock (Timbre & Resonance Center)
    // Speaking louder naturally boosts higher harmonics, raising centroid upwards (+80 to +260 Hz).
    // A sore throat dampens high-frequency harmonic energy, shifting centroid downwards.
    const centroidDiffHz = Math.abs(enrolled.centroid - incoming.centroid);
    const isLouder = incoming.f0 >= enrolled.f0;
    const MAX_CENTROID_DIFF = isLouder ? 280.0 : 220.0;

    if (centroidDiffHz > MAX_CENTROID_DIFF) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Vocal Tract Timbre Mismatch)! Owner Resonance: ${enrolled.centroid.toFixed(0)} Hz | Speaker: ${incoming.centroid.toFixed(0)} Hz (Δ ${centroidDiffHz.toFixed(0)} Hz > ${MAX_CENTROID_DIFF.toFixed(0)} Hz limit).`,
      }, { status: 403 });
    }

    // GATE 3: Vocal Tract Anatomical Resonance Lock (Pearson Correlation)
    // Vocal tract length, oral cavity geometry, and throat dimensions are unique anatomical invariants
    // that remain consistent whether speaking louder or with a mild sore throat.
    const shapeCorr = formantCorrelation(enrolled.formantDiffs, incoming.formantDiffs);
    const MIN_FORMANT_CORR = 0.70;

    if (shapeCorr < MIN_FORMANT_CORR) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Throat Formant Mismatch)! Vocal tract resonance match: ${(shapeCorr * 100).toFixed(1)}% (Minimum ${(MIN_FORMANT_CORR * 100).toFixed(0)}% required).`,
      }, { status: 403 });
    }

    // GATE 4: Multi-Factor Composite Biometric Confidence Lock
    // Combines anatomical throat formants (60%), pitch proximity (25%), and resonance timbre (15%).
    const pitchScore = Math.max(0, 1 - pitchDiffHz / MAX_ALLOWED_HZ_DIFF);
    const centroidScore = Math.max(0, 1 - centroidDiffHz / MAX_CENTROID_DIFF);
    const shapeScore = Math.max(0, shapeCorr);

    const compositeScore = (shapeScore * 0.60 + pitchScore * 0.25 + centroidScore * 0.15) * 100;
    const MIN_COMPOSITE = shapeCorr >= 0.80 ? 60.0 : 68.0;

    if (compositeScore < MIN_COMPOSITE) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Biometric Confidence Low)! Composite biometric confidence: ${compositeScore.toFixed(1)}% (Minimum ${MIN_COMPOSITE.toFixed(0)}% required).`,
      }, { status: 403 });
    }

    await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
    return NextResponse.json({
      verified: true,
      message: `Identity Confirmed! Pitch: ${incoming.f0.toFixed(1)} Hz (Δ ${pitchDiffHz.toFixed(1)} Hz) | Biometric Match: ${compositeScore.toFixed(1)}%`
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}