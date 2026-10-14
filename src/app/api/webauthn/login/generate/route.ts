import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { supabase } from '@/lib/supabase';

const rpID = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_RP_ID || 'astrapass.vercel.app' : 'localhost';

export async function POST(request: Request) {
  try {
    const { username } = await request.json();
    if (!username) return NextResponse.json({ error: 'Username required' }, { status: 400 });

    // 1. Find the user
    const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 2. Get the user's registered authenticators
    const { data: userAuthenticators } = await supabase.from('authenticators').select('*').eq('user_id', user.id);

    if (!userAuthenticators || userAuthenticators.length === 0) {
      return NextResponse.json({ error: 'No passkeys registered for this user' }, { status: 400 });
    }

    // 3. Generate authentication options
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: userAuthenticators.map((auth) => ({
        id: auth.credential_id,
        type: 'public-key',
        transports: auth.transports,
      })),
      userVerification: 'preferred',
    });

    // 4. Save the challenge for verification
    await supabase.from('users').update({ current_challenge: options.challenge }).eq('id', user.id);

    return NextResponse.json(options);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}