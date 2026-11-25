// Back and forward between screens (Alt+← / Alt+→), wherever the page change came from:
// the sidebar, the palette, Artix or a link inside a screen.
import { useUi, type Page } from "../lib/store";

const back: Page[] = [];
const forward: Page[] = [];
let moving = false;

useUi.subscribe((s, prev) => {
  if (s.page === prev.page || moving) return;
  back.push(prev.page);
  if (back.length > 50) back.shift();
  forward.length = 0;
});

function step(from: Page[], to: Page[]) {
  const page = from.pop();
  if (!page) return;
  to.push(useUi.getState().page);
  moving = true;
  useUi.getState().setPage(page);
  moving = false;
}

export const goBack = () => step(back, forward);
export const goForward = () => step(forward, back);
