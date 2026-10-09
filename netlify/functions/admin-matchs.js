import { createClient } from '@supabase/supabase-js'
import { ADMIN_ID, ORDRE_BASE, PARTICIPANTS } from './_participants.js'

// Page admin (Eric seulement) : « Corriger un match ».
//   GET                  -> les matchs récents
//   GET ?match_id=X      -> le détail : choix et résultats de chaque participant
//   POST { action: 'choisir',   match_id, user_id, nhl_id, nom }  -> choisit un joueur À LA PLACE de quelqu'un
//   POST { action: 'corriger',  match_id, user_id, buts, passes } -> corrige les buts/passes d'un résultat
//   POST { action: 'recalculer', match_id }                       -> relit la NHL et refait les points (sans notification)
// Tout demande Authorization: Bearer <jeton de connexion> d'Eric.

const POINTS_PREDICTION = 2

export function pointsJoueur(buts, passes) {
  return buts * 2 + passes + (buts >= 3 ? 3 : 0)
}

async function verifierAdmin(supabase, token) {
  if (!token) return { erreur: { statut: 401, erreur: 'Pas connecté.' } }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { erreur: { statut: 401, erreur: 'Session invalide.' } }
  if (data.user.id !== ADMIN_ID) return { erreur: { statut: 403, erreur: 'Réservé à Eric.' } }
  return {}
}

async function trouverMatch(supabase, matchId) {
  if (matchId === undefined || matchId === null || matchId === '') return null
  const { data, error } = await supabase
    .from('matchs')
    .select('id, nhl_game_id, date_match, adversaire, statut, ordre_choix')
    .eq('id', matchId)
    .maybeSingle()
  if (error) throw error
  return data
}

const entier = (n, min, max) => Number.isInteger(n) && n >= min && n <= max

export async function listerMatchs({ supabase, token }) {
  const { erreur } = await verifierAdmin(supabase, token)
  if (erreur) return erreur
  const { data, error } = await supabase
    .from('matchs')
    .select('id, nhl_game_id, date_match, adversaire, statut')
    .order('date_match', { ascending: false })
    .limit(12)
  if (error) throw error
  return { statut: 200, matchs: data || [] }
}

export async function detailMatch({ supabase, token, matchId }) {
  const { erreur } = await verifierAdmin(supabase, token)
  if (erreur) return erreur
  const match = await trouverMatch(supabase, matchId)
  if (!match) return { statut: 404, erreur: 'Match introuvable.' }

  const { data: choix, error: erreurChoix } = await supabase
    .from('choix')
    .select('user_id, joueurs(nom, nhl_id)')
    .eq('match_id', match.id)
  if (erreurChoix) throw erreurChoix

  // La colonne « bonus » peut manquer (SQL pas roulé) : on relit sans elle.
  let { data: resultats, error: erreurRes } = await supabase
    .from('resultats')
    .select('user_id, buts, passes, points, tour_chapeau, bonus')
    .eq('match_id', match.id)
  if (erreurRes) {
    ;({ data: resultats, error: erreurRes } = await supabase
      .from('resultats')
      .select('user_id, buts, passes, points, tour_chapeau')
      .eq('match_id', match.id))
  }
  if (erreurRes) throw erreurRes

  const participants = PARTICIPANTS.map((p) => {
    const c = (choix || []).find((x) => x.user_id === p.id)
    const r = (resultats || []).find((x) => x.user_id === p.id)
    return {
      user_id: p.id,
      nom: p.nom,
      joueur: c?.joueurs ? { nom: c.joueurs.nom, nhl_id: c.joueurs.nhl_id } : null,
      resultat: r
        ? {
            buts: r.buts ?? 0,
            passes: r.passes ?? 0,
            points: r.points ?? 0,
            bonus: r.bonus ?? 0,
            tour_chapeau: !!r.tour_chapeau,
          }
        : null,
    }
  })
  return { statut: 200, match, participants }
}

