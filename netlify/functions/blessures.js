import { createClient } from '@supabase/supabase-js'
import { ADMIN_ID, ORDRE_BASE } from './_participants.js'

// Blessures réglées à la main par Eric (la source automatique, ESPN, n'est pas fiable).
//   GET  -> { blessures: [{ nhl_id, blesse, note }], table_ok }   (tout membre du pool connecté)
//   POST { nhl_id, blesse: true|false, note }                      (Eric seulement)
//          -> règle le statut du joueur, qui PASSE AVANT la source automatique
//   POST { nhl_id, retirer: true }                                 (Eric seulement)
//          -> efface le réglage manuel : le joueur redevient « automatique »
// Table Supabase « blessures_manuelles ». Si elle n'existe pas encore, le GET répond « aucun
// réglage » (jamais d'erreur pour les autres) et le POST explique quoi faire.
export const NOTE_MAX = 80

const tableManquante = (message) =>
  /could not find the table|schema cache|relation .* does not exist/i.test(String(message || ''))

async function identifier(supabase, token) {
  if (!token) return { erreur: { statut: 401, erreur: 'Pas connecté.' } }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { erreur: { statut: 401, erreur: 'Session invalide.' } }
  if (!ORDRE_BASE.includes(data.user.id)) return { erreur: { statut: 403, erreur: 'Pas dans le pool.' } }
  return { userId: data.user.id }
}

export async function lireBlessures({ supabase, token }) {
  const { erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  const { data, error } = await supabase.from('blessures_manuelles').select('nhl_id, blesse, note')
  if (error) {
    // Table pas créée (ou panne) : le site continue avec les blessures automatiques
    return { statut: 200, blessures: [], table_ok: false }
  }
  const blessures = (data || []).map((b) => ({
    nhl_id: Number(b.nhl_id),
    blesse: !!b.blesse,
    note: String(b.note || ''),
  }))
  return { statut: 200, blessures, table_ok: true }
}

export async function ecrireBlessure({ supabase, token, nhlId, blesse, note, retirer, maintenant = new Date() }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  if (userId !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }
  if (!Number.isInteger(nhlId) || nhlId < 1 || nhlId > 1e9) return { statut: 400, erreur: 'Joueur invalide.' }

  let resultat
  if (retirer) {
    resultat = await supabase.from('blessures_manuelles').delete().eq('nhl_id', nhlId)
  } else {
    if (typeof blesse !== 'boolean') return { statut: 400, erreur: 'Dis si le joueur est blessé ou en santé.' }
    if (note !== undefined && note !== null && typeof note !== 'string') return { statut: 400, erreur: 'Note invalide.' }
    const propre = (note || '').trim()
    if (propre.length > NOTE_MAX) return { statut: 400, erreur: `Note trop longue (${NOTE_MAX} max).` }
    resultat = await supabase
      .from('blessures_manuelles')
      .upsert(
        { nhl_id: nhlId, blesse, note: blesse ? propre : '', updated_at: maintenant.toISOString() },
        { onConflict: 'nhl_id' }
      )
  }
  if (resultat.error) {
    if (tableManquante(resultat.error.message)) {
      return {
        statut: 500,
        erreur: 'La table « blessures_manuelles » n’existe pas encore dans Supabase : roule le SQL des blessures, puis réessaie.',
      }
    }
    throw resultat.error
  }
  return { statut: 200, ok: true }
}

export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    let r
    if (event.httpMethod === 'GET') {
      r = await lireBlessures({ supabase, token })
    } else if (event.httpMethod === 'POST') {
      let c
      try {
        c = JSON.parse(event.body || '{}')
      } catch {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Requête illisible.' }) }
      }
      r = await ecrireBlessure({
        supabase,
        token,
        nhlId: c.nhl_id,
        blesse: c.blesse,
        note: c.note,
        retirer: c.retirer === true,
      })
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
