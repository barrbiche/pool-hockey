import { createClient } from '@supabase/supabase-js'
import { sauvegarderPrediction, lirePredictions } from './_prediction.js'

// GET  ?match_id=...                      -> ma prédiction (et celles des autres si le match a commencé)
// POST { match_id, score_mtl, score_adversaire } -> enregistre ma prédiction
// Les deux demandent l'en-tête Authorization: Bearer <jeton de connexion>.
export async function handler(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  try {
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
