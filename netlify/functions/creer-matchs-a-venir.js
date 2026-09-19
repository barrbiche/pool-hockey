import { createClient } from '@supabase/supabase-js'
import { ordreChoixPourMatch, matchTermine } from './_participants.js'

export const config = {
  schedule: '0 */6 * * *', // vérifie toutes les 6 heures
}

// Cron indépendant de l'app : s'assure que tous les matchs à venir du CH
// (les 2 prochaines semaines) existent déjà dans notre base avec leur ordre
// de choix, sans dépendre du fait que quelqu'un ouvre le site ou non.
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const res = await fetch('https://api-web.nhle.com/v1/club-schedule-season/MTL/now')
    const data = await res.json()
    const maintenant = new Date()
    const dansTrenteJours = new Date(maintenant.getTime() + 30 * 24 * 60 * 60 * 1000)

    const matchsAVenir = (data.games || [])
      .filter((m) => {
        const dateMatch = new Date(m.startTimeUTC)
        return (
          !matchTermine(m.gameState) &&
          (m.gameType === 2 || m.gameType === 3) &&
          dateMatch >= maintenant &&
          dateMatch <= dansTrenteJours
        )
      })
      .sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC))

    // Compter combien de matchs existent déjà (pour la rotation)
    const { count: totalExistants } = await supabase
      .from('matchs')
      .select('*', { count: 'exact', head: true })

    let compteur = totalExistants || 0
    const matchsCrees = []

    for (const m of matchsAVenir) {
      const { data: existant } = await supabase
        .from('matchs')
        .select('id')
        .eq('nhl_game_id', m.id)
        .maybeSingle()

      if (existant) continue

      const adversaireEstDom = m.homeTeam.abbrev === 'MTL'
      const adversaire = adversaireEstDom ? m.awayTeam.abbrev : m.homeTeam.abbrev

      compteur += 1
      const ordre = ordreChoixPourMatch(compteur)

      await supabase.from('matchs').insert({
        nhl_game_id: m.id,
        date_match: m.startTimeUTC,
        adversaire,
        statut: 'a_venir',
        ordre_choix: ordre,
      })

      matchsCrees.push(m.id)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchsCrees }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
