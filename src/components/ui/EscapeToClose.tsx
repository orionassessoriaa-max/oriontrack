'use client';

import { useEffect } from 'react';

const overlaySelector = [
  '[data-escape-overlay]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-modal]',
  '.kh-modal',
  '.kh-modal-backdrop',
  '.kh-modal-scrim',
  '[class~="fixed"][class~="inset-0"]',
].join(',');

const closeSelector = [
  '[data-escape-close]',
  'button[aria-label="Fechar"]',
  'button[aria-label*="fechar" i]',
  'button[title*="fechar" i]',
  'button[aria-label="Close"]',
  'button[title*="close" i]',
  '.kh-modal-close',
].join(',');

function isVisible(element: Element) {
  const node = element as HTMLElement;
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();

  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.opacity !== '0'
    && rect.width > 0
    && rect.height > 0;
}

function closeTopmostOverlay() {
  const overlays = Array.from(document.querySelectorAll(overlaySelector)).filter(isVisible);
  const overlay = overlays[overlays.length - 1];
  if (!overlay) return;

  const closeButton = overlay.querySelector(closeSelector) as HTMLElement | null;
  if (closeButton && isVisible(closeButton)) {
    closeButton.click();
    return;
  }

  // Legacy overlays often close from their backdrop and do not expose a
  // dedicated close button or dialog role yet.
  (overlay as HTMLElement).click();
}

/** Closes the topmost CRM modal/drawer without hijacking normal text input. */
export default function EscapeToClose() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      // Let a dialog's own handler run first, then close the next visible layer.
      window.setTimeout(closeTopmostOverlay, 0);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}
