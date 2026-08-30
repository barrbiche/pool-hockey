export default function Crest({ taille = 40 }) {
  return (
    <img
      src="/logo.jpeg"
      alt="Logo CH"
      width={taille}
      height={taille}
      style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }}
    />
  )
}
