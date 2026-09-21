// banner.ts
import { createSignal, Show } from "solid-js";

const [bannerContent, setBannerContent] = createSignal<string | null>(null);

export function setBanner(content: string) {
  setBannerContent(() => content);
}

export function clearBanner() {
  setBannerContent(null);
}

export { bannerContent };

export default function () {
  return (
    <Show when={bannerContent() !== null}>
      <div id="banner" class="banner">
        {bannerContent()}
      </div>
    </Show>
  );
}
