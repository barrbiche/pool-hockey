import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export const config = {
  schedule: '*/15 * * * *', // vérifie toutes les 15 minutes
}

webpush.setVapidDetails(
  'mailto:eric.vanier.piquette@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// 2h avant chaque match, envoie UNE fois un rappel seulement à la personne
// dont c'est le tour de choisir présentement (pas à tout le monde).
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const maintenant = new Date()
    // Fenêtre de 15 min autour de la marque des 2h avant le match, pour
    // s'assurer que le cron (qui tourne aux 15 min) l'attrape une seule fois
    const debutFenetre = new Date(maintenant.getTime() + 105 * 60 * 1000) // 1h45
    const finFenetre = new Date(maintenant.getTime() + 120 * 60 * 1000) // 2h00

    const { data: matchs, error: erreurMatchs } = await supabase
      .from('matchs')
      .select('*')
      .gte('date_match', debutFenetre.toISOString())
      .lte('date_match', finFenetre.toISOString())
      .eq('statut', 'a_venir')
      .is('rappel_envoye', null)

    if (erreurMatchs) throw erreurMatchs
    if (!matchs || matchs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Aucun rappel à envoyer' }) }
    }

    const rappelsEnvoyes = []

    for (const match of matchs) {
      if (!match.ordre_choix) continue

      const { data: choixExistants } = await supabase
        .from('choix')
        .select('user_id')
        .eq('match_id', match.id)

      const usersAvecChoix = new Set((choixExistants || []).map((c) => c.user_id))
      const prochainAChoisir = match.ordre_choix.find((uid) => !usersAvecChoix.has(uid))

      if (prochainAChoisir) {
        const { data: abonnement } = await supabase
          .from('abonnements_push')
          .select('subscription')
          .eq('user_id', prochainAChoisir)
          .maybeSingle()

        if (abonnement) {
          try {
            await webpush.sendNotification(
              abonnement.subscription,
              JSON.stringify({
                titre: 'Pool de Hockey 🏒',
                corps: `⏰ La partie commence dans 2h — c'est à toi de choisir ton joueur!`,
              })
            )
            rappelsEnvoyes.push({ match_id: match.id, user_id: prochainAChoisir })
          } catch {
            // pas grave si l'envoi échoue, on continue
          }
        }
      }

      // Marquer ce match comme "rappel envoyé" pour ne pas répéter
      await supabase.from('matchs').update({ rappel_envoye: true }).eq('id', match.id)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rappelsEnvoyes }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
