import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { ORDRE_BASE, NOMS } from './_participants.js'

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// Envoie une notification à tout le monde sauf l'auteur quand cette
// personne change son choix de joueur (elle avait déjà choisi avant).
// L'auteur est la personne CONNECTÉE (jeton Authorization: Bearer ...), pas celle
// qu'indique la requête : impossible de se faire passer pour quelqu'un d'autre.
export async function handler(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Pas connecté.' }) }
    const { data: auth, error: erreurAuth } = await supabase.auth.getUser(token)
    if (erreurAuth || !auth?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Session invalide.' }) }
    }
    if (!ORDRE_BASE.includes(auth.user.id)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Pas dans le pool.' }) }
    }

    const user_id = auth.user.id
    const nouveau_joueur = String(JSON.parse(event.body || '{}').nouveau_joueur ?? '').slice(0, 80)
    const auteur = NOMS[user_id] || 'Quelqu\'un'
    const destinataires = ORDRE_BASE.filter((uid) => uid !== user_id)

    const envois = []
    for (const destinataireId of destinataires) {
      const { data: abonnement } = await supabase
        .from('abonnements_push')
        .select('subscription')
        .eq('user_id', destinataireId)
        .maybeSingle()

      if (!abonnement) continue

      try {
        await webpush.sendNotification(
          abonnement.subscription,
          JSON.stringify({
            titre: 'Pool de Hockey 🏒',
            corps: `🔄 ${auteur} a changé son choix pour ${nouveau_joueur}`,
          })
        )
        envois.push(destinataireId)
      } catch {
        // pas grave si l'envoi échoue pour une personne, on continue
      }
    }

    return { statusCode: 200, body: JSON.stringify({ envois }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
