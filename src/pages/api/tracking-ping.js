import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role key vereist
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { projectId } = req.body

  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' })
  }

  // ⬇️ update de organizations tabel ipv profiles
  const { error } = await supabase
    .from('organizations')
    .update({ last_tracking_ping: new Date().toISOString() })
    .eq('id', projectId) // projectId = organization.id

  if (error) {
    console.error('Supabase error:', error)
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ success: true })
}