export async function choisirPourQuelquun({ supabase, token, matchId, userId, nhlId, nom }) {
  const { erreur } = await verifierAdmin(supabase, token)
  if (erreur) return erreur
  if (!ORDRE_BASE.includes(userId)) return { statut: 400, erreur: 'Compte inconnu.' }
  if (!entier(nhlId, 1, 1e9)) return { statut: 400, erreur: 'Joueur invalide.' }
  if (typeof nom !== 'string' || nom.trim().length === 0 || nom.length > 80) {
    return { statut: 400, erreur: 'Nom de joueur invalide.' }
  }
  const match = await trouverMatch(supabase, matchId)
  if (!match) return { statut: 404, erreur: 'Match introuvable.' }
  if (match.statut === 'termine') {
    return { statut: 400, erreur: 'Ce match est déjà calculé : utilise « Corriger buts/passes » à la place.' }
  }

  // Même règle que sur le site : un joueur ne peut pas être pris par deux personnes.
  const { data: autres, error: erreurAutres } = await supabase
    .from('choix')
    .select('user_id, joueurs(nhl_id)')
    .eq('match_id', match.id)
  if (erreurAutres) throw erreurAutres
  if ((autres || []).some((c) => c.user_id !== userId && c.joueurs?.nhl_id === nhlId)) {
    return { statut: 400, erreur: `${nom} est déjà choisi par quelqu'un d'autre pour ce match.` }
  }

  const { data: joueur, error: erreurJoueur } = await supabase
    .from('joueurs')
    .upsert({ nhl_id: nhlId, nom: nom.trim() }, { onConflict: 'nhl_id' })
    .select()
    .single()
  if (erreurJoueur) throw erreurJoueur

  const { error: erreurChoix } = await supabase
    .from('choix')
    .upsert({ match_id: match.id, user_id: userId, joueur_id: joueur.id }, { onConflict: 'match_id,user_id' })
  if (erreurChoix) throw erreurChoix
  return { statut: 200, ok: true }
}

