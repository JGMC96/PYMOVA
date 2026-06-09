interface PymovaLogoProps {
  className?: string;
}

export const PymovaLogo = ({ className = "w-6 h-6" }: PymovaLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M6 4H14C17.3137 4 20 6.68629 20 10C20 13.3137 17.3137 16 14 16H6V20"
      stroke="url(#pymova_logo_grad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6 10H14"
      stroke="url(#pymova_logo_grad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <defs>
      <linearGradient
        id="pymova_logo_grad"
        x1="6"
        y1="4"
        x2="20"
        y2="16"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#22d3ee" />
        <stop offset="1" stopColor="#0d9488" />
      </linearGradient>
    </defs>
  </svg>
);
