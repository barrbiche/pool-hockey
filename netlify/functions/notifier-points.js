import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { traiter } from './_notif-points.js'

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Appelée par le bouton 🔄 Mise à jour : si les buts/passes des joueurs choisis
// ont changé depuis la dernière notification, envoie une notif à tout le monde.
export async function handler(event) {
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
    const { match_id } = JSON.parse(event.body || '{}')
    if (!match_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'match_id manquant' }) }
    }
    const resultat = await traiter({ supabase, matchId: match_id, fetchFn: fetch, envoyerPush })
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(resultat),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
