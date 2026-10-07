import { createClient } from '@supabase/supabase-js'

// Désactive les notifications : supprime l'abonnement de la personne connectée.
export async function handler(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(
      /^Bearer\s+/i,
      ''
    )
    const { data, error: erreurAuth } = await supabase.auth.getUser(token)
    if (erreurAuth || !data?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Non connecté' }) }
    }

    const { error } = await supabase.from('abonnements_push').delete().eq('user_id', data.user.id)
    if (error) throw error

    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
