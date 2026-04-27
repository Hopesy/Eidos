export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="10" className="fill-stone-900 dark:fill-stone-100"/>
      <rect x="10" y="10" width="12" height="2" rx="1" className="fill-white dark:fill-stone-900"/>
      <rect x="10" y="15" width="8"  height="2" rx="1" className="fill-white dark:fill-stone-900"/>
      <rect x="10" y="20" width="12" height="2" rx="1" className="fill-white dark:fill-stone-900"/>
    </svg>
  );
}
