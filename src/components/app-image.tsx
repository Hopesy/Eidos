import type { ImgHTMLAttributes } from "react";

type AppImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  unoptimized?: boolean;
};

export function AppImage({ _unoptimized, ...props }: AppImageProps & { _unoptimized?: boolean }) {
  return <img {...props} />;
}
