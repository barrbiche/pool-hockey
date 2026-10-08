import { createClient } from '@supabase/supabase-js'
import { ORDRE_BASE } from './_participants.js'

// Enregistre l'abonnement aux notifications DE LA PERSONNE CONNECTÉE.
// Il faut le jeton de connexion (Authorization: Bearer ...) : sans lui, n'importe qui
// pourrait remplacer l'abonnement d'un participant et recevoir ses notifications.
export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    if (!token) return reponse(401, { error: 'Pas connecté.' })
    const { data: auth, error: erreurAuth } = await supabase.auth.getUser(token)
    if (erreurAuth || !auth?.user) return reponse(401, { error: 'Session invalide.' })
    if (!ORDRE_BASE.includes(auth.user.id)) return reponse(403, { error: 'Pas dans le pool.' })

    let corps
    try {
      corps = JSON.parse(event.body || '{}')
    } catch {
      return reponse(400, { error: 'Requête illisible.' })
    }
    const subscription = corps.subscription
    if (
      !subscription ||
      typeof subscription.endpoint !== 'string' ||
      !subscription.endpoint.startsWith('https://')
    ) {
      return reponse(400, { error: 'Abonnement invalide.' })
    }

    const { error } = await supabase
      .from('abonnements_push')
      .upsert({ user_id: auth.user.id, subscription }, { onConflict: 'user_id' })
    if (error) throw error

    return reponse(200, { ok: true })
  } catch (err) {
    return reponse(500, { error: err.message })
  }
}

function reponse(statusCode, corps) {
  return { statusCode, body: JSON.stringify(corps) }
}
