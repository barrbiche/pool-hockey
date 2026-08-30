export default function Crest({ taille = 40 }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#af1e2d" stroke="#141821" strokeWidth="2" />
      <circle cx="50" cy="50" r="40" fill="none" stroke="#ffffff" strokeWidth="2" />
      <text
        x="50"
        y="64"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fontSize="46"
        fill="#ffffff"
      >
        CH
      </text>
    </svg>
  )
}
