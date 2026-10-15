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

// Z-score normalized Euclidean distance on formant differential envelope
function zScoreDistance(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 999;
  const meanA = vecA.reduce((s, x) => s + x, 0) / vecA.length;
  const meanB = vecB.reduce((s, x) => s + x, 0) / vecB.length;
  const stdA = Math.sqrt(vecA.reduce((s, x) => s + Math.pow(x - meanA, 2), 0) / vecA.length) || 1;
  const stdB = Math.sqrt(vecB.reduce((s, x) => s + Math.pow(x - meanB, 2), 0) / vecB.length) || 1;
  let sumSq = 0;
  for (let i = 0; i < vecA.length; i++) {
    sumSq += Math.pow((vecA[i] - meanA) / stdA - (vecB[i] - meanB) / stdB, 2);
  }
  return Math.sqrt(sumSq / vecA.length);
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
    // 3. 12-POINT BIOMETRIC ENSEMBLE EVALUATION (REQUIRES >= 7 OUT OF 12 TO PASS)
    // =========================================================================

    const pitchDiffHz = Math.abs(enrolled.f0 - incoming.f0);
    const maxPitchAllowed = Math.max(16.0, enrolled.f0 * 0.15);
    const pitchRatio = incoming.f0 / enrolled.f0;

    const isLouder = incoming.f0 >= enrolled.f0;
    const maxCentroidAllowed = isLouder ? 280.0 : 200.0;
    const centroidDiffHz = Math.abs(enrolled.centroid - incoming.centroid);

    const fullCorr = formantCorrelation(enrolled.formantDiffs, incoming.formantDiffs);
    const lowCorr = formantCorrelation(enrolled.formantDiffs.slice(0, 7), incoming.formantDiffs.slice(0, 7));
    const midHighCorr = formantCorrelation(enrolled.formantDiffs.slice(6), incoming.formantDiffs.slice(6));
    const zDist = zScoreDistance(enrolled.formantDiffs, incoming.formantDiffs);

    // Formant peak alignment: verify local resonance maxima coincide
    let peakMatches = 0, totalPeaks = 0;
    for (let i = 1; i < enrolled.formantDiffs.length - 1; i++) {
      const isEnrolledPeak = enrolled.formantDiffs[i] > enrolled.formantDiffs[i-1] && enrolled.formantDiffs[i] > enrolled.formantDiffs[i+1];
      if (isEnrolledPeak) {
        totalPeaks++;
        const isIncomingPeak = incoming.formantDiffs[i] > incoming.formantDiffs[i-1] && incoming.formantDiffs[i] > incoming.formantDiffs[i+1];
        if (isIncomingPeak) peakMatches++;
      }
    }
    const peakMatchRatio = totalPeaks > 0 ? peakMatches / totalPeaks : 0;

    // Multi-factor composite confidence
    const pitchScore = Math.max(0, 1 - pitchDiffHz / maxPitchAllowed);
    const centroidScore = Math.max(0, 1 - centroidDiffHz / maxCentroidAllowed);
    const shapeScore = Math.max(0, fullCorr);
    const compositeScore = (shapeScore * 0.60 + pitchScore * 0.25 + centroidScore * 0.15) * 100;

    // The 12 Biometric Test Cases
    const biometricTests = [
      { id: 1, name: 'Fundamental Pitch Window Lock (<= 16 Hz / 15%)', passed: pitchDiffHz <= maxPitchAllowed },
      { id: 2, name: 'Vocal Register Consistency (<= 12%)', passed: Math.abs(pitchRatio - 1) <= 0.12 },
      { id: 3, name: 'Spectral Centroid Timbre Lock', passed: centroidDiffHz <= maxCentroidAllowed },
      { id: 4, name: 'Resonance Center Proximity (<= 120 Hz)', passed: centroidDiffHz <= 120.0 },
      { id: 5, name: 'Primary Anatomical Formant Match (>= 68%)', passed: fullCorr >= 0.68 },
      { id: 6, name: 'High-Confidence Formant Match (>= 75%)', passed: fullCorr >= 0.75 },
      { id: 7, name: 'Vocal Tract Ultra-Fidelity Match (>= 82%)', passed: fullCorr >= 0.82 },
      { id: 8, name: 'Low-Band Oral Formant Resonance (>= 75%)', passed: lowCorr >= 0.75 },
      { id: 9, name: 'Upper-Band Pharyngeal Resonance (>= 70%)', passed: midHighCorr >= 0.70 },
      { id: 10, name: 'Normalized Formant Shape Distance (<= 0.65)', passed: zDist <= 0.65 },
      { id: 11, name: 'Formant Resonance Peak Alignment (>= 75%)', passed: peakMatchRatio >= 0.75 },
      { id: 12, name: 'Composite Biometric Confidence (>= 68%)', passed: compositeScore >= 68.0 }
    ];

    const passedCount = biometricTests.filter(t => t.passed).length;
    const REQUIRED_PASSES = 7;

    if (passedCount < REQUIRED_PASSES) {
      const failedNames = biometricTests.filter(t => !t.passed).map(t => t.name).slice(0, 3).join(', ');
      return NextResponse.json({
        verified: false,
        passedCount,
        totalTests: 12,
        error: `Intruder Blocked! Passed ${passedCount}/12 biometric criteria (Minimum ${REQUIRED_PASSES} required). Failed: ${failedNames}...`,
        tests: biometricTests
      }, { status: 403 });
    }

    await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
    return NextResponse.json({
      verified: true,
      passedCount,
      totalTests: 12,
      message: `Identity Confirmed! Passed ${passedCount}/12 Biometric Tests | Confidence: ${compositeScore.toFixed(1)}% | Formant Match: ${(fullCorr * 100).toFixed(1)}%`,
      tests: biometricTests
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}