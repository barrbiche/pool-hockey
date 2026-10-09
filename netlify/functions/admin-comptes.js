import { createClient } from '@supabase/supabase-js'
import { ADMIN_ID, ORDRE_BASE, PARTICIPANTS } from './_participants.js'

// Page admin (Eric seulement) : voir les comptes (courriel, dernière connexion) et
// changer le mot de passe de quelqu'un.
// Les mots de passe actuels NE PEUVENT PAS être lus : Supabase n'en garde qu'une
// empreinte illisible. On peut seulement en mettre un nouveau.
// GET  -> la liste des comptes
// POST { user_id, mot_de_passe } -> change le mot de passe (et confirme le courriel)
// Les deux demandent Authorization: Bearer <jeton de connexion> d'Eric.

export const LONGUEUR_MIN = 6 // minimum de Supabase
export const LONGUEUR_MAX = 72 // limite de l'encodage des mots de passe

async function verifierAdmin(supabase, token) {
  if (!token) return { erreur: { statut: 401, erreur: 'Pas connecté.' } }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { erreur: { statut: 401, erreur: 'Session invalide.' } }
  if (data.user.id !== ADMIN_ID) return { erreur: { statut: 403, erreur: 'Réservé à Eric.' } }
  return {}
}

export async function lireComptes({ supabase, token }) {
  const { erreur } = await verifierAdmin(supabase, token)
  if (erreur) return erreur

  const comptes = []
  for (const p of PARTICIPANTS) {
    const { data, error } = await supabase.auth.admin.getUserById(p.id)
    if (error || !data?.user) {
      comptes.push({ id: p.id, nom: p.nom, trouve: false })
      continue
    }
    const u = data.user
    comptes.push({
      id: p.id,
      nom: p.nom,
      trouve: true,
      email: u.email || '',
      confirme: !!(u.email_confirmed_at || u.confirmed_at),
      derniere_connexion: u.last_sign_in_at || null,
      cree_le: u.created_at || null,
    })
  }
  return { statut: 200, comptes }
}

export async function changerMotDePasse({ supabase, token, userId, motDePasse }) {
  const { erreur } = await verifierAdmin(supabase, token)
  if (erreur) return erreur

  if (!ORDRE_BASE.includes(userId)) return { statut: 400, erreur: 'Compte inconnu.' }
  if (typeof motDePasse !== 'string' || motDePasse.length < LONGUEUR_MIN) {
    return { statut: 400, erreur: `Le mot de passe doit avoir au moins ${LONGUEUR_MIN} caractères.` }
  }
  if (new TextEncoder().encode(motDePasse).length > LONGUEUR_MAX) {
    return { statut: 400, erreur: `Le mot de passe est trop long (${LONGUEUR_MAX} max).` }
  }

  // email_confirm : un compte « pas confirmé » ne peut pas se connecter, on règle ça en même temps.
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password: motDePasse,
    email_confirm: true,
  })
  if (error) return { statut: 400, erreur: `Supabase a refusé : ${error.message}` }
  return { statut: 200, ok: true }
}

export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''

    let r
    if (event.httpMethod === 'POST') {
      let corps
      try {
        corps = JSON.parse(event.body || '{}')
      } catch {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Requête illisible.' }) }
      }
      r = await changerMotDePasse({
        supabase,
        token,
        userId: corps.user_id,
        motDePasse: corps.mot_de_passe,
      })
    } else if (event.httpMethod === 'GET') {
      r = await lireComptes({ supabase, token })
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
    // On ne renvoie jamais le mot de passe, même dans une erreur
    return { statusCode: 500, body: JSON.stringify({ erreur: String(err?.message || err) }) }
  }
}
