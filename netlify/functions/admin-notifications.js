import { createClient } from '@supabase/supabase-js'
import { ADMIN_ID, PARTICIPANTS } from './_participants.js'

// Page admin (Eric seulement) : qui a activé les notifications.
// On ne renvoie JAMAIS le contenu de l'abonnement (ce sont des clés privées de
// l'appareil) : seulement « actif ou non », le type d'appareil et la date si elle existe.
// Appel : GET avec l'en-tête Authorization: Bearer <jeton de connexion>.

// Devine le type d'appareil / navigateur d'après le service de notifications utilisé.
export function typeAppareil(endpoint) {
  const e = String(endpoint || '')
  if (e.includes('push.apple.com')) return 'iPhone / iPad / Safari'
  if (e.includes('fcm.googleapis.com') || e.includes('android.googleapis.com')) return 'Android / Chrome'
  if (e.includes('mozilla.com') || e.includes('mozaws.net')) return 'Firefox'
  if (e.includes('notify.windows.com')) return 'Edge / Windows'
  return e ? 'Autre appareil' : ''
}

export async function lireNotifications({ supabase, token }) {
  if (!token) return { statut: 401, erreur: 'Pas connecté.' }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { statut: 401, erreur: 'Session invalide.' }
  if (data.user.id !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }

  const { data: lignes, error: erreurLignes } = await supabase.from('abonnements_push').select('*')
  if (erreurLignes) throw erreurLignes

  const participants = PARTICIPANTS.map((p) => {
    const ligne = (lignes || []).find((l) => l.user_id === p.id)
    return {
      id: p.id,
      nom: p.nom,
      actif: !!ligne,
      appareil: ligne ? typeAppareil(ligne.subscription?.endpoint) : '',
      depuis: ligne ? ligne.updated_at || ligne.created_at || null : null,
    }
  })
  return {
    statut: 200,
    participants,
    actifs: participants.filter((p) => p.actif).length,
    total: participants.length,
  }
}

export async function handler(event) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const entete = event.headers?.authorization || event.headers?.Authorization || ''
    const token = entete.startsWith('Bearer ') ? entete.slice(7) : ''
    const { statut, ...corps } = await lireNotifications({ supabase, token })
    return {
      statusCode: statut,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(corps),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err?.message || err) }) }
  }
}
