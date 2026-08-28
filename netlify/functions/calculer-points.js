import { createClient } from '@supabase/supabase-js'

// Cette fonction est appelée (manuellement ou par un cron) pour calculer
// les points de tous les joueurs choisis dans un match terminé.
export async function handler(event) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY // service_role, jamais exposée au client
  )

  try {
    const { match_id, nhl_game_id } = JSON.parse(event.body)

    // 1. Aller chercher le boxscore du match
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${nhl_game_id}/boxscore`)
    const boxscore = await res.json()

    // 2. Construire une table buts/passes par joueur (nhl_id)
    const statsParJoueur = {}
    const equipes = [boxscore.awayTeam, boxscore.homeTeam]

    for (const equipe of equipes) {
      const joueursEquipe = [
        ...(boxscore.playerByGameStats?.[equipe.abbrev === boxscore.awayTeam.abbrev ? 'awayTeam' : 'homeTeam']?.forwards || []),
        ...(boxscore.playerByGameStats?.[equipe.abbrev === boxscore.awayTeam.abbrev ? 'awayTeam' : 'homeTeam']?.defense || []),
      ]
      for (const j of joueursEquipe) {
        statsParJoueur[j.playerId] = {
          buts: j.goals || 0,
          passes: j.assists || 0,
        }
      }
    }

    // 3. Aller chercher tous les choix faits pour ce match
    const { data: choix, error: erreurChoix } = await supabase
      .from('choix')
      .select('id, user_id, joueur_id, joueurs(nhl_id, nom)')
      .eq('match_id', match_id)

    if (erreurChoix) throw erreurChoix

    // 4. Calculer les points pour chaque choix
    const resultats = choix.map((c) => {
      const stats = statsParJoueur[c.joueurs.nhl_id] || { buts: 0, passes: 0 }
      const tourChapeau = stats.buts >= 3
      const points = stats.buts * 2 + stats.passes * 1 + (tourChapeau ? 3 : 0)

      return {
        match_id,
        user_id: c.user_id,
        joueur_id: c.joueur_id,
        buts: stats.buts,
        passes: stats.passes,
        tour_chapeau: tourChapeau,
        points,
      }
    })

    // 5. Enregistrer (upsert) les résultats
    const { error: erreurUpsert } = await supabase
      .from('resultats')
      .upsert(resultats, { onConflict: 'match_id,user_id' })

    if (erreurUpsert) throw erreurUpsert

    // 6. Marquer le match comme terminé
    await supabase.from('matchs').update({ statut: 'termine' }).eq('id', match_id)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultats }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
