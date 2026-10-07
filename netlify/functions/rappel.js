import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { traiterRappel } from './_rappel.js'

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Réservé à Eric : envoie à UNE personne un rappel amical que c'est son tour de
// choisir. Appel : POST { user_id, match_id } avec Authorization: Bearer <jeton>.
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
    const { user_id, match_id } = JSON.parse(event.body || '{}')
    const r = await traiterRappel({ supabase, token, userId: user_id, matchId: match_id, envoyerPush })
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
