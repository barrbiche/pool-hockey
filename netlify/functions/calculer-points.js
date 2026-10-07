import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { NOMS } from './_participants.js'
import { bonusPrediction } from './_prediction.js'

export const config = {
  schedule: '*/15 * * * *', // vérifie toutes les 15 minutes
}

webpush.setVapidDetails(
  'mailto:pool-hockey@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

async function notifierResultatPersonnel(supabase, resultat, nomJoueurChoisi) {
  const { data: abonnement } = await supabase
    .from('abonnements_push')
    .select('subscription')
    .eq('user_id', resultat.user_id)
    .maybeSingle()

  if (!abonnement) return

  const bonus = resultat.bonus || 0
  const pointsJoueur = resultat.points - bonus
  const emoji = resultat.tour_chapeau ? '🎩' : pointsJoueur > 0 ? '🎉' : '😴'
  let corps =
    pointsJoueur > 0
      ? `${emoji} ${nomJoueurChoisi} t'a rapporté ${pointsJoueur} points ce soir! (${resultat.buts} buts, ${resultat.passes} passes)`
      : `${emoji} ${nomJoueurChoisi} n'a pas eu de but/passe ce soir — 0 point.`
  if (bonus > 0) corps += ` 🎯 +${bonus} pour ton pointage deviné!`

  try {
    await webpush.sendNotification(
      abonnement.subscription,
      JSON.stringify({ titre: 'Résultat du match 🏒', corps })
    )
  } catch {
    // pas grave si l'envoi échoue pour une personne, on continue
  }
}

// Cron : vérifie tous les matchs "a_venir" ou "en_cours" dans notre DB,
// regarde si l'API NHL les indique comme terminés (gameState "OFF"), et si
// oui calcule automatiquement les points de tout le monde pour ce match.
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    // Matchs qu'on n'a pas encore marqués "terminé" ET déjà commencés.
    // Un match dans 3 semaines ne peut pas être "OFF" : inutile d'appeler
    // l'API de la NHL pour lui à chaque passage du cron (aux 15 minutes).
    const maintenant = new Date().toISOString()
    const { data: matchs, error: erreurMatchs } = await supabase
      .from('matchs')
      .select('*')
      .neq('statut', 'termine')
      .lte('date_match', maintenant)

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

      // Pointage final (prolongation et fusillade inclus) vu du côté du Canadien
      const mtlEstDomicile = boxscore.homeTeam?.abbrev === 'MTL'
      const scoreMtl = mtlEstDomicile ? boxscore.homeTeam?.score : boxscore.awayTeam?.score
      const scoreAdversaire = mtlEstDomicile ? boxscore.awayTeam?.score : boxscore.homeTeam?.score

      // Pointages devinés pour ce match. Si la table n'existe pas encore (SQL
      // pas roulé), on continue sans bonus plutôt que de bloquer les points.
      let predictions = []
      try {
        const { data, error } = await supabase
          .from('predictions')
          .select('user_id, score_mtl, score_adversaire')
          .eq('match_id', String(match.id))
        if (!error && data) predictions = data
      } catch {
        predictions = []
      }

      if (choix && choix.length > 0) {
        const resultats = choix.map((c) => {
          const stats = statsParJoueur[c.joueurs.nhl_id] || { buts: 0, passes: 0 }
          const tourChapeau = stats.buts >= 3
          const pointsJoueur = stats.buts * 2 + stats.passes * 1 + (tourChapeau ? 3 : 0)
          const bonus = bonusPrediction(
            predictions.find((p) => p.user_id === c.user_id),
            scoreMtl,
            scoreAdversaire
          )
          const resultat = {
            match_id: match.id,
            user_id: c.user_id,
            joueur_id: c.joueur_id,
            buts: stats.buts,
            passes: stats.passes,
            tour_chapeau: tourChapeau,
            points: pointsJoueur + bonus,
            nomJoueurChoisi: c.joueurs.nom,
          }
          // La colonne `bonus` n'est écrite que s'il y a eu des pointages
          // devinés : ça évite une erreur tant que le SQL n'est pas roulé.
          if (predictions.length > 0) resultat.bonus = bonus
          return resultat
        })

        await supabase
          .from('resultats')
          .upsert(
            resultats.map(({ nomJoueurChoisi, ...r }) => r),
            { onConflict: 'match_id,user_id' }
          )

        // Envoyer une notification personnelle à chacun avec son résultat
        for (const r of resultats) {
          await notifierResultatPersonnel(supabase, r, r.nomJoueurChoisi)
        }
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
