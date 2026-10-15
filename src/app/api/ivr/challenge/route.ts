import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Word pools for randomized challenge-response pairs
const ADJECTIVES = ['BLUE', 'GOLDEN', 'SILVER', 'RAPID', 'BRIGHT', 'SHADOW', 'IRON', 'SOLAR'];
const NOUNS = ['TIGER', 'FALCON', 'RIVER', 'SHIELD', 'MOUNTAIN', 'BEACON', 'VALLEY', 'HARBOR'];

export async function POST(request: Request) {
  try {
    const { username } = await request.json();
    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    // 1. Ensure user exists or create record
    let { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user) {
      const { data: newUser, error } = await supabase.from('users').insert({ username }).select().single();
      if (error) throw new Error('User creation failed');
      user = newUser;
    }

    // 2. Pick random words for anti-replay acoustic challenge
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const challengePhrase = `${adj} ${noun}`;

    // 3. Set a 60-second expiration window
    const expiresAt = Date.now() + 60 * 1000;
    const challengePayload = `VOICE:${challengePhrase}:${expiresAt}`;

    // 4. Persist ephemeral challenge state
    await supabase.from('users').update({ current_challenge: challengePayload }).eq('id', user.id);

    return NextResponse.json({
      success: true,
      challengePhrase,
      expiresInSeconds: 60,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}