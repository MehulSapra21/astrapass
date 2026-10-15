import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { username, transcript } = await request.json();
    if (!username || !transcript) {
      return NextResponse.json({ error: 'Username and audio transcript are required' }, { status: 400 });
    }

    // 1. Fetch user and their stored voice challenge
    const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user || !user.current_challenge) {
      return NextResponse.json({ error: 'No active voice challenge found' }, { status: 400 });
    }

    // 2. Parse stored payload: VOICE:<PHRASE>:<TIMESTAMP>
    const parts = user.current_challenge.split(':');
    if (parts[0] !== 'VOICE' || parts.length < 3) {
      return NextResponse.json({ error: 'Invalid challenge state' }, { status: 400 });
    }

    const expectedPhrase = parts[1].trim().toUpperCase();
    const expiresAt = parseInt(parts[2], 10);

    // 3. Verify challenge time validity
    if (Date.now() > expiresAt) {
      await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);
      return NextResponse.json({ error: 'Challenge expired. Please request a new voice prompt.' }, { status: 401 });
    }

    // 4. Verify spoken transcript matches the expected phrase (case and whitespace normalized)
    const normalizedSpoken = transcript.trim().toUpperCase().replace(/[^A-Z\s]/g, '');

    if (!normalizedSpoken.includes(expectedPhrase)) {
      return NextResponse.json({
        verified: false,
        error: `Acoustic challenge mismatch. Expected "${expectedPhrase}", detected "${normalizedSpoken}"`,
      }, { status: 401 });
    }

    // 5. Invalidate the challenge to enforce single-use protection
    await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);

    return NextResponse.json({
      verified: true,
      message: 'Acoustic challenge verified successfully.',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}