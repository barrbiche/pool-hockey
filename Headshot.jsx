// Photo officielle NHL d'un joueur, avec repli discret si l'image n'existe
// pas (recrue sans photo encore, ID manquant, etc.)
export default function Headshot({ nhlId, taille = 32 }) {
  if (!nhlId) return null
  return (
    <img
      src={`https://assets.nhle.com/mugs/nhl/latest/${nhlId}.png`}
      alt=""
      width={taille}
      height={taille}
      className="headshot"
      loading="lazy"
      onError={(e) => {
        e.target.style.display = 'none'
      }}
    />
  )
}
