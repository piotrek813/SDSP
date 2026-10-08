// banner.ts
import { createSignal, Show } from "solid-js";

const [bannerContent, setBannerContent] = createSignal<{
  content: string;
  isError: boolean;
} | null>(null);

export function setBanner(content: string, isError = false) {
  setBannerContent(() => ({
    content,
    isError,
  }));
}

export function clearBanner() {
  setBannerContent(null);
}

export { bannerContent };

export default function () {
  const isError = () => bannerContent()?.isError ?? false;
  const content = () => bannerContent()?.content ?? "";
  const show = () => bannerContent() !== null;

  return (
    <Show when={show()}>
      <div id="banner" class="banner" classList={{ error: isError() }}>
        {content()}
      </div>
    </Show>
  );
}
