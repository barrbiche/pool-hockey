// Logique de l'annonce (notification à tout le monde), séparée de la
// fonction Netlify pour pouvoir la tester sans web-push ni vrai Supabase.
import { ADMIN_ID, ORDRE_BASE, NOMS } from './_participants.js'

export async function traiterAnnonce({ supabase, token, texte, destinataire, envoyerPush }) {
  if (!token) return { statut: 401, erreur: 'Pas connecté.' }

  // Le serveur vérifie lui-même qui appelle : le bouton caché dans le site
  // ne suffit pas, n'importe qui pourrait appeler la fonction directement.
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { statut: 401, erreur: 'Session invalide.' }
  if (data.user.id !== ADMIN_ID) return { statut: 403, erreur: 'Réservé à Eric.' }

  const message = (texte || '').trim()
  if (message.length === 0) return { statut: 400, erreur: 'Le message est vide.' }
  if (message.length > 300) return { statut: 400, erreur: 'Message trop long (300 max).' }

  // 'tous' (ou rien) = tout le monde, sinon un seul compte connu du pool
  const cibles = !destinataire || destinataire === 'tous' ? ORDRE_BASE : [destinataire]
  if (cibles.some((uid) => !ORDRE_BASE.includes(uid))) {
    return { statut: 400, erreur: 'Destinataire inconnu.' }
  }

  const envoyes = await envoyerPush(cibles, { titre: '📣 Pool de Hockey', corps: message })
  const pasRecus = cibles.filter((uid) => !envoyes.includes(uid)).map((uid) => NOMS[uid])
  return { statut: 200, envoyes: envoyes.length, pasRecus }
}
