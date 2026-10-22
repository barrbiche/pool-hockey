import { createClient } from '@supabase/supabase-js'
import { ORDRE_BASE, saisonEnCours } from './_participants.js'

// Combien de pointages chaque participant a devinés cette saison (matchs terminés
// seulement). Sert au « taux de réussite » du classement et aux trophées : le nombre de
// pointages EXACTS, lui, se lit déjà dans les résultats (colonne « bonus »).
//   GET -> { faits: { <user_id>: nombre }, table_ok }     (tout membre du pool connecté)
// Ne renvoie que des COMPTES, jamais un pointage deviné. Si la table « predictions »
// n'existe pas encore, répond « aucun pronostic » (jamais d'erreur).
async function identifier(supabase, token) {
  if (!token) return { erreur: { statut: 401, erreur: 'Pas connecté.' } }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { erreur: { statut: 401, erreur: 'Session invalide.' } }
  if (!ORDRE_BASE.includes(data.user.id)) return { erreur: { statut: 403, erreur: 'Pas dans le pool.' } }
  return { userId: data.user.id }
}

export async function compterPronostics({ supabase, token, maintenant = new Date() }) {
  const { erreur } = await identifier(supabase, token)
  if (erreur) return erreur

  const faits = Object.fromEntries(ORDRE_BASE.map((u) => [u, 0]))
  const { debutSaison } = saisonEnCours(maintenant)

  const { data: matchs, error: erreurMatchs } = await supabase
    .from('matchs')
    .select('id')
    .gte('date_match', debutSaison.toISOString())
    .eq('statut', 'termine')
  if (erreurMatchs) throw erreurMatchs
  const ids = (matchs || []).map((m) => String(m.id))
  if (ids.length === 0) return { statut: 200, faits, table_ok: true }

  const { data: lignes, error } = await supabase
    .from('predictions')
    .select('user_id, match_id')
    .in('match_id', ids)
  if (error) return { statut: 200, faits, table_ok: false }

  // Un pronostic par personne et par match au maximum (même si la base en contenait deux)
  const vus = new Set()
  for (const l of lignes || []) {
    const cle = `${l.user_id}|${l.match_id}`
    if (vus.has(cle) || !(l.user_id in faits)) continue
    vus.add(cle)
    faits[l.user_id] += 1
  }
  return { statut: 200, faits, table_ok: true }
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: JSON.stringify({ erreur: 'GET seulement' }) }
    }
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    const { statut, ...corps } = await compterPronostics({ supabase, token })
    return {
      statusCode: statut,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(corps),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ erreur: String(err?.message || err) }) }
  }
}
