// Pastille colorée avec l'initiale du participant. Chaque personne garde
// la même couleur partout dans le site (classement, choix, historique),
// pour qu'on la reconnaisse d'un coup d'œil.
const COULEURS = {
  '0918539e-788e-4ed9-9c84-b8f39b83f05c': { fond: '#c9971f', texte: '#fff' }, // Père — or
  '58220e78-2226-4983-a026-3abefc8431a7': { fond: '#2f5bb8', texte: '#fff' }, // Mike — bleu
  'b5c5d9e5-1c91-4da8-ab5e-adcc40057090': { fond: '#ce0e2d', texte: '#fff' }, // Eric — rouge
}

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
