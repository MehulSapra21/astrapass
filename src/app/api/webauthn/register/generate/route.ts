import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { supabase } from '@/lib/supabase';

// The Relying Party ID is your domain name. 'localhost' for development.
const rpID = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_RP_ID || 'astrapass.vercel.app' : 'localhost';
const rpName = 'AstraPass';

export async function POST(request: Request) {
  try {
    const { username } = await request.json();
    if (!username) return NextResponse.json({ error: 'Username required' }, { status: 400 });

    // 1. Check if user exists, otherwise create them
    let { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    
    if (!user) {
      const { data: newUser, error } = await supabase.from('users').insert({ username }).select().single();
      if (error) throw new Error('Failed to create user');
      user = newUser;
    }

    // 2. Get user's existing authenticators (to prevent registering the same device twice)
    const { data: userAuthenticators } = await supabase.from('authenticators').select('*').eq('user_id', user.id);

    // 3. Generate registration options (the challenge)
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.username,
      attestationType: 'none',
      excludeCredentials: userAuthenticators?.map((auth) => ({
        id: auth.credential_id,
        type: 'public-key',
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred', // Triggers biometric prompt
      },
    });

    // 4. Save the challenge in the database so we can verify it in the next step
    await supabase.from('users').update({ current_challenge: options.challenge }).eq('id', user.id);

    return NextResponse.json(options);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}