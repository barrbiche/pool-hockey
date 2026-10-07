// Rappel amical "c'est ton tour de choisir" (réservé à Eric). Séparé de la
// fonction Netlify pour pouvoir être testé sans web-push ni vrai Supabase.
import { ADMIN_ID, ORDRE_BASE, NOMS } from './_participants.js'

export async function traiterRappel({ supabase, token, userId, matchId, envoyerPush, maintenant = new Date() }) {
  if (!token) return { statut: 401, erreur: 'Pas connecté.' }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { statut: 401, erreur: 'Session invalide.' }
  if (data.user.id !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }

  if (!ORDRE_BASE.includes(userId)) return { statut: 400, erreur: 'Participant inconnu.' }
  const nom = NOMS[userId]

  const { data: match, error: errMatch } = await supabase
    .from('matchs')
    .select('id, adversaire, date_match, ordre_choix')
    .eq('id', matchId)
    .maybeSingle()
  if (errMatch) throw errMatch
  if (!match) return { statut: 404, erreur: 'Match introuvable.' }
  if (maintenant >= new Date(match.date_match)) {
    return { statut: 400, erreur: 'Le match a déjà commencé, les choix sont verrouillés.' }
  }

  const { data: choix } = await supabase.from('choix').select('user_id').eq('match_id', match.id)
  const dejaChoisi = new Set((choix || []).map((c) => c.user_id))
  if (dejaChoisi.has(userId)) return { statut: 400, erreur: `${nom} a déjà choisi.` }

  // Même règle que le site : c'est le premier de l'ordre qui n'a pas encore choisi.
  const prochain = (match.ordre_choix || []).find((uid) => !dejaChoisi.has(uid))
  if (prochain !== userId) {
    return {
      statut: 409,
      erreur: `Ce n'est pas encore le tour de ${nom}${prochain ? ` (c'est à ${NOMS[prochain]})` : ''}.`,
    }
  }

  const corps = `Salut ${nom}! 👋 C'est à ton tour de choisir ton joueur pour le match contre ${match.adversaire}. 🏒`
  const envoyes = await envoyerPush([userId], { titre: 'Pool de Hockey 🏒', corps })
  if (envoyes.length === 0) {
    return { statut: 200, envoye: false, raison: `${nom} n'a pas activé les notifications.` }
  }
  return { statut: 200, envoye: true }
}
