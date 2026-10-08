import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { ORDRE_BASE } from './_participants.js'

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Envoie une notification à un participant du pool. Réservé aux participants connectés
// (jeton Authorization: Bearer ...) : sans ça, n'importe qui pourrait envoyer un texte
// de son choix au téléphone de quelqu'un.
export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    if (!token) return reponse(401, { error: 'Pas connecté.' })
    const { data: auth, error: erreurAuth } = await supabase.auth.getUser(token)
    if (erreurAuth || !auth?.user) return reponse(401, { error: 'Session invalide.' })
    if (!ORDRE_BASE.includes(auth.user.id)) return reponse(403, { error: 'Pas dans le pool.' })

    let demande
    try {
      demande = JSON.parse(event.body || '{}')
    } catch {
      return reponse(400, { error: 'Requête illisible.' })
    }
    const user_id = demande.user_id
    if (!ORDRE_BASE.includes(user_id)) return reponse(400, { error: 'Destinataire inconnu.' })
    const titre = String(demande.titre ?? '').slice(0, 80)
    const corps = String(demande.corps ?? '').slice(0, 240)

    const { data, error } = await supabase
      .from('abonnements_push')
      .select('subscription')
      .eq('user_id', user_id)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return reponse(200, { envoye: false, raison: 'pas abonné' })
    }

    try {
      await webpush.sendNotification(data.subscription, JSON.stringify({ titre, corps }))
    } catch (errPush) {
      // 410/404 = l'abonnement a expiré ou a été révoqué côté navigateur/OS
      if (errPush.statusCode === 410 || errPush.statusCode === 404) {
        await supabase.from('abonnements_push').delete().eq('user_id', user_id)
        return reponse(200, { envoye: false, raison: 'abonnement expiré, réactive les notifs' })
      }
      throw errPush
    }

    return reponse(200, { envoye: true })
  } catch (err) {
    return reponse(500, { error: err.message })
  }
}

function reponse(statusCode, corps) {
  return { statusCode, body: JSON.stringify(corps) }
}
