import { createClient } from '@supabase/supabase-js'
import { ADMIN_ID, PARTICIPANTS, ORDRE_BASE } from './_participants.js'

// Page admin (Eric seulement) : « État du site ». Vérifie les morceaux qui peuvent
// casser et dit lesquels sont en vert, en jaune ou en rouge. Ne modifie RIEN.
// On ne renvoie jamais la valeur d'une clé secrète : seulement « présente » ou « manquante ».
// Appel : GET avec l'en-tête Authorization: Bearer <jeton de connexion>.

const TABLES = [
  { table: 'matchs', colonnes: 'id', critique: true },
  { table: 'choix', colonnes: 'id', critique: true },
  { table: 'joueurs', colonnes: 'id', critique: true },
  { table: 'resultats', colonnes: 'id', critique: true },
  { table: 'abonnements_push', colonnes: 'user_id', critique: true },
  { table: 'predictions', colonnes: 'user_id', critique: false, aide: 'roule le SQL du pointage deviné' },
  { table: 'site_annonce', colonnes: 'id', critique: false, aide: 'roule le SQL du bandeau d’annonce' },
]

const VARIABLES = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']

export async function diagnostiquer({ supabase, token, env = process.env, fetchImpl = fetch, maintenant = new Date() }) {
  if (!token) return { statut: 401, erreur: 'Pas connecté.' }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { statut: 401, erreur: 'Session invalide.' }
  if (data.user.id !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }

  const verifs = []
  // niveau : 'ok' (vert), 'avertissement' (jaune), 'erreur' (rouge)
  const noter = (groupe, nom, niveau, detail = '') => verifs.push({ groupe, nom, niveau, detail })
  const messageErreur = (e) => String(e?.message || e || 'erreur inconnue')

  // 1. Clés et réglages du serveur
  for (const v of VARIABLES) {
    noter('Réglages Netlify', v, env[v] ? 'ok' : 'erreur', env[v] ? 'présente' : 'MANQUANTE')
  }

  // 2. Base de données : chaque table (et la colonne « bonus » des résultats)
  for (const t of TABLES) {
    try {
      const { error: e } = await supabase.from(t.table).select(t.colonnes).limit(1)
      if (e) throw e
      noter('Base de données', `Table « ${t.table} »`, 'ok', 'accessible')
    } catch (e) {
      noter(
        'Base de données',
        `Table « ${t.table} »`,
        t.critique ? 'erreur' : 'avertissement',
        `${messageErreur(e)}${t.aide ? ` (${t.aide})` : ''}`
      )
    }
  }
  try {
    const { error: e } = await supabase.from('resultats').select('bonus').limit(1)
    if (e) throw e
    noter('Base de données', 'Colonne « bonus » (résultats)', 'ok', 'présente')
  } catch (e) {
    noter('Base de données', 'Colonne « bonus » (résultats)', 'avertissement', `${messageErreur(e)} (roule le SQL du pointage deviné)`)
  }

  // 3. API de la NHL
  try {
    const controleur = new AbortController()
    const minuterie = setTimeout(() => controleur.abort(), 6000)
    let res
    try {
      res = await fetchImpl('https://api-web.nhle.com/v1/club-schedule-season/MTL/now', {
        signal: controleur.signal,
      })
    } finally {
      clearTimeout(minuterie)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const n = (json.games || []).length
    noter('API de la NHL', 'Calendrier du Canadien', n > 0 ? 'ok' : 'avertissement', `${n} match(s) au calendrier`)
  } catch (e) {
    noter('API de la NHL', 'Calendrier du Canadien', 'erreur', e?.name === 'AbortError' ? 'pas de réponse en 6 secondes' : messageErreur(e))
  }

  // 4. Matchs en base
  try {
    const { data: matchs, error: e } = await supabase
      .from('matchs')
      .select('id, date_match, adversaire, statut, ordre_choix')
      .order('date_match', { ascending: false })
      .limit(15)
    if (e) throw e
    const liste = matchs || []
    const aVenir = liste
      .filter((m) => m.statut !== 'termine' && new Date(m.date_match) > maintenant)
      .sort((a, b) => new Date(a.date_match) - new Date(b.date_match))
    if (aVenir.length === 0) {
      noter('Matchs', 'Prochain match en base', 'avertissement', 'aucun (il sera créé quand quelqu’un ouvre le site ou par la tâche planifiée)')
    } else {
      const m = aVenir[0]
      const complet = Array.isArray(m.ordre_choix) && ORDRE_BASE.every((id) => m.ordre_choix.includes(id))
      noter('Matchs', 'Prochain match en base', complet ? 'ok' : 'avertissement', `${m.adversaire}, ${new Date(m.date_match).toISOString().slice(0, 10)}${complet ? '' : ' — ordre de choix incomplet'}`)
    }
    const bloques = liste.filter(
      (m) => m.statut !== 'termine' && maintenant - new Date(m.date_match) > 8 * 3600 * 1000
    )
    noter(
      'Matchs',
      'Matchs finis mais pas calculés',
      bloques.length === 0 ? 'ok' : 'avertissement',
      bloques.length === 0
        ? 'aucun'
        : bloques.map((m) => `${m.adversaire} (${new Date(m.date_match).toISOString().slice(0, 10)})`).join(', ') + ' — appuie sur « Bouton à Pa! » ou corrige dans « Corriger un match »'
    )
    const dernier = liste.find((m) => m.statut === 'termine')
    noter('Matchs', 'Dernier match calculé', dernier ? 'ok' : 'avertissement', dernier ? `${dernier.adversaire}, ${new Date(dernier.date_match).toISOString().slice(0, 10)}` : 'aucun encore')
  } catch (e) {
    noter('Matchs', 'Lecture des matchs', 'erreur', messageErreur(e))
  }

  // 5. Comptes des participants
  for (const p of PARTICIPANTS) {
    try {
      const { data: d, error: e } = await supabase.auth.admin.getUserById(p.id)
      if (e || !d?.user) throw new Error(e?.message || 'compte introuvable')
      const confirme = !!(d.user.email_confirmed_at || d.user.confirmed_at)
      noter('Comptes', p.nom, confirme ? 'ok' : 'avertissement', confirme ? d.user.email || 'compte OK' : 'courriel pas confirmé (change son mot de passe dans « Comptes » pour le confirmer)')
    } catch (e) {
      noter('Comptes', p.nom, 'erreur', messageErreur(e))
    }
  }

  const erreurs = verifs.filter((v) => v.niveau === 'erreur').length
  const avertissements = verifs.filter((v) => v.niveau === 'avertissement').length
  return {
    statut: 200,
    verifs,
    resume: { erreurs, avertissements, ok: verifs.length - erreurs - avertissements },
    verifie_a: maintenant.toISOString(),
  }
}

export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    const { statut, ...corps } = await diagnostiquer({ supabase, token })
    return {
      statusCode: statut,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(corps),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ erreur: String(err?.message || err) }) }
  }
}
