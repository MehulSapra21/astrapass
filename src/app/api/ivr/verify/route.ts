import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface WavLMProfile {
  embedding: number[]; // 512-D L2-normalized X-Vector from Microsoft WavLM-Base-Plus-SV
  f0: number;          // Median vocal cord pitch in Hz
}

// Cosine Similarity between two 512-dimensional WavLM X-Vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
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

    const enrolled = user.voiceprint as WavLMProfile;
    if (!enrolled || !Array.isArray(enrolled.embedding) || enrolled.embedding.length !== 512) {
      return NextResponse.json({
        error: 'Account does not have a 512-D WavLM neural profile. Please register a new account.',
      }, { status: 403 });
    }

    const incoming = voiceprint as WavLMProfile;

    // 1. Verify Challenge Expiration
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
        error: `Phrase mismatch. Expected "${expectedPhrase}", heard "${normalizedSpoken}"`,
      }, { status: 401 });
    }

    // 3. Gate A: Vocal Cord Fundamental Frequency (F0) Gender/Pitch Guard
    const pitchDiffHz = Math.abs(enrolled.f0 - incoming.f0);
    if (pitchDiffHz > 30.0) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked (Vocal Pitch Mismatch)! Owner: ${enrolled.f0.toFixed(1)} Hz vs Speaker: ${incoming.f0.toFixed(1)} Hz (Δ ${pitchDiffHz.toFixed(1)} Hz).`,
      }, { status: 403 });
    }

    // 4. Gate B: Microsoft WavLM-Base-Plus-SV 512-D X-Vector Neural Similarity
    // Official VoxCeleb verification threshold is ~0.86
    const neuralSimilarity = cosineSimilarity(enrolled.embedding, incoming.embedding);
    const SIMILARITY_THRESHOLD = 0.86;

    if (neuralSimilarity < SIMILARITY_THRESHOLD) {
      return NextResponse.json({
        verified: false,
        error: `Intruder Blocked by WavLM Neural Net! X-Vector similarity: ${(neuralSimilarity * 100).toFixed(1)}% (Requires >= ${(SIMILARITY_THRESHOLD * 100).toFixed(0)}%).`,
      }, { status: 403 });
    }

    await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
    return NextResponse.json({
      verified: true,
      message: `WavLM Neural Match Confirmed: ${(neuralSimilarity * 100).toFixed(1)}% | Pitch: ${incoming.f0.toFixed(1)} Hz`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}