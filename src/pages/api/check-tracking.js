// pages/api/check-tracking.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // ✅ CORS headers toestaan voor externe validatie
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { projectId } = req.query

  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' })
  }

  try {
    // ⬇️ check nu in organizations
    const { data, error } = await supabase
      .from('organizations')
      .select('last_tracking_ping')
      .eq('id', projectId) // projectId == organization.id
      .single()

    if (error) {
      console.error('❌ Supabase error:', error)
      return res.status(500).json({ error: error.message })
    }

    if (!data || !data.last_tracking_ping) {
      return res.status(200).json({ status: 'not_found' })
    }

    // ✅ Als er ooit een ping is geweest → ok
    return res.status(200).json({ status: 'ok' })
  } catch (err) {
    console.error('❌ Server error:', err)
    return res.status(500).json({ error: 'Unexpected error' })
  }
}
