import { useEffect, useState } from 'react'

// Trois choix : 'auto' suit le réglage du téléphone, 'clair' et 'sombre'
// forcent le thème. Le choix est retenu d'une visite à l'autre.
const CLE = 'theme'
const CYCLE = ['auto', 'clair', 'sombre']
const ICONES = { auto: '🌗', clair: '☀️', sombre: '🌙' }
const LIBELLES = { auto: 'Auto', clair: 'Clair', sombre: 'Sombre' }

function lireChoix() {
  try {
    const v = localStorage.getItem(CLE)
    return CYCLE.includes(v) ? v : 'auto'
  } catch {
    // navigation privée : on repart d'auto sans casser quoi que ce soit
    return 'auto'
  }
}

// Pose data-theme sur <html>. Le même calcul est fait par le petit script
// dans index.html, pour que le bon thème soit déjà là au premier affichage.
function appliquer(choix) {
  let sombre = choix === 'sombre'
  if (choix === 'auto') {
    sombre = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  document.documentElement.setAttribute('data-theme', sombre ? 'dark' : 'light')
}

export default function BoutonTheme() {
  const [choix, setChoix] = useState(lireChoix)

  useEffect(() => {
    appliquer(choix)
    try {
      localStorage.setItem(CLE, choix)
    } catch {
      // pas grave : le thème s'applique quand même pour cette visite
    }
  }, [choix])

  // En mode auto, suivre le téléphone s'il change de réglage en cours de
  // route (coucher du soleil, bascule manuelle dans les réglages).
  useEffect(() => {
    if (choix !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const surChangement = () => appliquer('auto')
    mq.addEventListener('change', surChangement)
    return () => mq.removeEventListener('change', surChangement)
  }, [choix])

  const suivant = CYCLE[(CYCLE.indexOf(choix) + 1) % CYCLE.length]

  return (
    <button
      type="button"
      className="bouton-lien bouton-theme"
      onClick={() => setChoix(suivant)}
      title={`Thème : ${LIBELLES[choix]} — cliquer pour passer à ${LIBELLES[suivant]}`}
      aria-label={`Thème ${LIBELLES[choix]}. Cliquer pour passer à ${LIBELLES[suivant]}.`}
    >
      <span aria-hidden="true">{ICONES[choix]}</span>
      <span className="bouton-theme-texte">{LIBELLES[choix]}</span>
    </button>
  )
}
