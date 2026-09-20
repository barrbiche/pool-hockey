import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { NOMS } from './_participants.js'

export const config = {
  schedule: '*/15 * * * *', // vérifie toutes les 15 minutes
}

webpush.setVapidDetails(
  'mailto:eric.vanier.piquette@gmail.com',
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

  const emoji = resultat.tour_chapeau ? '🎩' : resultat.points > 0 ? '🎉' : '😴'
  const corps =
    resultat.points > 0
      ? `${emoji} ${nomJoueurChoisi} t'a rapporté ${resultat.points} points ce soir! (${resultat.buts} buts, ${resultat.passes} passes)`
      : `${emoji} ${nomJoueurChoisi} n'a pas eu de but/passe ce soir — 0 point.`

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
    // Matchs qu'on n'a pas encore marqués "terminé" ET qui sont déjà
    // commencés. Sans le filtre sur la date, on interrogeait l'API du NHL
    // pour la vingtaine de matchs créés d'avance, aux 15 minutes, pour rien
    // — environ 2000 appels inutiles par jour, avec le risque de se faire
    // limiter par l'API juste au mauvais moment.
    const { data: matchs, error: erreurMatchs } = await supabase
      .from('matchs')
      .select('*')
      .neq('statut', 'termine')
      .lt('date_match', new Date().toISOString())
      .order('date_match', { ascending: true })

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

      // Reporté, annulé ou suspendu : ce match ne se terminera jamais.
      // Sans ça, on redemanderait son boxscore aux 15 minutes jusqu'à la
      // fin de la saison. Son numéro reste consommé, la rotation continue.
      if (['PPD', 'CNCL', 'SUSP'].includes(boxscore.gameState)) {
        await supabase.from('matchs').update({ statut: 'reporte' }).eq('id', match.id)
        continue
      }

      if (boxscore.gameState !== 'OFF' && boxscore.gameState !== 'FINAL') {
        // Filet de sécurité : un match commencé depuis plus de 24h qui
        // n'est toujours pas terminé n'arrivera plus. Plutôt que de
        // l'interroger indéfiniment, on le sort du circuit — le cron
        // creer-matchs-a-venir le remettra à jour s'il revient.
        const debutMatch = new Date(match.date_match).getTime()
        if (Date.now() - debutMatch > 24 * 60 * 60 * 1000) {
          await supabase.from('matchs').update({ statut: 'reporte' }).eq('id', match.id)
        }
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
            nomJoueurChoisi: c.joueurs.nom,
          }
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
