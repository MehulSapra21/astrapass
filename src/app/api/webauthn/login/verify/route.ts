import { NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { supabase } from '@/lib/supabase';

const rpID = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_RP_ID || 'astrapass.vercel.app' : 'localhost';
const expectedOrigin = process.env.NODE_ENV === 'production' ? `https://${rpID}` : 'http://localhost:3000';

export async function POST(request: Request) {
  try {
    const { username, authenticationResponse } = await request.json();

    // 1. Get the user and their saved challenge
    const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user || !user.current_challenge) {
      return NextResponse.json({ error: 'User or challenge not found' }, { status: 400 });
    }

    // 2. Get the specific authenticator used for this login
    const { data: authenticator } = await supabase
      .from('authenticators')
      .select('*')
      .eq('credential_id', authenticationResponse.id)
      .eq('user_id', user.id)
      .single();

    if (!authenticator) {
      return NextResponse.json({ error: 'Authenticator not found' }, { status: 400 });
    }

    // 3. Cryptographically verify the authenticator's response
    const verification = await verifyAuthenticationResponse({
      response: authenticationResponse,
      expectedChallenge: user.current_challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: authenticator.credential_id,
        publicKey: new Uint8Array(Buffer.from(authenticator.public_key, 'base64')),
        counter: authenticator.counter,
        transports: authenticator.transports,
      },
    });

    if (verification.verified && verification.authenticationInfo) {
      const { newCounter } = verification.authenticationInfo;

      // 4. Update the authenticator's internal counter (prevents replay attacks)
      await supabase.from('authenticators').update({ counter: newCounter }).eq('credential_id', authenticator.credential_id);

      // Clear the challenge
      await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);

      return NextResponse.json({ verified: true });
    }

    return NextResponse.json({ verified: false }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}