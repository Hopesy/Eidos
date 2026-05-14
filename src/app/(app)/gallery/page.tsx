import { listImageFavorites } from "@/server/repositories/image/favorite-repository";

import { GalleryClient } from "./gallery-client";

export const dynamic = "force-dynamic";

export default function GalleryPage() {
  return <GalleryClient initialItems={listImageFavorites()} />;
}
