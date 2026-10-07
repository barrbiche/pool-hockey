// Logique de la notification "les points ont changé" pendant un match.
// Séparée de la fonction Netlify pour pouvoir être testée sans web-push ni
// vrai Supabase : tout ce qui touche l'extérieur est passé en paramètre.
import { ORDRE_BASE, NOMS, saisonEnCours } from './_participants.js'

// Stats par choix (clé = user_id) : { buts, passes, joueur }
export function statsParChoix(choix, boxscore) {
  const parJoueur = {}
  for (const cote of ['awayTeam', 'homeTeam']) {
    const patineurs = [
      ...(boxscore.playerByGameStats?.[cote]?.forwards || []),
      ...(boxscore.playerByGameStats?.[cote]?.defense || []),
    ]
    for (const j of patineurs) parJoueur[j.playerId] = { buts: j.goals || 0, passes: j.assists || 0 }
  }
  const resultat = {}
  for (const c of choix) {
    const s = parJoueur[c.joueurs?.nhl_id] || { buts: 0, passes: 0 }
    resultat[c.user_id] = { buts: s.buts, passes: s.passes, joueur: c.joueurs?.nom || '?' }
  }
  return resultat
}

export function pointsDe(s) {
  return s.buts * 2 + s.passes + (s.buts >= 3 ? 3 : 0)
}

// Compare les stats d'avant et d'après, retourne des phrases (vide = rien de neuf)
export function evenements(avant, apres) {
  const phrases = []
  for (const [uid, s] of Object.entries(apres)) {
    const a = avant?.[uid] || { buts: 0, passes: 0 }
    const nom = NOMS[uid] || 'Quelqu\'un'
    if (s.buts > a.buts) {
      phrases.push(`⚽ ${s.joueur} a marqué! (choix de ${nom})`)
      if (s.buts >= 3 && a.buts < 3) phrases.push(`🎩 TOUR DU CHAPEAU de ${s.joueur}!`)
    }
    if (s.passes > a.passes) phrases.push(`🍎 ${s.joueur} a une passe (choix de ${nom})`)
  }
  return phrases
}

// Totaux de saison déjà officiels (table resultats) + points provisoires du match
export function classementTexte(resultatsSaison, apres) {
  const total = {}
  for (const uid of ORDRE_BASE) total[uid] = 0
  for (const r of resultatsSaison) total[r.user_id] = (total[r.user_id] || 0) + (r.points || 0)
  for (const [uid, s] of Object.entries(apres)) total[uid] = (total[uid] || 0) + pointsDe(s)
  return Object.entries(total)
    .sort((a, b) => b[1] - a[1])
    .map(([uid, pts]) => `${NOMS[uid] || '?'} ${pts}`)
    .join(', ')
}

export async function traiter({ supabase, matchId, fetchFn, envoyerPush }) {
  const { data: match, error: errMatch } = await supabase
    .from('matchs')
    .select('id, nhl_game_id, statut, derniere_stats_direct')
    .eq('id', matchId)
    .maybeSingle()
  if (errMatch) throw errMatch
  if (!match) return { notifie: false, raison: 'match introuvable' }
  if (match.statut === 'termine') return { notifie: false, raison: 'match déjà calculé' }

  const res = await fetchFn(`https://api-web.nhle.com/v1/gamecenter/${match.nhl_game_id}/boxscore`)
  if (!res.ok) throw new Error(`NHL HTTP ${res.status}`)
  const boxscore = await res.json()
  if (!['LIVE', 'CRIT'].includes(boxscore.gameState)) {
    return { notifie: false, raison: `match pas en cours (${boxscore.gameState})` }
  }

  const { data: choix } = await supabase
    .from('choix')
    .select('user_id, joueurs(nhl_id, nom)')
    .eq('match_id', match.id)
  const apres = statsParChoix(choix || [], boxscore)
  const triees = {}
  for (const k of Object.keys(apres).sort()) triees[k] = apres[k]
  const apresTexte = JSON.stringify(triees)

  const avant = match.derniere_stats_direct ? JSON.parse(match.derniere_stats_direct) : null
  if (match.derniere_stats_direct === apresTexte) return { notifie: false, raison: 'rien de neuf' }

  // On "réserve" ce changement : si quelqu'un d'autre a déjà notifié entre-temps,
  // la mise à jour conditionnelle ne touche aucune ligne et on n'envoie rien.
  let requete = supabase.from('matchs').update({ derniere_stats_direct: apresTexte }).eq('id', match.id)
  requete =
    match.derniere_stats_direct === null
      ? requete.is('derniere_stats_direct', null)
      : requete.eq('derniere_stats_direct', match.derniere_stats_direct)
  const { data: maj, error: errMaj } = await requete.select('id')
  if (errMaj) throw errMaj
  if (!maj || maj.length === 0) return { notifie: false, raison: 'déjà notifié par quelqu\'un d\'autre' }

  const phrases = evenements(avant, apres)
  if (phrases.length === 0) return { notifie: false, raison: 'aucun changement de points' }

  const { debutSaison } = saisonEnCours()
  const { data: resultats } = await supabase
    .from('resultats')
    .select('user_id, points, matchs(date_match)')
  const saison = (resultats || []).filter(
    (r) => r.matchs?.date_match && new Date(r.matchs.date_match) >= debutSaison
  )

  const corps = `${phrases.join('\n')}\nClassement provisoire : ${classementTexte(saison, apres)}`
  const envoyes = await envoyerPush(ORDRE_BASE, { titre: '🚨 Pool de Hockey', corps })
  return { notifie: true, corps, envoyes }
}
