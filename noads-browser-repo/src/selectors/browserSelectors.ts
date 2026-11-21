/**
 * Renderer-facing selectors over BlockState. Pure logic — unit-tested in
 * tests/selectors.test.ts — so the shield UI stays a thin presentation layer.
 */
import type { BlockState } from '../../shared/types';

/** Total protection interventions (network blocks + popup denials). */
export function totalBlocked(blocks: BlockState): number {
  return blocks.count + blocks.popupsBlocked;
}

/** Full shield tooltip text. */
export function shieldTooltip(blocks: BlockState): string {
  const parts: string[] = [];
  if (!blocks.enabled) parts.push('Ad blocking disabled.');
  parts.push(
    `${blocks.count} ad request${blocks.count === 1 ? '' : 's'} blocked this session.`,
  );
  if (blocks.lastBlocked) parts.push(`Last: ${blocks.lastBlocked}.`);
  if (blocks.popupsBlocked > 0) {
    parts.push(
      `${blocks.popupsBlocked} popup${blocks.popupsBlocked === 1 ? '' : 's'} stopped.`,
    );
    if (blocks.lastPopup) parts.push(`Last popup: ${blocks.lastPopup}.`);
  }
  if (blocks.warning) parts.push(`Warning: ${blocks.warning}`);
  return parts.join(' ');
}
