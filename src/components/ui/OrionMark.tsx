type OrionMarkProps = {
  size?: number;
  className?: string;
  variant?: 'dark' | 'light';
};

export default function OrionMark({ size = 42, className = '', variant = 'dark' }: OrionMarkProps) {
  const src = variant === 'light' ? '/orion-empty-logo.png' : '/orion-empty-logo-dark.png';

  return (
    <img
      src={src}
      alt="Orion"
      className={`inline-block object-contain ${className}`}
      style={{ width: size * 3.2, height: size }}
    />
  );
}
