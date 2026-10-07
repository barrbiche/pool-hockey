import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Envoie une notification de test à la personne connectée (pour vérifier que ça marche).
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST seulement' }) }
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    const { data, error: erreurAuth } = await supabase.auth.getUser(token)
    if (erreurAuth || !data?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Non connecté' }) }
    }

    const { data: abonnement } = await supabase
      .from('abonnements_push')
      .select('subscription')
      .eq('user_id', data.user.id)
      .maybeSingle()
    if (!abonnement) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Aucun abonnement' }) }
    }

    await webpush.sendNotification(
      abonnement.subscription,
      JSON.stringify({
        titre: '✅ Notifications activées!',
        corps:
          "Ceci est un test du Pool de Hockey. Si tu vois ce message, tout fonctionne! Si tu ne l'as pas reçu, ça n'a pas fonctionné : contacte Eric. Les notifications sont obligatoires pour une bonne communication.",
      })
    )
    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
