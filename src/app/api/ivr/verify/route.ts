import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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

    const similarity = cosineSimilarity(user.voiceprint, voiceprint);
    if (similarity < 0.85) { 
      return NextResponse.json({ verified: false, error: `Speaker Mismatch! Match rate: ${(similarity*100).toFixed(1)}%. Intruder detected.` }, { status: 403 });
    }

    await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
    return NextResponse.json({ verified: true, message: `Identity confirmed. Acoustic match: ${(similarity*100).toFixed(1)}%` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}