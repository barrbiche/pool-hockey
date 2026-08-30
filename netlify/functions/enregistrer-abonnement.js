import { createClient } from '@supabase/supabase-js'

export async function handler(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const { user_id, subscription } = JSON.parse(event.body)

    const { error } = await supabase
      .from('abonnements_push')
      .upsert({ user_id, subscription }, { onConflict: 'user_id' })

    if (error) throw error

    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
