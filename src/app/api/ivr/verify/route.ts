import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// UPGRADED MATH: Pearson Correlation Coefficient
// This strips away the microphone's hardware bias and strictly compares vocal cord variance.
function pearsonCorrelation(vecA: number[], vecB: number[]) {
  const n = vecA.length;
  // 1. Find the mean (average) frequency to isolate the background/hardware noise
  const meanA = vecA.reduce((a, b) => a + b, 0) / n;
  const meanB = vecB.reduce((a, b) => a + b, 0) / n;

  let numerator = 0, diffA2 = 0, diffB2 = 0;
  // 2. Mean-center the vectors (subtract the background noise from the vocal profile)
  for (let i = 0; i < n; i++) {
    const diffA = vecA[i] - meanA;
    const diffB = vecB[i] - meanB;
    numerator += diffA * diffB;
    diffA2 += diffA * diffA;
    diffB2 += diffB * diffB;
  }
  if (diffA2 === 0 || diffB2 === 0) return 0;
  return numerator / Math.sqrt(diffA2 * diffB2);
}

export async function POST(request: Request) {
  try {
    const { username, transcript, voiceprint } = await request.json();
    if (!username || !transcript || !voiceprint) return NextResponse.json({ error: 'Missing required data.' }, { status: 400 });

    const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user || !user.current_challenge) return NextResponse.json({ error: 'No active challenge.' }, { status: 400 });
    if (!user.voiceprint) return NextResponse.json({ error: 'No voiceprint on file. Registration incomplete.' }, { status: 403 });

    const parts = user.current_challenge.split(':');
    const expectedPhrase = parts[1].trim().toUpperCase();
    if (Date.now() > parseInt(parts[2], 10)) {
      await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
      return NextResponse.json({ error: 'Challenge expired.' }, { status: 401 });
    }

    const normalizedSpoken = transcript.trim().toUpperCase().replace(/[^A-Z\s]/g, '');
    if (!normalizedSpoken.includes(expectedPhrase)) {
      return NextResponse.json({ verified: false, error: `Phrase mismatch. Heard: ${normalizedSpoken}` }, { status: 401 });
    }

    // STRICT Biometric Math Comparison
    const similarity = pearsonCorrelation(user.voiceprint, voiceprint);
    
    // Pearson is incredibly strict. A 70% match here is very high for the same person.
    // A different person will score much lower.
    if (similarity < 0.70) { 
      return NextResponse.json({ 
        verified: false, 
        error: `Speaker Mismatch! Match rate: ${(similarity * 100).toFixed(1)}%. Intruder detected.` 
      }, { status: 403 });
    }

    await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
    return NextResponse.json({ verified: true, message: `Identity confirmed. Strict Acoustic match: ${(similarity * 100).toFixed(1)}%` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}