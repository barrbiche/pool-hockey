// Pastille colorée avec l'initiale du participant. Chaque personne garde
// la même couleur partout dans le site (classement, choix, historique),
// pour qu'on la reconnaisse d'un coup d'œil.
import { PARTICIPANTS } from '../netlify/functions/_participants.js'

// Couleurs lues dans la liste unique des participants.
const COULEURS = Object.fromEntries(
  PARTICIPANTS.map((p) => [p.id, { fond: p.couleur, texte: '#fff' }])
)

const COULEUR_INCONNUE = { fond: '#8496b5', texte: '#fff' }

export default function Pastille({ userId, nom, taille = 28 }) {
  const { fond, texte } = COULEURS[userId] || COULEUR_INCONNUE
  const initiale = (nom || '?').trim().charAt(0).toUpperCase()

  return (
    <span
      className="pastille"
      style={{
        width: taille,
        height: taille,
        background: fond,
        color: texte,
        fontSize: Math.round(taille * 0.46),
      }}
      aria-hidden="true"
    >
      {initiale}
    </span>
  )
}
