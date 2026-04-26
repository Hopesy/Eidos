import { forwardRef, type ImgHTMLAttributes } from "react";

type AppImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  unoptimized?: boolean;
};

export const AppImage = forwardRef<HTMLImageElement, AppImageProps & { _unoptimized?: boolean }>(
  function AppImage({ _unoptimized, ...props }, ref) {
    return <img ref={ref} {...props} />;
  },
);
