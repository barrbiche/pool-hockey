import { useEffect, useRef, useState } from 'react'
import Headshot from './Headshot'
import { IconeFeu, IconeGlace, IconePlasteur } from './Icones'

// Menu de sélection maison (à la place du <select> natif) : les menus
// natifs du navigateur n'acceptent ni photos ni icônes animées dans leurs
// options. La liste s'ouvre en place et pousse le contenu vers le bas,
// plutôt que de flotter par-dessus — ça évite qu'elle soit coupée par les
// cartes et ça se comporte bien sur cellulaire.
export default function SelecteurJoueur({ joueurs, nomsPris, nhlIdChoisi, onChoisir }) {
  const [ouvert, setOuvert] = useState(false)
  const conteneurRef = useRef(null)

  useEffect(() => {
    if (!ouvert) return

    function clicDehors(e) {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target)) {
        setOuvert(false)
      }
    }
    function touche(e) {
      if (e.key === 'Escape') setOuvert(false)
    }

    document.addEventListener('mousedown', clicDehors)
    document.addEventListener('touchstart', clicDehors)
    document.addEventListener('keydown', touche)
    return () => {
      document.removeEventListener('mousedown', clicDehors)
      document.removeEventListener('touchstart', clicDehors)
      document.removeEventListener('keydown', touche)
    }
  }, [ouvert])

  const choisi = joueurs.find((j) => j.nhl_id === nhlIdChoisi)

  return (
    <div className="selecteur" ref={conteneurRef}>
      <button
        type="button"
        className="selecteur-bouton"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        aria-haspopup="listbox"
      >
        <span className="selecteur-valeur">
          {choisi ? (
            <>
              <Headshot nhlId={choisi.nhl_id} taille={28} />
              <span className="selecteur-valeur-texte">
                #{choisi.numero} {choisi.nom}
              </span>
            </>
          ) : (
            <span className="selecteur-valeur-texte">— Choisis un joueur —</span>
          )}
        </span>
        <span className={ouvert ? 'selecteur-fleche ouverte' : 'selecteur-fleche'}>▾</span>
      </button>

      {ouvert && (
        <ul className="selecteur-liste" role="listbox">
          {joueurs.map((j) => {
            const pris = nomsPris.includes(j.nom)
            const actif = j.nhl_id === nhlIdChoisi
            return (
              <li key={j.nhl_id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={actif}
                  disabled={pris}
                  className={
                    'selecteur-option' + (pris ? ' pris' : '') + (actif ? ' actif' : '')
                  }
                  onClick={() => {
                    setOuvert(false)
                    onChoisir(j)
                  }}
                >
                  <Headshot nhlId={j.nhl_id} taille={32} />
                  <span className="selecteur-option-nom">
                    <span className="selecteur-numero">#{j.numero}</span> {j.nom}{' '}
                    <span className="selecteur-position">{j.position}</span>
                  </span>
                  <span className="selecteur-option-icones">
                    {j.blesse && <IconePlasteur />}
                    {j.forme === 'chaud' && <IconeFeu />}
                    {j.forme === 'froid' && <IconeGlace />}
                    {pris && <span className="selecteur-pris">pris</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
