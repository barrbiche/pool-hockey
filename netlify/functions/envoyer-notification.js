import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
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

    await webpush.sendNotification(
      data.subscription,
      JSON.stringify({ titre, corps })
    )

    return { statusCode: 200, body: JSON.stringify({ envoye: true }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
