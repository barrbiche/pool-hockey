import { createClient } from '@supabase/supabase-js'

export const config = {
  schedule: '*/15 * * * *', // vérifie toutes les 15 minutes
}

// Cron : vérifie tous les matchs "a_venir" ou "en_cours" dans notre DB,
// regarde si l'API NHL les indique comme terminés (gameState "OFF"), et si
// oui calcule automatiquement les points de tout le monde pour ce match.
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    // Matchs qu'on n'a pas encore marqués "terminé"
    const { data: matchs, error: erreurMatchs } = await supabase
      .from('matchs')
      .select('*')
      .neq('statut', 'termine')

    if (erreurMatchs) throw erreurMatchs
    if (!matchs || matchs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Aucun match à vérifier' }) }
    }

    const resultatsTraites = []

    for (const match of matchs) {
      // Vérifier le statut réel du match auprès de l'API NHL
      const resBox = await fetch(
        `https://api-web.nhle.com/v1/gamecenter/${match.nhl_game_id}/boxscore`
      )
      const boxscore = await resBox.json()

      if (boxscore.gameState !== 'OFF' && boxscore.gameState !== 'FINAL') {
        continue // match pas encore terminé, on skip
      }

      // Construire une table buts/passes par joueur (nhl_id)
      const statsParJoueur = {}
      const cotes = ['awayTeam', 'homeTeam']
      for (const cote of cotes) {
        const joueursEquipe = [
          ...(boxscore.playerByGameStats?.[cote]?.forwards || []),
          ...(boxscore.playerByGameStats?.[cote]?.defense || []),
        ]
        for (const j of joueursEquipe) {
          statsParJoueur[j.playerId] = {
            buts: j.goals || 0,
            passes: j.assists || 0,
          }
        }
      }

      // Choix faits pour ce match
      const { data: choix } = await supabase
        .from('choix')
        .select('id, user_id, joueur_id, joueurs(nhl_id, nom)')
        .eq('match_id', match.id)

      if (choix && choix.length > 0) {
        const resultats = choix.map((c) => {
          const stats = statsParJoueur[c.joueurs.nhl_id] || { buts: 0, passes: 0 }
          const tourChapeau = stats.buts >= 3
          const points = stats.buts * 2 + stats.passes * 1 + (tourChapeau ? 3 : 0)
          return {
            match_id: match.id,
            user_id: c.user_id,
            joueur_id: c.joueur_id,
            buts: stats.buts,
            passes: stats.passes,
            tour_chapeau: tourChapeau,
            points,
          }
        })

        await supabase.from('resultats').upsert(resultats, { onConflict: 'match_id,user_id' })
      }

      await supabase.from('matchs').update({ statut: 'termine' }).eq('id', match.id)
      resultatsTraites.push(match.id)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchsTraites: resultatsTraites }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
