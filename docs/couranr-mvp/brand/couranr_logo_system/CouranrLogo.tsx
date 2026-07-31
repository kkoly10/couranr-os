import Image from "next/image";

type CouranrLogoProps = {
  variant?: "primary" | "reverse" | "monochrome-navy" | "monochrome-white";
  width?: number;
  priority?: boolean;
  className?: string;
};

const sourceByVariant = {
  primary: "/brand/couranr-logo-primary.svg",
  reverse: "/brand/couranr-logo-reverse.svg",
  "monochrome-navy": "/brand/couranr-logo-monochrome-navy.svg",
  "monochrome-white": "/brand/couranr-logo-monochrome-white.svg",
} as const;

export function CouranrLogo({
  variant = "primary",
  width = 168,
  priority = false,
  className,
}: CouranrLogoProps) {
  return (
    <Image
      src={sourceByVariant[variant]}
      alt="Couranr"
      width={width}
      height={Math.round(width * (250 / 900))}
      priority={priority}
      className={className}
    />
  );
}
