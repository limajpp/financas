/**
 * Moves the focus to a heading (task 26): after an action removes the focused control from the
 * screen (archiving hides the row), the keyboard and the screen reader land somewhere predictable
 * instead of the top of the page. The heading becomes focusable by script only.
 */
export function focusHeading(heading: HTMLElement | null) {
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus();
}
