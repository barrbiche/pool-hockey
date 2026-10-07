import { createClient } from '@supabase/supabase-js'
import { ORDRE_BASE } from './_participants.js'

// Pointage deviné : +2 points si on trouve le pointage final exact.
// Tout est dans CE fichier (rien d'autre à uploader à part _participants.js).
// Les fonctions de logique sont exportées pour pouvoir les tester sans vrai Supabase.
export const POINTS_PREDICTION = 2

// Bonus gagné : 2 points si le pointage prédit est exactement le pointage final.
export function bonusPrediction(prediction, scoreMtl, scoreAdversaire) {
  if (!prediction) return 0
  if (!Number.isInteger(scoreMtl) || !Number.isInteger(scoreAdversaire)) return 0
  return prediction.score_mtl === scoreMtl && prediction.score_adversaire === scoreAdversaire
    ? POINTS_PREDICTION
    : 0
}

async function identifier(supabase, token) {
  if (!token) return { erreur: { statut: 401, erreur: 'Pas connecté.' } }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { erreur: { statut: 401, erreur: 'Session invalide.' } }
  if (!ORDRE_BASE.includes(data.user.id)) return { erreur: { statut: 403, erreur: 'Pas dans le pool.' } }
  return { userId: data.user.id }
}

async function trouverMatch(supabase, matchId) {
  const { data, error } = await supabase
    .from('matchs')
    .select('id, date_match, statut')
    .eq('id', matchId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function sauvegarderPrediction({ supabase, token, matchId, scoreMtl, scoreAdversaire, maintenant = new Date() }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur

  const valide = (n) => Number.isInteger(n) && n >= 0 && n <= 20
  if (!valide(scoreMtl) || !valide(scoreAdversaire)) {
    return { statut: 400, erreur: 'Les pointages doivent être des nombres entiers de 0 à 20.' }
  }

  const match = await trouverMatch(supabase, matchId)
  if (!match) return { statut: 404, erreur: 'Match introuvable.' }
  if (match.statut === 'termine' || maintenant >= new Date(match.date_match)) {
    return { statut: 400, erreur: 'Le match a commencé, les prédictions sont fermées.' }
  }

  const { error } = await supabase.from('predictions').upsert(
    {
      match_id: String(match.id),
      user_id: userId,
      score_mtl: scoreMtl,
      score_adversaire: scoreAdversaire,
    },
    { onConflict: 'match_id,user_id' }
  )
  if (error) throw error
  return { statut: 200, ok: true }
}

// Ma prédiction et celles des autres : tout le monde voit tout, même avant le match
// (pour le plaisir de se comparer).
export async function lirePredictions({ supabase, token, matchId, maintenant = new Date() }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur

  const match = await trouverMatch(supabase, matchId)
  if (!match) return { statut: 404, erreur: 'Match introuvable.' }
  const commence = match.statut === 'termine' || maintenant >= new Date(match.date_match)

  const { data, error } = await supabase
    .from('predictions')
    .select('user_id, score_mtl, score_adversaire')
    .eq('match_id', String(match.id))
  if (error) throw error
  const lignes = data || []

  return {
    statut: 200,
    commence,
    mienne: lignes.find((l) => l.user_id === userId) || null,
    autres: lignes.filter((l) => l.user_id !== userId),
    ont_predit: lignes.map((l) => l.user_id),
  }
}

// GET  ?match_id=...                      -> ma prédiction (et celles des autres si le match a commencé)
// POST { match_id, score_mtl, score_adversaire } -> enregistre ma prédiction
// Les deux demandent l'en-tête Authorization: Bearer <jeton de connexion>.
export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''

    let r
    if (event.httpMethod === 'POST') {
      const { match_id, score_mtl, score_adversaire } = JSON.parse(event.body || '{}')
      r = await sauvegarderPrediction({
        supabase,
        token,
        matchId: match_id,
        scoreMtl: score_mtl,
        scoreAdversaire: score_adversaire,
      })
    } else if (event.httpMethod === 'GET') {
      r = await lirePredictions({ supabase, token, matchId: event.queryStringParameters?.match_id })
    } else {
      return { statusCode: 405, body: JSON.stringify({ error: 'GET ou POST seulement' }) }
    }

    const { statut, ...corps } = r
    return {
      statusCode: statut,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(corps),
    }
  } catch (err) {
    const message = String(err?.message || err)
    // Table pas encore créée dans Supabase (le SQL n'a pas été roulé)
    const tableManquante = /could not find the table|schema cache|relation .* does not exist/i.test(message)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: tableManquante
          ? 'La table « predictions » n’existe pas encore dans Supabase : roule le SQL du pointage deviné, puis réessaie.'
          : message,
      }),
    }
  }
}
