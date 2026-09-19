// Logo officiel d'une équipe de la NHL, à partir de son abréviation (TOR,
// BOS, MTL...). Si le logo ne charge pas, l'image disparaît simplement et
// le texte autour (l'abréviation) reste lisible.
export default function LogoEquipe({ abbrev, taille = 26 }) {
  if (!abbrev) return null
  return (
    <img
      src={`https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg`}
      alt=""
      width={taille}
      height={taille}
      className="logo-equipe"
      loading="lazy"
      onError={(e) => {
        e.target.style.display = 'none'
      }}
    />
  )
}
