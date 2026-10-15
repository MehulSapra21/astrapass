import { NextResponse } from 'next/server';
import secrets from 'secrets.js-grempe';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { username, submittedShares } = await request.json();
    
    // We need exactly 2 shares to hit our threshold
    if (!username || !submittedShares || submittedShares.length !== 2) {
      return NextResponse.json({ error: 'Exactly 2 valid shares are required for recovery.' }, { status: 400 });
    }

    // 1. Verify the user exists
    const { data: user } = await supabase.from('users').select('*').eq('username', username).single();
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // 2. Fetch all valid shares from the database for this user to ensure the submitted ones are real
    const { data: validShares } = await supabase.from('recovery_shares').select('share_data').eq('user_id', user.id);
    const validShareStrings = validShares?.map(s => s.share_data) || [];

    // 3. Ensure the submitted shares actually belong to this user
    for (const share of submittedShares) {
      if (!validShareStrings.includes(share)) {
        return NextResponse.json({ error: 'One or more provided shares are invalid or do not belong to this user.' }, { status: 403 });
      }
    }

    // 4. Reconstruct the Master Key!
    const recoveredKey = secrets.combine(submittedShares);

    // 5. If we successfully combined them, we grant a temporary recovery session
    // (In a full app, this would issue a JWT or trigger a new FIDO2 registration)
    return NextResponse.json({
      success: true,
      message: 'Threshold met. Master key recovered!',
      recoveredKey: recoveredKey
    });

  } catch (error: any) {
    return NextResponse.json({ error: 'Cryptographic combination failed. Invalid shares.' }, { status: 500 });
  }
}