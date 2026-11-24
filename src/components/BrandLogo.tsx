interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className = '' }: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 shrink-0 ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl shadow-xs transition-transform duration-200 group-hover:scale-[1.03]"
      >
        {/* Crest background matching PWA icon */}
        <rect width="40" height="40" rx="10" fill="#14532D" />
        <rect
          x="2.25"
          y="2.25"
          width="35.5"
          height="35.5"
          rx="8"
          stroke="#F8F6F1"
          strokeOpacity="0.2"
          strokeWidth="1"
        />
        {/* Left open page */}
        <path
          d="M9.5 12.5C9.5 11.1193 10.6193 10 12 10H18.2C19.1941 10 20 10.8059 20 11.8V29.5C20 28.6716 19.3284 28 18.5 28H12C10.6193 28 9.5 26.8807 9.5 25.5V12.5Z"
          fill="#F8F6F1"
        />
        {/* Right open page */}
        <path
          d="M30.5 12.5C30.5 11.1193 29.3807 10 28 10H21.8C20.8059 10 20 10.8059 20 11.8V29.5C20 28.6716 20.6716 28 21.5 28H28C29.3807 28 30.5 26.8807 30.5 25.5V12.5Z"
          fill="#EFECE5"
        />
        {/* Center spine */}
        <path
          d="M20 11.8V29.5"
          stroke="#14532D"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        {/* Page text lines */}
        <path
          d="M12.2 15H17.2M12.2 18.2H17.2M12.2 21.4H16.4"
          stroke="#14532D"
          strokeOpacity="0.45"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M22.8 15H27.8M22.8 18.2H27.8M23.6 21.4H27.8"
          stroke="#14532D"
          strokeOpacity="0.45"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        {/* Terracotta bookmark ribbon */}
        <path d="M24.2 10H27.2V17L25.7 15.6L24.2 17V10Z" fill="#9A3412" />
      </svg>

      <span className="font-serif text-xl sm:text-[22px] font-semibold tracking-tight text-[#1C1917] dark:text-[#F5F2EB] leading-none whitespace-nowrap">
        maktabada<span className="text-[#14532D] dark:text-[#4ADE80]">.so</span>
      </span>
    </span>
  );
}
