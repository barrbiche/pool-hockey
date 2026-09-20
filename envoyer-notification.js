import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:eric.vanier.piquette@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

export async function handler(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const { user_id, titre, corps } = JSON.parse(event.body)

    const { data, error } = await supabase
      .from('abonnements_push')
      .select('subscription')
      .eq('user_id', user_id)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return { statusCode: 200, body: JSON.stringify({ envoye: false, raison: 'pas abonné' }) }
    }

    try {
      await webpush.sendNotification(data.subscription, JSON.stringify({ titre, corps }))
    } catch (errPush) {
      // 410/404 = l'abonnement a expiré ou a été révoqué côté navigateur/OS
      if (errPush.statusCode === 410 || errPush.statusCode === 404) {
        await supabase.from('abonnements_push').delete().eq('user_id', user_id)
        return {
          statusCode: 200,
          body: JSON.stringify({ envoye: false, raison: 'abonnement expiré, réactive les notifs' }),
        }
      }
      throw errPush
    }

    return { statusCode: 200, body: JSON.stringify({ envoye: true }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
