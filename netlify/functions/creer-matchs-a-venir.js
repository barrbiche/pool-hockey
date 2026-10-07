import { createClient } from '@supabase/supabase-js'
import { ORDRE_BASE, matchTermine } from './_participants.js'
import { reorganiserOrdres } from './_ordres.js'

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

      await supabase.from('matchs').insert({
        nhl_game_id: m.id,
        date_match: m.startTimeUTC,
        adversaire,
        statut: 'a_venir',
        // Provisoire : reorganiserOrdres ci-dessous met la bonne rotation
        ordre_choix: ORDRE_BASE,
      })

      matchsCrees.push(m.id)
    }

    // Rotation de l'ordre de choix pour tous les matchs à venir sans choix
    const changements = await reorganiserOrdres(supabase)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchsCrees, ordresModifies: changements.length }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
