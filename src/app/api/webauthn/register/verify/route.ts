import { NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { supabase } from '@/lib/supabase';

const rpID = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_RP_ID || 'astrapass.vercel.app' : 'localhost';
const expectedOrigin = process.env.NODE_ENV === 'production' ? `https://${rpID}` : 'http://localhost:3000';

export async function POST(request: Request) {
  try {
    const { username, registrationResponse } = await request.json();

    // 1. Get the user and their saved challenge
    const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user || !user.current_challenge) {
      return NextResponse.json({ error: 'User or challenge not found' }, { status: 400 });
    }

    // 2. Cryptographically verify the authenticator's response
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: user.current_challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (verification.verified && verification.registrationInfo) {
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      
      // 3. Save the new passkey to the database
      await supabase.from('authenticators').insert({
        credential_id: credential.id,
        user_id: user.id,
        public_key: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        transports: credential.transports,
      });

      // Clear the challenge after successful registration
      await supabase.from('users').update({ current_challenge: null }).eq('id', user.id);

      return NextResponse.json({ verified: true });
    }

    return NextResponse.json({ verified: false }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}