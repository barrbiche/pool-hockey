import { createClient } from '@supabase/supabase-js'

// Dit si la personne connectée a un abonnement aux notifications enregistré dans la base.
export async function handler(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    const { data, error: erreurAuth } = await supabase.auth.getUser(token)
    if (erreurAuth || !data?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Non connecté' }) }
    }

    const { data: abonnement, error } = await supabase
      .from('abonnements_push')
      .select('user_id')
      .eq('user_id', data.user.id)
      .maybeSingle()
    if (error) throw error

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ actif: !!abonnement }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
