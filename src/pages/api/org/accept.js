// pages/invite/accept.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';

export default function AcceptInvite() {
  const router = useRouter();
  const { token } = router.query;
  const [status, setStatus] = useState('Bezig met verwerken...');

  useEffect(() => {
    async function run() {
      if (!token) return;

      // check session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // redirect naar login met terugkeer
        const back = encodeURIComponent(`/invite/accept?token=${token}`);
        router.replace(`/login?redirect=${back}`);
        return;
      }

      // accept
      const res = await fetch('/api/org/accept-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token }),
      });

      const json = await res.json();
      if (!res.ok) {
        setStatus(json?.error || 'Kon uitnodiging niet accepteren.');
        return;
      }

      setStatus('Uitnodiging geaccepteerd. Doorsturen...');
      setTimeout(() => router.replace('/dashboard'), 800);
    }
    run();
  }, [token, router]);

  return (
    <div className="max-w-md mx-auto mt-16 p-6 border rounded-xl shadow">
      <h1 className="text-xl font-semibold mb-2">Uitnodiging accepteren</h1>
      <p>{status}</p>
    </div>
  );
}
