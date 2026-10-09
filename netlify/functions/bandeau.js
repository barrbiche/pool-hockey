import { createClient } from '@supabase/supabase-js'
import { ADMIN_ID, ORDRE_BASE } from './_participants.js'

// Bandeau d'annonce affiché en haut du site à tout le monde (ex. « Maintenance ce soir »).
//   GET  -> { actif, texte }            (n'importe quel membre du pool connecté)
//   POST { texte, actif }               (Eric seulement)
// Table Supabase « site_annonce » (une seule ligne, id = 1). Si la table n'existe pas encore,
// le GET répond « pas de bandeau » (jamais d'erreur pour les autres) et le POST explique quoi faire.
export const LONGUEUR_MAX = 300

const tableManquante = (message) =>
  /could not find the table|schema cache|relation .* does not exist/i.test(String(message || ''))

async function identifier(supabase, token) {
  if (!token) return { erreur: { statut: 401, erreur: 'Pas connecté.' } }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { erreur: { statut: 401, erreur: 'Session invalide.' } }
  if (!ORDRE_BASE.includes(data.user.id)) return { erreur: { statut: 403, erreur: 'Pas dans le pool.' } }
  return { userId: data.user.id }
}

export async function lireBandeau({ supabase, token }) {
  const { erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  const { data, error } = await supabase
    .from('site_annonce')
    .select('texte, actif, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    // Table pas créée (ou panne) : le site continue sans bandeau
    return { statut: 200, actif: false, texte: '', table_ok: false }
  }
  const texte = (data?.texte || '').trim()
  return {
    statut: 200,
    actif: !!data?.actif && texte.length > 0,
    texte,
    version: data?.updated_at || null,
    table_ok: true,
  }
}

export async function ecrireBandeau({ supabase, token, texte, actif, maintenant = new Date() }) {
  const { userId, erreur } = await identifier(supabase, token)
  if (erreur) return erreur
  if (userId !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }
  if (typeof texte !== 'string') return { statut: 400, erreur: 'Texte invalide.' }
  const propre = texte.trim()
  if (propre.length > LONGUEUR_MAX) return { statut: 400, erreur: `Message trop long (${LONGUEUR_MAX} max).` }
  if (actif && propre.length === 0) return { statut: 400, erreur: 'Écris un message avant de l’afficher.' }

  const { error } = await supabase
    .from('site_annonce')
    .upsert({ id: 1, texte: propre, actif: !!actif, updated_at: maintenant.toISOString() }, { onConflict: 'id' })
  if (error) {
    if (tableManquante(error.message)) {
      return { statut: 500, erreur: 'La table « site_annonce » n’existe pas encore dans Supabase : roule le SQL du bandeau, puis réessaie.' }
    }
    throw error
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
      r = await lireBandeau({ supabase, token })
    } else if (event.httpMethod === 'POST') {
      let c
      try {
        c = JSON.parse(event.body || '{}')
      } catch {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Requête illisible.' }) }
      }
      r = await ecrireBandeau({ supabase, token, texte: c.texte, actif: c.actif })
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