export async function corrigerStats({ supabase, token, matchId, userId, buts, passes }) {
  const { erreur } = await verifierAdmin(supabase, token)
  if (erreur) return erreur
  if (!ORDRE_BASE.includes(userId)) return { statut: 400, erreur: 'Compte inconnu.' }
  if (!entier(buts, 0, 15) || !entier(passes, 0, 15)) {
    return { statut: 400, erreur: 'Les buts et les passes doivent être des nombres entiers de 0 à 15.' }
  }
  const match = await trouverMatch(supabase, matchId)
  if (!match) return { statut: 404, erreur: 'Match introuvable.' }

  const { data: existant, error: erreurLecture } = await supabase
    .from('resultats')
    .select('*')
    .eq('match_id', match.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (erreurLecture) throw erreurLecture
  if (!existant) {
    return { statut: 400, erreur: 'Ce match n’est pas encore calculé : il n’y a pas de résultat à corriger.' }
  }

  const bonus = existant.bonus || 0
  const tourChapeau = buts >= 3
  const points = pointsJoueur(buts, passes) + bonus
  const { error } = await supabase
    .from('resultats')
    .update({ buts, passes, tour_chapeau: tourChapeau, points })
    .eq('match_id', match.id)
    .eq('user_id', userId)
  if (error) throw error
  return { statut: 200, ok: true, points }
}

export async function recalculerMatch({ supabase, token, matchId, fetchImpl = fetch }) {
  const { erreur } = await verifierAdmin(supabase, token)
  if (erreur) return erreur
  const match = await trouverMatch(supabase, matchId)
  if (!match) return { statut: 404, erreur: 'Match introuvable.' }
  if (match.statut !== 'termine') {
    return { statut: 400, erreur: 'Ce match n’est pas encore calculé : le calcul automatique (ou « Bouton à Pa! ») va s’en occuper.' }
  }

  const controleur = new AbortController()
  const minuterie = setTimeout(() => controleur.abort(), 8000)
  let boxscore
  try {
    const res = await fetchImpl(`https://api-web.nhle.com/v1/gamecenter/${match.nhl_game_id}/boxscore`, {
      signal: controleur.signal,
    })
    if (!res.ok) return { statut: 502, erreur: `La NHL a répondu ${res.status}. Réessaie plus tard.` }
    boxscore = await res.json()
  } catch (e) {
    return { statut: 502, erreur: e?.name === 'AbortError' ? 'La NHL ne répond pas (8 s). Réessaie plus tard.' : `NHL injoignable : ${e?.message || e}` }
  } finally {
    clearTimeout(minuterie)
  }
  if (boxscore.gameState !== 'OFF' && boxscore.gameState !== 'FINAL') {
    return { statut: 400, erreur: 'La NHL n’indique pas ce match comme terminé.' }
  }

  const statsParJoueur = {}
  for (const cote of ['awayTeam', 'homeTeam']) {
    const joueurs = [
      ...(boxscore.playerByGameStats?.[cote]?.forwards || []),
      ...(boxscore.playerByGameStats?.[cote]?.defense || []),
    ]
    for (const j of joueurs) statsParJoueur[j.playerId] = { buts: j.goals || 0, passes: j.assists || 0 }
  }

  const { data: choix, error: erreurChoix } = await supabase
    .from('choix')
    .select('user_id, joueur_id, joueurs(nhl_id)')
    .eq('match_id', match.id)
  if (erreurChoix) throw erreurChoix
  if (!choix || choix.length === 0) return { statut: 400, erreur: 'Personne n’a de choix pour ce match.' }

  const mtlEstDomicile = boxscore.homeTeam?.abbrev === 'MTL'
  const scoreMtl = mtlEstDomicile ? boxscore.homeTeam?.score : boxscore.awayTeam?.score
  const scoreAdv = mtlEstDomicile ? boxscore.awayTeam?.score : boxscore.homeTeam?.score

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

  const lignes = choix.map((c) => {
    const st = statsParJoueur[c.joueurs?.nhl_id] || { buts: 0, passes: 0 }
    const p = predictions.find((x) => x.user_id === c.user_id)
    const bonus =
      p && Number.isInteger(scoreMtl) && Number.isInteger(scoreAdv) && p.score_mtl === scoreMtl && p.score_adversaire === scoreAdv
        ? POINTS_PREDICTION
        : 0
    const ligne = {
      match_id: match.id,
      user_id: c.user_id,
      joueur_id: c.joueur_id,
      buts: st.buts,
      passes: st.passes,
      tour_chapeau: st.buts >= 3,
      points: pointsJoueur(st.buts, st.passes) + bonus,
    }
    if (predictions.length > 0) ligne.bonus = bonus
    return ligne
  })

  let { error: erreurUpsert } = await supabase.from('resultats').upsert(lignes, { onConflict: 'match_id,user_id' })
  if (erreurUpsert && predictions.length > 0) {
    ;({ error: erreurUpsert } = await supabase
      .from('resultats')
      .upsert(lignes.map(({ bonus, ...r }) => r), { onConflict: 'match_id,user_id' }))
  }
  if (erreurUpsert) throw erreurUpsert
  return { statut: 200, ok: true, recalcules: lignes.length }
}

export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''

    let r
    if (event.httpMethod === 'GET') {
      const matchId = event.queryStringParameters?.match_id
      r = matchId
        ? await detailMatch({ supabase, token, matchId })
        : await listerMatchs({ supabase, token })
    } else if (event.httpMethod === 'POST') {
      let c
      try {
        c = JSON.parse(event.body || '{}')
      } catch {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Requête illisible.' }) }
      }
      if (c.action === 'choisir') {
        r = await choisirPourQuelquun({ supabase, token, matchId: c.match_id, userId: c.user_id, nhlId: c.nhl_id, nom: c.nom })
      } else if (c.action === 'corriger') {
        r = await corrigerStats({ supabase, token, matchId: c.match_id, userId: c.user_id, buts: c.buts, passes: c.passes })
      } else if (c.action === 'recalculer') {
        r = await recalculerMatch({ supabase, token, matchId: c.match_id })
      } else {
        r = { statut: 400, erreur: 'Action inconnue.' }
      }
    } else {
      return { statusCode: 405, body: JSON.stringify({ erreur: 'GET ou POST seulement' }) }
    }

    const { statut, ...corps } = r
    return {
      statusCode: statut,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(corps),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ erreur: String(err?.message || err) }) }
  }
}
