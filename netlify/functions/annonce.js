import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { traiterAnnonce } from './_annonce.js'

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Envoie une notification (à tout le monde ou à une personne) avec le texte écrit par Eric.
// Appel : POST { texte, destinataire ('tous' ou l'id d'une personne) } avec l'en-tête Authorization: Bearer <jeton de connexion>.
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST seulement' }) }
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  async function envoyerPush(userIds, message) {
    const envoyes = []
    for (const uid of userIds) {
      const { data: abonnement } = await supabase
        .from('abonnements_push')
        .select('subscription')
        .eq('user_id', uid)
        .maybeSingle()
      if (!abonnement) continue
      try {
        await webpush.sendNotification(abonnement.subscription, JSON.stringify(message))
        envoyes.push(uid)
      } catch (errPush) {
        if (errPush.statusCode === 410 || errPush.statusCode === 404) {
          await supabase.from('abonnements_push').delete().eq('user_id', uid)
        }
      }
    }
    return envoyes
  }

  try {
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    const { texte, destinataire } = JSON.parse(event.body || '{}')
    const r = await traiterAnnonce({ supabase, token, texte, destinataire, envoyerPush })
    const { statut, ...corps } = r
    return {
      statusCode: statut,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(corps),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
