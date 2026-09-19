// Petites icônes animées pour la forme des joueurs. Les animations sont
// désactivées automatiquement si l'appareil demande moins de mouvement
// (règle prefers-reduced-motion dans App.css).
export function IconeFeu() {
  return (
    <span className="icone-anim icone-feu" role="img" aria-label="en feu">
      🔥
    </span>
  )
}

export function IconeGlace() {
  return (
    <span className="icone-anim icone-glace" role="img" aria-label="froid">
      ❄️
    </span>
  )
}

export function IconePlasteur() {
  return (
    <span className="icone-anim icone-plasteur" role="img" aria-label="possiblement blessé">
      🩹
    </span>
  )
}
